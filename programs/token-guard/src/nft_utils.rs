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
        Strategy::MembershipNftCreator => match token_guard.membership_token {
            None => return Err(ErrorCode::InvalidStrategy.into()),
            Some(key_to_match) => {
                let first_creator = &metadata.data.creators.unwrap()[0];
                if first_creator.address != key_to_match {
                    msg!("Metadata creator does not match membership token");
                    return Err(ErrorCode::MembershipTokenMismatch.into());
                }

                // in order to prevent users from minting their own NFTs and claiming
                // it belongs to the collection, we only allow verified creators here.
                if !first_creator.verified {
                    msg!("NFT creator is not verified");
                    return Err(ErrorCode::UnverifiedMembershipTokenCreator.into());
                }
            }
        },
        _ => {}
    }

    Ok(())
}
