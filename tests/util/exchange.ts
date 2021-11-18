import * as anchor from "@project-serum/anchor";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {TransactionInstruction} from "@solana/web3.js";
import BN from "bn.js";
import { TokenGuard } from "../../target/types/token_guard";
import {Program, web3} from "@project-serum/anchor";

const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new anchor.web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

export interface TokenGuardState {
  id: anchor.web3.PublicKey,
  outMint: anchor.web3.PublicKey,
  recipient: anchor.web3.PublicKey
  mintAuthority: anchor.web3.PublicKey;
  gatekeeperNetwork: anchor.web3.PublicKey;
}

const getTokenWallet = async (
  wallet: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey
) =>
  (
    await anchor.web3.PublicKey.findProgramAddress(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    )
  )[0];

export const exchange = async (
  program: Program<TokenGuard>,
  tokenGuard: anchor.web3.PublicKey,
  sender: anchor.web3.PublicKey,
  payer: anchor.web3.PublicKey,
  gatewayToken: anchor.web3.PublicKey,
  amount: number,
): Promise<TransactionInstruction[]> => {
  const tokenGuardAccount = await program.account.tokenGuard.fetch(tokenGuard);
  const senderAta = await getTokenWallet(sender, tokenGuardAccount.outMint);

  const [mintAuthority] = await web3.PublicKey.findProgramAddress([
      Buffer.from('token_guard_out_mint_authority'),
      tokenGuard.toBuffer(),
    ],
    program.programId);

  const createATAInstruction = Token.createAssociatedTokenAccountInstruction(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      tokenGuardAccount.outMint,
      senderAta,
      sender,
      payer,
    );

  const closeATAInstruction = Token.createCloseAccountInstruction(
    TOKEN_PROGRAM_ID,
    senderAta,
    sender,
    sender,
    []
  );

  const exchangeInstruction = program.instruction.exchange(new BN(amount), {
    accounts: {
      tokenGuard: tokenGuard,
      payer: sender,
      payerAta: senderAta,
      recipient: tokenGuardAccount.recipient,
      outMint: tokenGuardAccount.outMint,
      mintAuthority,
      gatewayToken: gatewayToken,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
      clock: web3.SYSVAR_CLOCK_PUBKEY
    }
  });

  return [createATAInstruction, closeATAInstruction, exchangeInstruction]
}
