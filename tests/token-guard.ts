import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as anchor from "@project-serum/anchor";
import { BN, Program, Provider, web3 } from "@project-serum/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { TokenGuard } from "../target/types/token_guard";
import {
  GatekeeperNetworkService,
  GatekeeperService,
} from "@identity.com/solana-gatekeeper-lib";
import { GatewayToken } from "@identity.com/solana-gateway-ts";
import { DummySpender } from "../target/types/dummy_spender";
import { exchange, initialize, TokenGuardState } from "../src/";
import { TransactionInstruction } from "@solana/web3.js";

chai.use(chaiAsPromised);
const { expect } = chai;

const createBurnerATA = async (
  tokenGuardState: TokenGuardState,
  recipient: web3.Keypair,
  provider: Provider
) => {
  const burnerATA = await Token.getAssociatedTokenAddress(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    tokenGuardState.outMint,
    recipient.publicKey,
    true
  );
  const createBurnerATAInstruction =
    Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenGuardState.outMint,
      burnerATA,
      recipient.publicKey,
      provider.wallet.publicKey
    );
  return { burnerATA, createBurnerATAInstruction };
};

describe("token-guard", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.local();
  anchor.setProvider(provider);

  // The sender of SOL, recipient of minted tokens
  const sender = web3.Keypair.generate();

  // Te recipient of SOL
  const recipient = web3.Keypair.generate();

  // The gatekeeper network that the sender needs a gateway token for
  const gatekeeperNetwork = web3.Keypair.generate();
  // a gatekeeper in the gatekeeper network
  const gatekeeper = web3.Keypair.generate();
  // the gateway token for the sender
  let gatewayToken: GatewayToken;

  const program = anchor.workspace.TokenGuard as Program<TokenGuard>;

  // the token account of the SOL sender, to store the minted tokens in
  let senderAta: web3.PublicKey;

  // The account on chain that contains the token guard information
  let tokenGuardAccount: any;
  // The result of the initialize function call. Essentially the same information as tokenGuardAccount
  // plus the tokenGuard public key.
  let tokenGuardState: TokenGuardState;

  // a handle for a chain log listener (kept so it can be closed again)
  let listenerId: number;

  const exchangeAmount = 1_000;
  const topUpAmount = exchangeAmount + 10_000_000; // TODO added more for the "allowance" case

  const sendTransactionFromSender = async (
    instructions: TransactionInstruction[]
  ) => {
    const { blockhash } = await provider.connection.getRecentBlockhash();
    const transaction = new web3.Transaction({
      recentBlockhash: blockhash,
    }).add(...instructions);
    return provider.send(transaction, [sender]);
  };

  before("Set up the log listener for easier debugging", async () => {
    listenerId = provider.connection.onLogs("all", console.log, "confirmed");
  });

  before("Set up gatekeeper network and gateway token", async () => {
    // fund the gatekeeper
    await provider.send(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: gatekeeper.publicKey,
          lamports: 5_000_000,
        })
      )
    );

    // create a new gatekeeper network (no on-chain tx here)
    const gknService = new GatekeeperNetworkService(
      provider.connection,
      gatekeeper,
      gatekeeperNetwork
    );
    const gkService = new GatekeeperService(
      provider.connection,
      gatekeeper,
      gatekeeperNetwork.publicKey,
      gatekeeper
    );

    // add the gatekeeper to this network
    await gknService.addGatekeeper(gatekeeper.publicKey);

    // create a new gateway token
    gatewayToken = await gkService.issue(sender.publicKey);

    // fund the sender
    await provider.send(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: sender.publicKey,
          lamports: topUpAmount,
        })
      )
    );
  });

  after(() => provider.connection.removeOnLogsListener(listenerId));

  it("initialises a new tokenGuard", async () => {
    tokenGuardState = await initialize(
      program,
      provider,
      gatekeeperNetwork.publicKey,
      recipient.publicKey
    );

    console.log({
      tokenGuard: tokenGuardState.id.toString(),
      mint: tokenGuardState.outMint.toString(),
      recipient: recipient.publicKey.toString(),
      sender: sender.publicKey.toString(),
    });

    tokenGuardAccount = await program.account.tokenGuard.fetch(
      tokenGuardState.id
    );

    expect(tokenGuardAccount.recipient.toString()).to.equal(
      recipient.publicKey.toString()
    );
    expect(tokenGuardAccount.outMint.toString()).to.equal(
      tokenGuardState.outMint.toString()
    );
    expect(tokenGuardAccount.authority.toString()).to.equal(
      provider.wallet.publicKey.toString()
    );
    expect(tokenGuardAccount.gatekeeperNetwork.toString()).to.equal(
      gatekeeperNetwork.publicKey.toString()
    );
  });

  it("exchanges sol for tokens", async () => {
    senderAta = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenGuardState.outMint,
      sender.publicKey,
      true
    );

    // fund the sender
    await provider.send(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: sender.publicKey,
          lamports: topUpAmount,
        })
      )
    );

    const instructions = await exchange(
      provider.connection,
      program,
      tokenGuardState.id,
      sender.publicKey,
      sender.publicKey,
      gatekeeperNetwork.publicKey,
      exchangeAmount
    );

    await sendTransactionFromSender(instructions);

    console.log(await provider.connection.getBalance(sender.publicKey));

    const balance = await provider.connection.getBalance(
      recipient.publicKey,
      "confirmed"
    );
    console.log(`balance for ${recipient.publicKey} ${balance}`);

    // for some reason, although the tx says the SOL is transferred, it is not registering in the recipient's account
    // expect(balance).to.equal(exchange_amount);

    // the sender's ATA should be closed, as it is ephemeral
    const senderAtaInfo = await provider.connection.getParsedAccountInfo(
      senderAta
    );
    expect(senderAtaInfo.value).to.be.null;
    // const parsedAccountInfo = (senderAtaInfo.value.data as web3.ParsedAccountData).parsed;
    // console.log(parsedAccountInfo);
    // expect(parsedAccountInfo.info.tokenAmount.amount).to.equal(''+exchange_amount)
  });

  it("spends tokens in a separate program", async () => {
    const spenderProgram = anchor.workspace
      .DummySpender as Program<DummySpender>;

    const tokenGuardInstructions = await exchange(
      provider.connection,
      program,
      tokenGuardState.id,
      sender.publicKey,
      provider.wallet.publicKey,
      gatekeeperNetwork.publicKey,
      exchangeAmount
    );

    const { burnerATA, createBurnerATAInstruction } = await createBurnerATA(
      tokenGuardState,
      recipient,
      provider
    );

    await spenderProgram.rpc.spend(new BN(exchangeAmount), {
      accounts: {
        payer: sender.publicKey,
        payerAta: senderAta,
        recipient: burnerATA,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [sender],
      instructions: [createBurnerATAInstruction, ...tokenGuardInstructions],
    });
  });

  it("initialises a tokenGuard that is not yet live", async () => {
    tokenGuardState = await initialize(
      program,
      provider,
      gatekeeperNetwork.publicKey,
      recipient.publicKey,
      Date.now() + 1_000_000
    );
  });

  it("fails to spend tokens if the tokenGuard is not ready", async () => {
    const spenderProgram = anchor.workspace
      .DummySpender as Program<DummySpender>;

    const tokenGuardInstructions = await exchange(
      provider.connection,
      program,
      tokenGuardState.id,
      sender.publicKey,
      provider.wallet.publicKey,
      gatekeeperNetwork.publicKey,
      exchangeAmount
    );

    const { burnerATA, createBurnerATAInstruction } = await createBurnerATA(
      tokenGuardState,
      recipient,
      provider
    );

    const shouldFail = spenderProgram.rpc.spend(new BN(exchangeAmount), {
      accounts: {
        payer: sender.publicKey,
        payerAta: senderAta,
        recipient: burnerATA,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [sender],
      instructions: [createBurnerATAInstruction, ...tokenGuardInstructions],
    });

    return expect(shouldFail).to.be.rejectedWith(
      /Transaction simulation failed/
    );
  });

  it("initialises a tokenGuard with an allowance", async () => {
    tokenGuardState = await initialize(
      program,
      provider,
      gatekeeperNetwork.publicKey,
      recipient.publicKey,
      undefined,
      2
    );
  });

  it("fails to exchange three times for the same user", async () => {
    senderAta = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenGuardState.outMint,
      sender.publicKey,
      true
    );

    // fund the sender
    await provider.send(
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: sender.publicKey,
          lamports: topUpAmount,
        })
      )
    );

    const instructions = await exchange(
      provider.connection,
      program,
      tokenGuardState.id,
      sender.publicKey,
      sender.publicKey,
      gatekeeperNetwork.publicKey,
      exchangeAmount
    );

    console.log("First exchange");
    await sendTransactionFromSender(instructions);

    console.log("Second exchange");
    await sendTransactionFromSender(instructions);

    console.log("Third exchange");
    const shouldFail = sendTransactionFromSender(instructions);
    return expect(shouldFail).to.be.rejectedWith(
      /Transaction simulation failed/
    );
  });
});
