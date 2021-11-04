import * as chai from 'chai';
import * as anchor from '@project-serum/anchor';
import {BN, Program, web3} from '@project-serum/anchor';
import {ASSOCIATED_TOKEN_PROGRAM_ID, MintLayout, Token, TOKEN_PROGRAM_ID} from "@solana/spl-token";
import { TokenGuard } from '../target/types/token_guard';

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
  const gatekeeperNetwork = web3.Keypair.generate().publicKey;

  // the mint account of the tokens that will be minted by the tokenGuard
  const mint = web3.Keypair.generate();

  const program = anchor.workspace.TokenGuard as Program<TokenGuard>;

  let mintAuthority: web3.PublicKey;
  let mintAuthorityBump: number;

  // the token account of the SOL sender, to store the minted tokens in
  let senderAta: web3.PublicKey;

  let tokenGuardAccount;

  let listenerId: number;

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

    await program.rpc.initialize(gatekeeperNetwork, mintAuthorityBump, {
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
    expect(tokenGuardAccount.gatekeeperNetwork.toString()).to.equal(gatekeeperNetwork.toString())
  });

  it('exchanges sol for tokens', async () => {
    const exchange_amount = 1_000;
    const top_up_amount = exchange_amount + 10_000;

    // fund the sender
    await provider.send(
      new web3.Transaction().add(web3.SystemProgram.transfer({
          fromPubkey: provider.wallet.publicKey,
          toPubkey: sender.publicKey,
          lamports: top_up_amount,
        }
      )));

    console.log(await provider.connection.getBalance(sender.publicKey));

    // sender exchanges sol for tokens
    const txSig = await program.rpc.exchange(new BN(exchange_amount), {
      accounts: {
        tokenGuard: tokenGuard.publicKey,
        payer: sender.publicKey,
        payerAta: senderAta,
        recipient: recipient.publicKey,
        outMint: mint.publicKey,
        mintAuthority: mintAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      },
      signers: [sender],
      instructions:  [
        // TODO configure this to send zero lamports, so that the token disappears after the tx
        Token.createAssociatedTokenAccountInstruction(
          ASSOCIATED_TOKEN_PROGRAM_ID,
          TOKEN_PROGRAM_ID,
          mint.publicKey,
          senderAta,
          sender.publicKey,
          provider.wallet.publicKey,
        )
      ]
    });

    console.log("Sig " + txSig);
    await provider.connection.confirmTransaction(txSig, 'finalized')
    console.log("Confirmed");

    console.log(await provider.connection.getBalance(sender.publicKey));

    const balance = await provider.connection.getBalance(recipient.publicKey, 'processed');
    console.log(`balance for ${recipient.publicKey} ${balance}`);

    expect(balance).to.equal(exchange_amount);
  })

});
