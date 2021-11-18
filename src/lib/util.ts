import * as anchor from "@project-serum/anchor";
import {Program, web3} from "@project-serum/anchor";
import {TOKEN_PROGRAM_ID} from "@solana/spl-token";
import { TokenGuard } from "../../target/types/token_guard";

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

export const getTokenWallet = async (
  wallet: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey
) =>
  (
    await anchor.web3.PublicKey.findProgramAddress(
      [wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
    )
  )[0];

export const deriveMintAuthority = async (tokenGuard: anchor.web3.PublicKey, program: Program<TokenGuard>) => {
  return web3.PublicKey.findProgramAddress([
      Buffer.from('token_guard_out_mint_authority'),
      tokenGuard.toBuffer(),
    ],
    program.programId);
};
