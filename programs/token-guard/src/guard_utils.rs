use crate::Strategy;
use anchor_lang::solana_program::program::invoke;
use solana_gateway::Gateway;
use std::borrow::BorrowMut;
use {
    crate::{
        id,
        token_utils::{assert_initialized, assert_owned_by},
        AllowanceAccount, ErrorCode, TokenGuard, ALLOWANCE_ACCOUNT_SEED,
    },
    anchor_lang::{
        prelude::*,
        solana_program::{program::invoke_signed, program_option::COption, system_instruction},
    },
    spl_token::state::Mint,
};

pub fn check_mint_authority(mint_authority: &AccountInfo, token_mint: Mint) -> ProgramResult {
    if let COption::Some(token_mint_authority) = token_mint.mint_authority {
        if token_mint_authority != *mint_authority.key {
            msg!("token mint authority {}", token_mint_authority);
            return Err(ErrorCode::MintAuthorityMismatch.into());
        }
    } else {
        msg!("token mint has no authority");
        return Err(ErrorCode::MintAuthorityMismatch.into());
    }

    Ok(())
}

pub fn check_out_mint(out_mint: &AccountInfo, mint_authority: &AccountInfo) -> ProgramResult {
    let token_mint: Mint = assert_initialized(out_mint)?;
    assert_owned_by(out_mint, &spl_token::id())?;
    check_mint_authority(mint_authority, token_mint)?;

    Ok(())
}

pub fn check_start_time(
    clock: &Sysvar<Clock>,
    token_guard: &ProgramAccount<TokenGuard>,
) -> ProgramResult {
    if let Some(start_time) = token_guard.start_time {
        if clock.unix_timestamp < start_time {
            msg!("Not live yet");
            return Err(ErrorCode::NotLiveYet.into());
        }
    }

    Ok(())
}

pub fn check_max_amount(lamports: u64, token_guard: &ProgramAccount<TokenGuard>) -> ProgramResult {
    if let Some(max_amount) = token_guard.max_amount {
        if lamports > max_amount {
            msg!("Amount exceeds maximum");
            return Err(ErrorCode::MaxAmountExceeded.into());
        }
    }

    Ok(())
}

pub fn check_gateway_token(
    gateway_token: &AccountInfo,
    payer: &AccountInfo,
    token_guard: &ProgramAccount<TokenGuard>,
) -> ProgramResult {
    msg!(
        "Verifying gateway token {} on network {} belongs to {}",
        gateway_token.key,
        token_guard.gatekeeper_network,
        payer.key()
    );

    Gateway::verify_gateway_token_account_info(
        &gateway_token,
        &payer.key(),
        &token_guard.gatekeeper_network,
    )?;
    msg!("Gateway token verified");

    Ok(())
}

pub fn check_payer_token_account(
    payer_ata: &AccountInfo,
    token_guard: &ProgramAccount<TokenGuard>,
) -> ProgramResult {
    // is the payer's token account for the correct mint?
    let token_account: spl_token::state::Account = assert_initialized(&payer_ata)?;
    if token_account.mint != token_guard.out_mint {
        return Err(ErrorCode::MintMismatch.into());
    }
    // Is the payer's token account ephemeral?
    msg!("Checking token account is ephemeral");
    if payer_ata.lamports() != 0 {
        msg!(
            "Token account is not ephemeral - has {} lamports",
            payer_ata.lamports()
        );
        return Err(ErrorCode::TokenAccountNotEphemeral.into());
    }

    Ok(())
}

pub fn check_balance(lamports: u64, payer: &Signer) -> ProgramResult {
    // Does the payer have enough funds?
    if payer.lamports() < lamports {
        return Err(ErrorCode::NotEnoughSOL.into());
    }

    Ok(())
}

pub fn check_membership_token(
    optional_membership_token: &Option<&AccountInfo>,
    token_guard: &ProgramAccount<TokenGuard>,
) -> ProgramResult {
    msg!("Checking membership token");
    match token_guard.strategy {
        Strategy::MembershipSPLToken => {
            msg!("with strategy SPL");
            let membership_token = optional_membership_token.ok_or(ErrorCode::NoMembershipToken)?;
            let token_account: spl_token::state::Account = assert_initialized(&membership_token)?;
            if token_account.mint != token_guard.membership_token.unwrap() {
                return Err(ErrorCode::MembershipTokenMintMismatch.into());
            }
            if token_account.amount == 0 {
                return Err(ErrorCode::NoMembershipToken.into());
            }
        }
        _ => {}
    }

    Ok(())
}

pub fn check_and_update_allowance<'info>(
    allowance_account_bump: u8,
    token_guard: &ProgramAccount<TokenGuard>,
    allowance_account: &mut AccountInfo<'info>,
    payer: &Signer<'info>,
    rent: &Sysvar<Rent>,
    system_program: &AccountInfo<'info>,
) -> ProgramResult {
    // Does the payer have a remaining allowance?
    msg!("Checking allowance");
    if token_guard.allowance > 0 {
        // token guard has an allowance requirement
        // if the allowance account does not exist, create it
        // if it exists, check if the value is already equal to the token guard allowance,
        // if so, error out, if not, increment it
        if allowance_account.owner == &id() {
            let mut allowance_program_account: ProgramAccount<AllowanceAccount> =
                ProgramAccount::try_from(&id(), allowance_account)?;
            if allowance_program_account.amount >= token_guard.allowance {
                msg!("Allowance of {} reached", allowance_program_account.amount);
                return Err(ErrorCode::AllowanceExceeded.into());
            } else {
                allowance_program_account.amount = allowance_program_account.amount + 1;
                allowance_program_account.exit(&id())?;
            }
        } else {
            let size = (1 + 8) as usize;
            // should match deriveAllowanceAccount in the client
            let allowance_account_signer_seeds: &[&[_]] = &[
                ALLOWANCE_ACCOUNT_SEED,
                &token_guard.key().to_bytes(),
                &payer.key.to_bytes(),
                &[allowance_account_bump],
            ];

            invoke_signed(
                &system_instruction::create_account(
                    payer.key,
                    allowance_account.borrow_mut().key,
                    1.max(rent.minimum_balance(size)),
                    size as u64,
                    &id(),
                ),
                &[
                    payer.to_account_info().clone(),
                    allowance_account.to_account_info().clone(),
                    system_program.clone(),
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

    Ok(())
}

pub fn transfer_lamports<'info>(
    lamports: u64,
    payer: &Signer<'info>,
    recipient: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> ProgramResult {
    msg!(
        "Sending {} lamports from {} to {}",
        lamports,
        payer.key,
        recipient.key
    );
    invoke(
        &system_instruction::transfer(payer.key, recipient.key, lamports),
        &[
            payer.to_account_info().clone(),
            recipient.to_account_info().clone(),
            system_program.clone(),
        ],
    )?;
    msg!("Transfer complete");

    Ok(())
}

pub fn set_properties(
    token_guard: &mut ProgramAccount<TokenGuard>,
    mint_authority_bump: u8,
    start_time: Option<i64>,
    allowance: Option<u8>,
    max_amount: Option<u64>,
    strategy: Strategy,
) {
    token_guard.start_time = start_time;
    // store zero as the "no allowance" rather than the extra byte an optional would require
    token_guard.allowance = allowance.unwrap_or_default();
    token_guard.max_amount = max_amount;
    token_guard.mint_authority_bump = mint_authority_bump;
    token_guard.strategy = strategy;
}
