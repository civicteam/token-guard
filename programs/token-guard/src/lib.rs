mod guard_utils;
mod nft_utils;
mod token_utils;

extern crate num;
#[macro_use]
extern crate num_derive;

use anchor_lang::{prelude::*, solana_program::system_program, AnchorDeserialize, AnchorSerialize};

declare_id!("tg7bdEQom2SZT1JB2d77RDJFYaL4eZ2FcM8HZZAg5Z8");

const MINT_AUTHORITY_SEED: &[u8; 30] = br"token_guard_out_mint_authority";
const ALLOWANCE_ACCOUNT_SEED: &[u8; 29] = br"token_guard_allowance_account";

const TOKEN_GUARD_SIZE: usize = 8 + 32 + 32 + 32 + (1 + 32) + 32 + 1 + (1 + 8) + 1 + (1 + 8) + 1;

#[program]
pub mod token_guard {
    use super::*;
    use crate::{
        guard_utils::*,
        token_utils::{spl_token_mint, TokenMintParams},
    };

    pub fn initialize(
        ctx: Context<Initialize>,
        mint_authority_bump: u8,
        gatekeeper_network: Pubkey,
        start_time: Option<i64>,
        allowance: Option<u8>,
        max_amount: Option<u64>,
        membership_token: Option<Pubkey>,
        strategy: u8, // Type: Strategy- Anchor does not yet provide mappings for enums
    ) -> ProgramResult {
        let token_guard = &mut ctx.accounts.token_guard;
        let out_mint = &ctx.accounts.out_mint;
        let mint_authority = &ctx.accounts.mint_authority;

        // TODO move this to anchor guards
        check_out_mint(out_mint, mint_authority)?;

        token_guard.authority = *ctx.accounts.authority.key;
        token_guard.gatekeeper_network = gatekeeper_network;
        token_guard.recipient = *ctx.accounts.recipient.key;
        // token_guard.recipient_ata = *ctx.accounts.recipient_ata.key;
        token_guard.out_mint = *ctx.accounts.out_mint.key;
        token_guard.membership_token = membership_token;

        set_properties(
            token_guard,
            mint_authority_bump,
            start_time,
            allowance,
            max_amount,
            num::FromPrimitive::from_u8(strategy).unwrap(),
        );

        Ok(())
    }

    pub fn exchange(
        ctx: Context<Exchange>,
        lamports: u64,
        allowance_account_bump: u8,
    ) -> ProgramResult {
        msg!("exchange");
        let token_guard = &ctx.accounts.token_guard;
        let mut allowance_account = &mut ctx.accounts.allowance_account;
        let payer = &ctx.accounts.payer;
        let payer_ata = &ctx.accounts.payer_ata;
        let clock = &ctx.accounts.clock;
        let gateway_token = &ctx.accounts.gateway_token;
        let recipient = &ctx.accounts.recipient;
        let mint_authority = &ctx.accounts.mint_authority;
        let out_mint = &ctx.accounts.out_mint;
        let rent = &ctx.accounts.rent;
        let system_program = &ctx.accounts.system_program;
        let token_program = &ctx.accounts.token_program;

        let membership_token = &ctx.remaining_accounts.get(0);
        let membership_token_mint = &ctx.remaining_accounts.get(1);
        let membership_token_metadata = &ctx.remaining_accounts.get(2);

        // If there is a membership token NFT, and an allowance
        // then the allowance is based on that NFT, rather than the user's wallet
        // in other words, the user cannot use the NFT more than x times,
        // Even if the NFT is transferred to another user, it cannot be used again.
        // If there is no membership token NFT, then the allowance is based on the user's wallet.
        let allowance_account_derive_key = membership_token_mint.map_or(payer.key, |m| m.key);

        check_start_time(clock, token_guard)?;
        check_max_amount(lamports, token_guard)?;
        check_gateway_token(gateway_token, payer, token_guard)?;
        check_balance(lamports, payer)?;
        check_payer_token_account(payer_ata, token_guard)?;
        check_and_update_allowance(
            allowance_account_bump,
            &token_guard,
            &mut allowance_account,
            &payer,
            &allowance_account_derive_key,
            &rent,
            &system_program,
        )?;

        check_membership_token(
            membership_token,
            membership_token_mint,
            membership_token_metadata,
            token_guard,
        )?;

        transfer_lamports(lamports, &payer, &recipient, &system_program)?;

        // mint out tokens to the payer
        spl_token_mint(TokenMintParams {
            mint: out_mint.clone(),
            destination: payer_ata.clone(),
            mint_authority: mint_authority.clone(),
            authority_signer_seeds: &[
                MINT_AUTHORITY_SEED,
                &token_guard.to_account_info().key.to_bytes(),
                &[token_guard.mint_authority_bump],
            ],
            token_program: token_program.clone(),
            amount: lamports,
        })?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = TOKEN_GUARD_SIZE)]
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
    allowance_account: AccountInfo<'info>, //ProgramAccount<'info, AllowanceAccount>,
    #[account(address = spl_token::id())]
    token_program: AccountInfo<'info>,
    #[account(address = system_program::ID)]
    system_program: AccountInfo<'info>,
    clock: Sysvar<'info, Clock>,
    rent: Sysvar<'info, Rent>,
}

#[derive(Clone, Debug, AnchorDeserialize, AnchorSerialize, FromPrimitive)]
pub enum Strategy {
    GatewayOnly = 0,
    MembershipSPLToken = 1,
    MembershipNftUpdateAuthority = 2,
    MembershipNftCreator = 3,
}
impl Default for Strategy {
    fn default() -> Self {
        Strategy::GatewayOnly
    }
}

#[account]
#[derive(Default)]
pub struct TokenGuard {
    pub authority: Pubkey,
    pub recipient: Pubkey,
    // pub recipient_ata: Pubkey,
    pub gatekeeper_network: Pubkey,
    pub membership_token: Option<Pubkey>,
    pub out_mint: Pubkey,
    pub mint_authority_bump: u8,
    // pub in_mint: Option<Pubkey>,
    pub start_time: Option<i64>, // i64 because that is the type of clock.unix_timestamp
    // pub gt_expiry_tolerance: u32,
    pub allowance: u8,
    pub max_amount: Option<u64>,
    pub strategy: Strategy,
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
    #[msg("The presented membership token does not match the required token")]
    MembershipTokenMismatch,
    #[msg("The presented membership token is missing or the balance is insufficient")]
    NoMembershipToken,
    #[msg("The strategy does not match the properties of the TokenGuard")]
    InvalidStrategy,
}
