import * as anchor from "@project-serum/anchor";
import {ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, Token, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {GatewayToken} from "@identity.com/solana-gateway-ts";

const { web3 } = anchor;

const TOKEN_GUARD_PROGRAM_ID = new web3.PublicKey("H9Jq41uKokQYHU3FKJPZ4xNqHR17HcCb6tMYkJJSyf7b");
const IGNITE_PASS_GATEKEEPER_NETWORK = new web3.PublicKey("ignREusXmGrscGNUesoU9mxfds9AiYTezUKex2PsZV6");

(async () => {
  const provider = anchor.Provider.local(web3.clusterApiUrl('devnet'), { commitment: 'confirmed'} );
  anchor.setProvider(provider);

  const idl = await anchor.Program.fetchIdl(
    TOKEN_GUARD_PROGRAM_ID,
    provider
  );

  const program = new anchor.Program(idl!, TOKEN_GUARD_PROGRAM_ID, provider);

  const tokenGuard = web3.Keypair.generate();

  // the mint account of the tokens that will be minted by the tokenGuard
  const mint = web3.Keypair.generate();

  const [mintAuthority, mintAuthorityBump] = await web3.PublicKey.findProgramAddress([
      Buffer.from('token_guard_out_mint_authority'),
      tokenGuard.publicKey.toBuffer(),
    ],
    program.programId);

  await program.rpc.initialize(IGNITE_PASS_GATEKEEPER_NETWORK, mintAuthorityBump, {
    accounts: {
      tokenGuard: tokenGuard.publicKey,
      recipient: provider.wallet.publicKey,
      authority: provider.wallet.publicKey,
      outMint: mint.publicKey,
      mintAuthority: mintAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: web3.SystemProgram.programId,
      rent: web3.SYSVAR_RENT_PUBKEY
    },
    signers: [tokenGuard, mint],
    instructions: [
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MintLayout.span,
        lamports:
          await provider.connection.getMinimumBalanceForRentExemption(
            MintLayout.span
          ),
        programId: TOKEN_PROGRAM_ID,
      }),
      Token.createInitMintInstruction(
        TOKEN_PROGRAM_ID,
        mint.publicKey,
        0,
        mintAuthority,
        mintAuthority
      )
    ],
  });

  console.log("Mint: " + mint.publicKey);


  // // The sender of SOL, recipient of minted tokens
  // const sender = web3.Keypair.generate();
  // const senderAta = await Token.getAssociatedTokenAddress(
  //   ASSOCIATED_TOKEN_PROGRAM_ID,
  //   TOKEN_PROGRAM_ID,
  //   mint.publicKey,
  //   sender.publicKey,
  //   true
  // );


})().catch(console.error);
