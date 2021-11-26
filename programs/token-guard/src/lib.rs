mod utils;

use {
  crate::utils::{assert_initialized, assert_owned_by},
  anchor_lang::{
    prelude::*, solana_program::system_program, AnchorDeserialize, AnchorSerialize,
    Key,
  },
  solana_gateway::Gateway,
  spl_token::state::{Account, Mint},
};

declare_id!("tg7bdEQom2SZT1JB2d77RDJFYaL4eZ2FcM8HZZAg5Z8");

const MINT_AUTHORITY_SEED: &[u8; 30] = br"token_guard_out_mint_authority";
const ALLOWANCE_ACCOUNT_SEED: &[u8; 29] = br"token_guard_allowance_account";

#[program]
pub mod token_guard {
  use std::borrow::{BorrowMut};
  use std::io::Write;
  use super::*;
  use crate::utils::{spl_token_mint, TokenMintParams};
  use anchor_lang::solana_program::{
    program::invoke, program_option::COption, system_instruction,
  };
  use anchor_lang::solana_program::program::invoke_signed;

  pub fn initialize(
    ctx: Context<Initialize>,
    gatekeeper_network: Pubkey,
    mint_authority_bump: u8,
    start_time: Option<i64>,
    allowance: Option<u8>,
    max_amount: Option<u64>,
  ) -> ProgramResult {
    let token_guard = &mut ctx.accounts.token_guard;

    // check out_mint - TODO move these to anchor guards
    let out_mint_info = &ctx.accounts.out_mint;
    token_guard.mint_authority_bump = mint_authority_bump;
    let token_mint: Mint = assert_initialized(out_mint_info)?;
    // let token_account: Account = assert_initialized(&ctx.accounts.recipient_ata)?;

    assert_owned_by(out_mint_info, &spl_token::id())?;
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
    token_guard.start_time = start_time;
    // store zero as the "no allowance" rather than the extra byte an optional would require
    token_guard.allowance = allowance.unwrap_or_default();
    token_guard.max_amount = max_amount;

    Ok(())
  }

  pub fn exchange(ctx: Context<Exchange>, lamports: u64, allowance_account_bump: u8) -> ProgramResult {
    msg!("exchange");
    let token_guard = &ctx.accounts.token_guard;
    let allowance_account = &mut ctx.accounts.allowance_account;

    let clock = &ctx.accounts.clock;

    // Has the TokenGuard started?
    if let Some(start_time) = token_guard.start_time {
      if clock.unix_timestamp < start_time {
        msg!("Not live yet");
        return Err(ErrorCode::NotLiveYet.into());
      }
    }

    // Does the amount exceed the TokenGuard's maximum amount?
    if let Some(max_amount) = token_guard.max_amount {
      if lamports > max_amount {
        msg!("Amount exceeds maximum");
        return Err(ErrorCode::MaxAmountExceeded.into());
      }
    }

    // Is the Gateway Token valid?
    msg!(
            "Verifying gateway token {} on network {} belongs to {}",
            ctx.accounts.gateway_token.key,
            token_guard.gatekeeper_network,
            ctx.accounts.payer.key()
        );
    Gateway::verify_gateway_token_account_info(
      &ctx.accounts.gateway_token,
      &ctx.accounts.payer.key(),
      &token_guard.gatekeeper_network,
    )?;
    msg!("Gateway token verified");

    // Does the payer have enough funds?
    if ctx.accounts.payer.lamports() < lamports {
      return Err(ErrorCode::NotEnoughSOL.into());
    }

    // Is the payer's token account ephemeral?
    msg!("Checking token account is ephemeral");
    if ctx.accounts.payer_ata.lamports() != 0 {
      msg!("Token account is not ephemeral - has {} lamports", ctx.accounts.payer_ata.lamports());
      return Err(ErrorCode::TokenAccountNotEphemeral.into());
    }

    // Does the payer have a remaining allowance?
    msg!("Checking allowance");
    if token_guard.allowance > 0 {
      // token guard has an allowance requirement
      // if the allowance account does not exist, create it
      // if it exists, check if the value is already equal to the token guard allowance,
      // if so, error out, if not, increment it
      if allowance_account.owner == &id() {
        let mut allowance_program_account: ProgramAccount<AllowanceAccount> = ProgramAccount::try_from(&id(), allowance_account)?;
        if allowance_program_account.amount >= token_guard.allowance {
          msg!("Allowance of {} reached", allowance_program_account.amount);
          return Err(ErrorCode::AllowanceExceeded.into());
        } else {
          allowance_program_account.amount = allowance_program_account.amount + 1;
          allowance_program_account.exit(&id());
        }
      } else {
        let size = (1 + 8) as usize;
        // should match deriveAllowanceAccount in the client
        let allowance_account_signer_seeds: &[&[_]] = &[
          ALLOWANCE_ACCOUNT_SEED,
          &ctx.accounts.token_guard.key().to_bytes(),
          &ctx.accounts.payer.key.to_bytes(),
          &[allowance_account_bump],
        ];

        invoke_signed(
          &system_instruction::create_account(
            ctx.accounts.payer.key,
            allowance_account.borrow_mut().key,
            1.max(ctx.accounts.rent.minimum_balance(size)),
            size as u64,
            &id(),
          ),
          &[
            ctx.accounts.payer.to_account_info().clone(),
            allowance_account.to_account_info().clone(),
            ctx.accounts.system_program.clone(),
          ],
          &[allowance_account_signer_seeds],
        )?;

        let allowance: AllowanceAccount = AllowanceAccount { amount: 1 };
        let info = allowance_account.to_account_info();
        let mut data = info.try_borrow_mut_data()?;
        let dst: &mut [u8] = &mut data;
        let mut cursor = std::io::Cursor::new(dst);

        allowance.try_serialize(&mut cursor)?
      }
    }

    msg!(
            "Sending {} lamports from {} to {}",
            lamports,
            ctx.accounts.payer.key,
            ctx.accounts.recipient.key
        );
    invoke(
      &system_instruction::transfer(
        ctx.accounts.payer.key,
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
        &[ctx.accounts.token_guard.mint_authority_bump],
      ],
      token_program: ctx.accounts.token_program.clone(),
      amount: lamports,
    })?;

    Ok(())
  }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
  #[account(init, payer = authority, space = 8 + 32 + 32 + 32 + 32 + 1 + (1 + 8) + 1 + (1 + 8))]
  token_guard: ProgramAccount<'info, TokenGuard>,
  #[account(mut)]
  authority: Signer<'info>,
  #[account()]
  // out_mint: ProgramAccount<'info, anchor_spl::token::Mint>, CPI ACCOUNT OR WHATEVER
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
#[instruction(amount: u64, allowance_account_bump: u8)]
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
  // #[account(seeds = [payer, mint], bump=0, owner = anchor_spl::associated_token::AssociatedToken::id())]
  #[account(mut)]
  payer_ata: AccountInfo<'info>,
  #[account(mut, address = token_guard.out_mint)]
  // out_mint: ProgramAccount<'info, anchor_spl::token::Mint>,
  out_mint: AccountInfo<'info>,
  #[account(mut)]
  recipient: AccountInfo<'info>,
  #[account()]
  mint_authority: AccountInfo<'info>,
  #[account()]
  // #[account(owner = GatewayProgram)]
  // gateway_token: ProgramAccount<'info, GatewayProgram>,
  gateway_token: AccountInfo<'info>,
  // Anchor does not (yet) support conditional initialisation in the macros,
  // so we initialise the allowance account the old-fashioned way.
  // #[account(
  //   init = token_guard.allowance > 0,
  //   payer = payer,
  //   space = 8 + 1,  // 1 byte for the amount, 8 for metadata needed for all accounts
  //   // should match deriveAllowanceAccount in the client
  //   seeds=[
  //     ALLOWANCE_ACCOUNT_SEED.as_bytes(),
  //     token_guard.key().as_ref(),
  //     payer.key.as_ref(),
  //   ],
  //   bump=allowance_account_bump,
  // )]
  #[account(mut)]
  allowance_account: AccountInfo<'info>,//ProgramAccount<'info, AllowanceAccount>,
  #[account(address = spl_token::id())]
  token_program: AccountInfo<'info>,
  #[account(address = system_program::ID)]
  system_program: AccountInfo<'info>,
  clock: Sysvar<'info, Clock>,
  rent: Sysvar<'info, Rent>,
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
  pub start_time: Option<i64>, // i64 because that is the type of clock.unix_timestamp
  // pub gt_expiry_tolerance: u32,
  pub allowance: u8,
  pub max_amount: Option<u64>,
}

#[account]
#[derive(Default)]
pub struct AllowanceAccount {
  pub amount: u8,
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
  #[msg("TokenGuard is not yet live")]
  NotLiveYet,
  #[msg("The payer's token account must be ephemeral (have zero lamports)")]
  TokenAccountNotEphemeral,
  #[msg("The payer already has made the allowed amount of purchases with this TokenGuard")]
  AllowanceExceeded,
  #[msg("The amount exceeds the maximum amount allowed by this TokenGuard")]
  MaxAmountExceeded,
}
