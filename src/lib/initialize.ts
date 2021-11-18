import * as anchor from "@project-serum/anchor";

import {
  MintLayout,
  Token,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {TransactionSignature} from "@solana/web3.js";
import { TokenGuard } from "../../target/types/token_guard";
import {Program, web3} from "@project-serum/anchor";
import {deriveMintAuthority, TokenGuardState} from "./util";

export const initialize = async (
  program: Program<TokenGuard>,
  provider: anchor.Provider,
  gatekeeperNetwork: anchor.web3.PublicKey,
  recipient: anchor.web3.PublicKey,
): Promise<TokenGuardState> => {
  const tokenGuard = web3.Keypair.generate();
  const mint = web3.Keypair.generate();
  const [mintAuthority, mintAuthorityBump] = await deriveMintAuthority(tokenGuard.publicKey, program);

  await program.rpc.initialize(gatekeeperNetwork, mintAuthorityBump, {
    accounts: {
      tokenGuard: tokenGuard.publicKey,
      recipient: recipient,
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

  return {
    gatekeeperNetwork,
    id: tokenGuard.publicKey,
    mintAuthority,
    outMint: mint.publicKey,
    recipient
  }
}
