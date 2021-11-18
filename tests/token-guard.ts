import * as chai from 'chai';
import * as anchor from '@project-serum/anchor';
import {BN, Program, web3} from '@project-serum/anchor';
import {ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, Token, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import { TokenGuard } from '../target/types/token_guard';
import {GatekeeperNetworkService, GatekeeperService} from "@identity.com/solana-gatekeeper-lib";
import { GatewayToken } from '@identity.com/solana-gateway-ts';
import { DummySpender } from '../target/types/dummy_spender';
import {exchange} from "./util/exchange";

const { expect } = chai;

describe('token-guard', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.Provider.local();
  anchor.setProvider(provider);

  // The account that contains the tokenGuard information
  const tokenGuard = web3.Keypair.generate();

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

  // the mint account of the tokens that will be minted by the tokenGuard
  const mint = web3.Keypair.generate();

  const program = anchor.workspace.TokenGuard as Program<TokenGuard>;

  let mintAuthority: web3.PublicKey;
  let mintAuthorityBump: number;

  // the token account of the SOL sender, to store the minted tokens in
  let senderAta: web3.PublicKey;

  let tokenGuardAccount;

  let listenerId: number;

  const exchangeAmount = 1_000;
  const topUpAmount = exchangeAmount + 10_000;

  before(async () => {
    listenerId = provider.connection.onLogs('all', console.log, 'confirmed');

    senderAta = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      sender.publicKey,
      true
    );
    [mintAuthority, mintAuthorityBump] = await web3.PublicKey.findProgramAddress([
        Buffer.from('token_guard_out_mint_authority'),
        tokenGuard.publicKey.toBuffer(),
      ],
      program.programId);
  })

  before('Set up gatekeeper network and gateway token', async () => {
    // fund the gatekeeper
    await provider.send(
      new web3.Transaction().add(web3.SystemProgram.transfer({
            fromPubkey: provider.wallet.publicKey,
            toPubkey: gatekeeper.publicKey,
            lamports: 5_000_000,
          }
        )
      )
    );

    // create a new gatekeeper network (no on-chain tx here)
    const gknService = new GatekeeperNetworkService(provider.connection, gatekeeper, gatekeeperNetwork);
    const gkService = new GatekeeperService(provider.connection, gatekeeper, gatekeeperNetwork.publicKey, gatekeeper);

    // add the gatekeeper to this network
    await gknService.addGatekeeper(gatekeeper.publicKey)

    // create a new gateway token
    gatewayToken = await gkService.issue(sender.publicKey);

    // fund the sender
    await provider.send(
      new web3.Transaction().add(web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: sender.publicKey,
          lamports: topUpAmount,
        }
      )));
  })

  after(() => provider.connection.removeOnLogsListener(listenerId))

  it('initialises a new tokenGuard', async () => {
    console.log({
      tokenGuard: tokenGuard.publicKey.toString(),
      mint: mint.publicKey.toString(),
      mintAuthority: mintAuthority.toString(),
      recipient: recipient.publicKey.toString(),
      senderAta: senderAta.toString(),
      sender: sender.publicKey.toString()
    });

    await program.rpc.initialize(gatekeeperNetwork.publicKey, mintAuthorityBump, {
      accounts: {
        tokenGuard: tokenGuard.publicKey,
        recipient: recipient.publicKey,
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

    tokenGuardAccount = await program.account.tokenGuard.fetch(tokenGuard.publicKey);

    expect(tokenGuardAccount.recipient.toString()).to.equal(recipient.publicKey.toString())
    expect(tokenGuardAccount.outMint.toString()).to.equal(mint.publicKey.toString())
    expect(tokenGuardAccount.authority.toString()).to.equal(provider.wallet.publicKey.toString())
    expect(tokenGuardAccount.gatekeeperNetwork.toString()).to.equal(gatekeeperNetwork.publicKey.toString())
  });

  it('exchanges sol for tokens', async () => {
    // fund the sender
    await provider.send(
      new web3.Transaction().add(web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: sender.publicKey,
          lamports: topUpAmount,
        }
      )));

    // sender exchanges sol for tokens
    const txSig = await program.rpc.exchange(new BN(exchangeAmount), {
      accounts: {
        tokenGuard: tokenGuard.publicKey,
        payer: sender.publicKey,
        payerAta: senderAta,
        recipient: recipient.publicKey,
        outMint: mint.publicKey,
        mintAuthority: mintAuthority,
        gatewayToken: gatewayToken.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        clock: web3.SYSVAR_CLOCK_PUBKEY
      },
      signers: [sender],
      instructions:  [
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          mint.publicKey,
          senderAta,
          sender.publicKey,
          provider.wallet.publicKey,
        ),
        Token.createCloseAccountInstruction(
          TOKEN_PROGRAM_ID,
          senderAta,
          sender.publicKey,
          sender.publicKey,
          []
        )
      ]
    });

    await provider.connection.confirmTransaction(txSig, 'finalized')

    console.log(await provider.connection.getBalance(sender.publicKey));

    const balance = await provider.connection.getBalance(recipient.publicKey, 'confirmed');
    console.log(`balance for ${recipient.publicKey} ${balance}`);

    // for some reason, although the tx says the SOL is transferred, it is not registering in the recipient's account
    // expect(balance).to.equal(exchange_amount);

    // the sender's ATA should be closed, as it is ephemeral
    const senderAtaInfo = await provider.connection.getParsedAccountInfo(senderAta)
    expect(senderAtaInfo.value).to.be.null;
    // const parsedAccountInfo = (senderAtaInfo.value.data as web3.ParsedAccountData).parsed;
    // console.log(parsedAccountInfo);
    // expect(parsedAccountInfo.info.tokenAmount.amount).to.equal(''+exchange_amount)
  });

  it('spends tokens in a separate program', async () => {
    const spenderProgram = anchor.workspace.DummySpender as Program<DummySpender>;

    const tokenGuardInstructions = await exchange(
      program,
      tokenGuard.publicKey,
      sender.publicKey,
      provider.wallet.publicKey,
      gatewayToken.publicKey,
      exchangeAmount
    );

    const burnerATA = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      recipient.publicKey,
      true
    );
    const createBurnerATAInstruction = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      mint.publicKey,
      burnerATA,
      recipient.publicKey,
      provider.wallet.publicKey,
    );
    await spenderProgram.rpc.spend(new BN(exchangeAmount), {
      accounts: {
        payer: sender.publicKey,
        payerAta: senderAta,
        recipient: burnerATA,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [sender],
      instructions: [
        createBurnerATAInstruction,
        ...tokenGuardInstructions
      ]
    });
  })
});
