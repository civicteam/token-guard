import { findGatewayToken } from "@identity.com/solana-gateway-ts";
import * as anchor from "@project-serum/anchor";
import { Program, web3 } from "@project-serum/anchor";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { TokenGuard } from "../../target/types/token_guard";
import {
  deriveAllowanceAccount,
  deriveMintAuthority,
  getRemainingAccounts,
  getTokenWallet,
  TokenGuardMembershipTokenState,
} from "./util";

export const exchange = async (
  connection: anchor.web3.Connection,
  program: Program<TokenGuard>,
  tokenGuard: anchor.web3.PublicKey,
  sender: anchor.web3.PublicKey,
  payer: anchor.web3.PublicKey,
  gatekeeperNetwork: anchor.web3.PublicKey,
  amount: number,
  membershipTokenAccount?: anchor.web3.PublicKey
): Promise<TransactionInstruction[]> => {
  const tokenGuardAccount = await program.account.tokenGuard.fetch(tokenGuard);
  const senderAta = await getTokenWallet(sender, tokenGuardAccount.outMint);

  const gatewayToken = await findGatewayToken(
    connection,
    sender,
    gatekeeperNetwork
  );
  if (!gatewayToken) throw new Error("Wallet has no gateway token");

  const [mintAuthority] = await deriveMintAuthority(tokenGuard, program);

  const createATAInstruction = Token.createAssociatedTokenAccountInstruction(
    ASSOCIATED_TOKEN_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    tokenGuardAccount.outMint,
    senderAta,
    sender,
    payer
  );

  const closeATAInstruction = Token.createCloseAccountInstruction(
    TOKEN_PROGRAM_ID,
    senderAta,
    sender,
    sender,
    []
  );

  const [allowanceAccount, allowanceAccountBump] = await deriveAllowanceAccount(
    tokenGuard,
    sender,
    program
  );

  console.log({
    tokenGuard: tokenGuard.toString(),
    payer: sender.toString(),
    allowanceAccount: allowanceAccount.toString(),
    membershipTokenAccount: membershipTokenAccount?.toString(),
  });

  const remainingAccounts = await getRemainingAccounts(
    connection,
    tokenGuardAccount as unknown as TokenGuardMembershipTokenState,
    membershipTokenAccount
  );

  const exchangeInstruction = program.instruction.exchange(
    new BN(amount),
    allowanceAccountBump,
    {
      accounts: {
        tokenGuard: tokenGuard,
        payer: sender,
        payerAta: senderAta,
        recipient: tokenGuardAccount.recipient,
        outMint: tokenGuardAccount.outMint,
        mintAuthority,
        gatewayToken: gatewayToken.publicKey,
        allowanceAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        clock: web3.SYSVAR_CLOCK_PUBKEY,
        rent: web3.SYSVAR_RENT_PUBKEY,
      },
      remainingAccounts,
    }
  );

  return [createATAInstruction, closeATAInstruction, exchangeInstruction];
};
