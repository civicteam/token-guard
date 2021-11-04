mod utils;

use {
  crate::utils::{assert_initialized, assert_owned_by, spl_token_transfer, TokenTransferParams},
  anchor_lang::{
    prelude::*, solana_program::system_program, AnchorDeserialize, AnchorSerialize,
    Discriminator, Key,
  },
  anchor_spl::token::TokenAccount,
  // arrayref::array_ref,
  solana_gateway::Gateway,
  spl_token::state::{Account, Mint},
  std::cell::Ref,
};

declare_id!("tg7bdEQom2SZT1JB2d77RDJFYaL4eZ2FcM8HZZAg5Z8");

const MINT_AUTHORITY_SEED: &[u8; 30] = br"token_guard_out_mint_authority";

#[program]
pub mod token_guard {
  use super::*;
  use anchor_lang::{
    solana_program::{
      program_option::COption,
      program::{invoke, invoke_signed},
      system_instruction
    }
  };
  use crate::utils::{spl_token_mint, TokenMintParams};



  pub fn initialize(ctx: Context<Initialize>, gatekeeper_network: Pubkey, mint_authority_bump: u8) -> ProgramResult {
    let token_guard = &mut ctx.accounts.token_guard;

    // check out_mint - TODO move these to anchor guards
    let out_mint_info = &ctx.accounts.out_mint;
    token_guard.mint_authority_bump = mint_authority_bump;
    let token_mint: Mint = assert_initialized(&out_mint_info)?;
    // let token_account: Account = assert_initialized(&ctx.accounts.recipient_ata)?;

    assert_owned_by(&out_mint_info, &spl_token::id())?;
    // assert_owned_by(&ctx.accounts.recipient_ata, &spl_token::id())?;

    // if token_account.mint != *in_mint_info.key {
    //   return Err(ErrorCode::MintMismatch.into());
    // }

    if let COption::Some(token_mint_authority) = token_mint.mint_authority {
      if token_mint_authority != *ctx.accounts.mint_authority.key {
        msg!("token mint authority {}", token_mint_authority);
        return Err(ErrorCode::MintAuthorityMismatch.into());
      }
    } else {
      msg!("token mint has no authority");
      return Err(ErrorCode::MintAuthorityMismatch.into());
    }

    token_guard.authority = *ctx.accounts.authority.key;
    token_guard.gatekeeper_network = gatekeeper_network;
    token_guard.recipient = *ctx.accounts.recipient.key;
    // token_guard.recipient_ata = *ctx.accounts.recipient_ata.key;
    token_guard.out_mint = *ctx.accounts.out_mint.key;

    Ok(())
  }

  pub fn exchange(ctx: Context<Exchange>, lamports: u64) -> ProgramResult {
    let token_guard = &mut ctx.accounts.token_guard;

    // match candy_machine.data.go_live_date {
    //   None => {
    //     if *ctx.accounts.payer.key != candy_machine.authority {
    //       return Err(ErrorCode::CandyMachineNotLiveYet.into());
    //     }
    //   }
    //   Some(val) => {
    //     if clock.unix_timestamp < val {
    //       if *ctx.accounts.payer.key != candy_machine.authority {
    //         return Err(ErrorCode::CandyMachineNotLiveYet.into());
    //       }
    //     }
    //   }
    // }


    //   // validate the gateway token
    //   assert_eq!(ctx.remaining_accounts.len() > 0, true);
    //   let last_account = ctx.remaining_accounts.last().unwrap();
    //   verify_gateway_token(&ctx.accounts.payer, last_account, gatekeeper_network)?;

    if ctx.accounts.payer.lamports() < lamports {
      return Err(ErrorCode::NotEnoughSOL.into());
    }

    msg!("Sending {} lamports from {} to {}", lamports, ctx.accounts.payer.key, ctx.accounts.recipient.key);
    invoke(
      &system_instruction::transfer(
        &ctx.accounts.payer.key,
        ctx.accounts.recipient.key,
        lamports,
      ),
      &[
        ctx.accounts.payer.to_account_info().clone(),
        ctx.accounts.recipient.to_account_info().clone(),
        ctx.accounts.system_program.clone(),
      ],
    )?;
    msg!("Transfer complete");

    let token_account: Account = assert_initialized(&ctx.accounts.payer_ata)?;
    if token_account.mint != token_guard.out_mint {
      return Err(ErrorCode::MintMismatch.into());
    }

    spl_token_mint(TokenMintParams {
      mint: ctx.accounts.out_mint.clone(),
      destination: ctx.accounts.payer_ata.clone(),
      mint_authority: ctx.accounts.mint_authority.clone(),
      authority_signer_seeds: &[
        MINT_AUTHORITY_SEED,
        &ctx.accounts.token_guard.to_account_info().key.to_bytes(),
        &ctx.program_id.clone().to_bytes(),
        &[ctx.accounts.token_guard.mint_authority_bump]
      ],
      token_program: ctx.accounts.token_program.clone(),
      amount: lamports,
    })?;

    Ok(())
  }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
  #[account(init, payer = authority, space = 8 + 32 + 32 + 32 + 32 + 1)]
  token_guard: ProgramAccount<'info, TokenGuard>,
  #[account(mut)]
  authority: Signer<'info>,
  #[account()]
  // out_mint: ProgramAccount<'info, anchor_spl::token::Mint>,
  out_mint: AccountInfo<'info>,
  // #[account(seeds = [mint], bump=?, owner = anchor_spl::token::Mint)]
  #[account()]
  mint_authority: AccountInfo<'info>,
  #[account()]
  recipient: AccountInfo<'info>,
  // #[account(seeds = [recipient, in_mint], bump=0, owner = anchor_spl::associated_token::AssociatedToken::id())]
  // recipient_ata: AccountInfo<'info>,
  token_program: Program<'info, anchor_spl::token::Token>,
  system_program: Program<'info, System>,
  rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Exchange<'info> {
  #[account(
  // has_one = out_mint,
  // has_one = recipient_ata,
  // has_one = recipient,
  // has_one = mint_authority
  )]
  token_guard: ProgramAccount<'info, TokenGuard>,
  #[account(mut)]
  payer: Signer<'info>,
  // #[account(seeds = [recipient, mint], bump=0, owner = anchor_spl::associated_token::AssociatedToken::id())]
  #[account()]
  payer_ata: AccountInfo<'info>,
  #[account(mut, address = token_guard.out_mint)]
  // out_mint: ProgramAccount<'info, anchor_spl::token::Mint>,
  out_mint: AccountInfo<'info>,
  #[account(mut)]
  recipient: AccountInfo<'info>,
  #[account()]
  mint_authority: AccountInfo<'info>,
  #[account(address = spl_token::id())]
  token_program: AccountInfo<'info>,
  #[account(address = system_program::ID)]
  system_program: AccountInfo<'info>,
}


#[account]
#[derive(Default)]
pub struct TokenGuard {
  pub authority: Pubkey,
  pub recipient: Pubkey,
  // pub recipient_ata: Pubkey,
  pub gatekeeper_network: Pubkey,
  pub out_mint: Pubkey,
  pub mint_authority_bump: u8,
  // pub in_mint: Option<Pubkey>,
  // pub start_time: Option<i64>,
  // pub max_amount: Option<u64>,
  // pub gt_expiry_tolerance: u32,
}

#[error]
pub enum ErrorCode {
  #[msg("Account does not have correct owner!")]
  IncorrectOwner,
  #[msg("Account is not initialized!")]
  Uninitialized,
  #[msg("Mint Mismatch!")]
  MintMismatch,
  #[msg("Mint AuthorityMismatch!")]
  MintAuthorityMismatch,
  #[msg("Not enough tokens to pay for this minting")]
  NotEnoughTokens,
  #[msg("Not enough SOL to pay for this minting")]
  NotEnoughSOL,
  #[msg("Token transfer failed")]
  TokenTransferFailed,
}
