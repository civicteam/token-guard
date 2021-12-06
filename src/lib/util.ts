import * as anchor from "@project-serum/anchor";
import { Program, Provider, web3 } from "@project-serum/anchor";
import { AccountInfo, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { TokenGuard } from "../../target/types/token_guard";
import { Cluster, clusterApiUrl } from "@solana/web3.js";
import { programs } from "@metaplex/js";

const Metadata = programs.metadata.Metadata;

export type ExtendedCluster = Cluster | "localnet" | "civicnet";
export const CIVICNET_URL =
  "http://ec2-34-238-243-215.compute-1.amazonaws.com:8899";

export const getClusterUrl = (cluster: ExtendedCluster) => {
  switch (cluster) {
    case "localnet":
      return "http://localhost:8899";
    case "civicnet":
      return CIVICNET_URL;
    default:
      return clusterApiUrl(cluster);
  }
};

const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

const TOKEN_GUARD_PROGRAM = new web3.PublicKey(
  "tg7bdEQom2SZT1JB2d77RDJFYaL4eZ2FcM8HZZAg5Z8"
);

export interface TokenGuardState {
  id: web3.PublicKey;
  outMint: web3.PublicKey;
  recipient: web3.PublicKey;
  mintAuthority: web3.PublicKey;
  gatekeeperNetwork: web3.PublicKey;
  membershipToken?: MembershipToken;
}

export type Strategy = "SPL" | "NFT-UA" | "NFT-Creator";
export type MembershipToken = {
  key: web3.PublicKey;
  strategy: Strategy;
};

// should match the Strategy enum in lib.rs
// TODO Can anchor generate this mapping?
export const strategyToInt = (strategy?: Strategy): number => {
  if (!strategy) {
    return 0;
  }

  switch (strategy) {
    case "SPL":
      return 1;
    case "NFT-UA":
      return 2;
    case "NFT-Creator":
      return 3;
    default:
      throw new Error(`Unknown strategy: ${strategy}`);
  }
};

// TODO fix with anchor mappings
const structToStrategy = (strategyValue: any): Strategy | undefined => {
  // Note - anchor maps the enum values to properties (converted to camelCase)
  // with an object literal as a value: {}
  if (strategyValue.hasOwnProperty("gatewayOnly")) return undefined;
  if (strategyValue.hasOwnProperty("membershipSplToken")) return "SPL";
  if (strategyValue.hasOwnProperty("membershipNftUpdateAuthority"))
    return "NFT-UA";
  if (strategyValue.hasOwnProperty("membershipNftCreator"))
    return "NFT-Creator";

  throw new Error(`Unknown strategy value:` + JSON.stringify(strategyValue));
};

export const fetchProgram = async (
  provider: Provider
): Promise<Program<TokenGuard>> => {
  const idl = await anchor.Program.fetchIdl(TOKEN_GUARD_PROGRAM, provider);

  if (!idl) throw new Error("TokenGuard IDL could not be found");

  return new anchor.Program(
    idl,
    TOKEN_GUARD_PROGRAM,
    provider
  ) as Program<TokenGuard>;
};

const makeMembershipTokenDetails = ({
  membershipToken,
  strategy,
}: TokenGuardMembershipTokenState): MembershipToken | undefined => {
  if (!membershipToken || !strategy) {
    return undefined;
  }

  return {
    key: membershipToken,
    strategy: structToStrategy(strategy) as Strategy,
  };
};

export const getTokenGuardState = async (
  tokenGuardId: web3.PublicKey,
  connection: web3.Connection
): Promise<TokenGuardState> => {
  // anchor needs a wallet, even if we are just doing a lookup query,
  // so we create a dummy wallet here
  const dummyWallet = new anchor.Wallet(web3.Keypair.generate());

  const provider = new anchor.Provider(connection, dummyWallet, {
    preflightCommitment: "recent",
  });

  const program = await fetchProgram(provider);
  const tokenGuardAccountPromise =
    program.account.tokenGuard.fetch(tokenGuardId);
  const mintAuthorityPromise = deriveMintAuthority(tokenGuardId, program);

  const [tokenGuardAccount, [mintAuthority]] = await Promise.all([
    tokenGuardAccountPromise,
    mintAuthorityPromise,
  ]);

  // TODO fix anchor types here
  const membershipToken = makeMembershipTokenDetails(
    tokenGuardAccount as unknown as TokenGuardMembershipTokenState
  );

  return {
    id: tokenGuardId,
    outMint: tokenGuardAccount.outMint,
    recipient: tokenGuardAccount.recipient,
    mintAuthority,
    gatekeeperNetwork: tokenGuardAccount.gatekeeperNetwork,
    membershipToken,
  };
};

export const getTokenWallet = async (
  wallet: web3.PublicKey,
  mint: web3.PublicKey
) =>
  (
    await web3.PublicKey.findProgramAddress(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    )
  )[0];

export const deriveMintAuthority = async (
  tokenGuard: web3.PublicKey,
  program: Program<TokenGuard>
) => {
  return web3.PublicKey.findProgramAddress(
    [Buffer.from("token_guard_out_mint_authority"), tokenGuard.toBuffer()],
    program.programId
  );
};

export const deriveAllowanceAccount = async (
  tokenGuard: web3.PublicKey,
  sender: web3.PublicKey,
  program: Program<TokenGuard>
) => {
  return web3.PublicKey.findProgramAddress(
    [
      Buffer.from("token_guard_allowance_account"),
      tokenGuard.toBuffer(),
      sender.toBuffer(),
    ],
    program.programId
  );
};

export type TokenGuardMembershipTokenState = {
  membershipToken?: web3.PublicKey;
  strategy?: any;
};

const getRemainingAccountsSPL = (
  membershipTokenDetails: MembershipToken,
  membershipTokenAccount: web3.PublicKey
): web3.AccountMeta[] => [
  {
    pubkey: membershipTokenAccount,
    isWritable: false,
    isSigner: false,
  },
];

const getRemainingAccountsNFTUA = async (
  connection: web3.Connection,
  membershipTokenDetails: MembershipToken,
  membershipTokenAccount: web3.PublicKey
): Promise<web3.AccountMeta[]> => {
  const tokenAccountResponse = await connection.getParsedAccountInfo(
    membershipTokenAccount
  );

  const mintString = (
    (tokenAccountResponse.value?.data as web3.ParsedAccountData)?.parsed
      ?.info as AccountInfo
  )?.mint;
  if (!mintString)
    throw new Error("No mint found for membership token account");

  const mint = new web3.PublicKey(mintString);
  const metadata = await Metadata.getPDA(mint);

  return [
    {
      pubkey: membershipTokenAccount,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: mint,
      isWritable: false,
      isSigner: false,
    },
    {
      pubkey: metadata,
      isWritable: false,
      isSigner: false,
    },
  ];
};

export const getRemainingAccounts = async (
  connection: web3.Connection,
  tokenGuard: TokenGuardMembershipTokenState,
  membershipTokenAccount?: web3.PublicKey
): Promise<web3.AccountMeta[]> => {
  const membershipTokenDetails = makeMembershipTokenDetails(tokenGuard);
  if (!membershipTokenDetails) return [];

  if (!membershipTokenAccount) {
    throw new Error("Membership token account not found");
  }

  switch (membershipTokenDetails.strategy) {
    case "SPL":
      return getRemainingAccountsSPL(
        membershipTokenDetails,
        membershipTokenAccount
      );
    case "NFT-UA":
      return getRemainingAccountsNFTUA(
        connection,
        membershipTokenDetails,
        membershipTokenAccount
      );
    case "NFT-Creator":
    // return getRemainingAccountsNFTCreator(membershipTokenDetails, membershipTokenAccount);
    default:
      throw new Error(`Unknown strategy: ${membershipTokenDetails.strategy}`);
  }
};
