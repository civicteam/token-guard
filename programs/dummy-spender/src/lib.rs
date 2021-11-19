mod utils;

use {
    crate::utils::{spl_token_transfer, TokenTransferParams},
    anchor_lang::{
        prelude::*, AnchorDeserialize, AnchorSerialize,
    },
};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod dummy_spender {
    use super::*;
    pub fn spend(ctx: Context<Spend>, amount: u64) -> ProgramResult {
        spl_token_transfer(TokenTransferParams {
            source: ctx.accounts.payer_ata.clone(),
            destination: ctx.accounts.recipient.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
            authority_signer_seeds: &[],
            token_program: ctx.accounts.token_program.to_account_info(),
            amount,
        })?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Spend<'info> {
    #[account(mut)]
    payer: Signer<'info>,
    #[account()]
    payer_ata: AccountInfo<'info>,
    #[account(mut)]
    recipient: AccountInfo<'info>,
    #[account(address = spl_token::id())]
    token_program: AccountInfo<'info>,
}

#[error]
pub enum ErrorCode {
    #[msg("Token transfer failed")]
    TokenTransferFailed,
}
