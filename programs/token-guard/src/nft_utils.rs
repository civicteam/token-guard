use crate::{ErrorCode, Strategy, TokenGuard};
use anchor_lang::{
    prelude::{msg, AccountInfo, ProgramResult},
    ProgramAccount,
};
use metaplex_token_metadata::state::Metadata;

pub fn check_nft_metadata(
    metadata_account: &AccountInfo,
    membership_token_mint: &AccountInfo,
    token_guard: &ProgramAccount<TokenGuard>,
) -> ProgramResult {
    let metadata = Metadata::from_account_info(metadata_account)?;

    if metadata.mint != *membership_token_mint.key {
        return Err(ErrorCode::MembershipTokenMismatch.into());
    }

    match token_guard.strategy {
        Strategy::MembershipNftUpdateAuthority => match token_guard.membership_token {
            None => return Err(ErrorCode::InvalidStrategy.into()),
            Some(key_to_match) => {
                if metadata.update_authority != key_to_match {
                    msg!("Metadata update authority does not match membership token");
                    return Err(ErrorCode::MembershipTokenMismatch.into());
                }
            }
        },
        _ => {}
    }

    Ok(())
}
