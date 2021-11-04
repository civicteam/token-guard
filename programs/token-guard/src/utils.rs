use {
  crate::ErrorCode,
  anchor_lang::{
    prelude::{AccountInfo, ProgramError, ProgramResult, Pubkey},
    solana_program::{
      program::invoke_signed,
      program_pack::{IsInitialized, Pack},
    },
  },
};

pub fn assert_initialized<T: Pack + IsInitialized>(
  account_info: &AccountInfo,
) -> Result<T, ProgramError> {
  let account: T = T::unpack_unchecked(&account_info.data.borrow())?;
  if !account.is_initialized() {
    Err(ErrorCode::Uninitialized.into())
  } else {
    Ok(account)
  }
}

pub fn assert_owned_by(account: &AccountInfo, owner: &Pubkey) -> ProgramResult {
  if account.owner != owner {
    Err(ErrorCode::IncorrectOwner.into())
  } else {
    Ok(())
  }
}

/// Parameters for an SPL Token transfer CPI
pub struct TokenTransferParams<'a: 'b, 'b> {
  /// the source token account
  pub source: AccountInfo<'a>,
  /// the destination token account
  pub destination: AccountInfo<'a>,
  /// the amount of tokens to transfer
  pub amount: u64,
  /// the owner of the source account
  pub authority: AccountInfo<'a>,
  /// if the source authority is a PDA, the signer seeds for the account
  pub authority_signer_seeds: &'b [&'b [u8]],
  /// the SPL Token program
  pub token_program: AccountInfo<'a>,
}

/// Parameters for a CPI minting SPL Tokens
pub struct TokenMintParams<'a: 'b, 'b> {
  /// the token being minted
  pub mint: AccountInfo<'a>,
  /// the destination token account
  pub destination: AccountInfo<'a>,
  /// the amount of tokens to mint
  pub amount: u64,
  /// the minter
  pub mint_authority: AccountInfo<'a>,
  /// if the mint authority is a PDA, the signer seeds for the account
  pub authority_signer_seeds: &'b [&'b [u8]],
  /// the SPL Token program
  pub token_program: AccountInfo<'a>,
}

#[inline(always)]
pub fn spl_token_transfer(params: TokenTransferParams<'_, '_>) -> ProgramResult {
  let TokenTransferParams {
    source,
    destination,
    authority,
    token_program,
    amount,
    authority_signer_seeds,
  } = params;

  let result = invoke_signed(
    &spl_token::instruction::transfer(
      token_program.key,
      source.key,
      destination.key,
      authority.key,
      &[],
      amount,
    )?,
    &[source, destination, authority, token_program],
    &[authority_signer_seeds],
  );

  result.map_err(|_| ErrorCode::TokenTransferFailed.into())
}

pub fn spl_token_mint(params: TokenMintParams<'_, '_>) -> ProgramResult {
  let TokenMintParams {
    mint,
    destination,
    mint_authority,
    token_program,
    amount,
    authority_signer_seeds,
  } = params;

  let result = invoke_signed(
    &spl_token::instruction::mint_to(
      token_program.key,
      mint.key,
      destination.key,
      mint_authority.key,
      &[],
      amount,
    )?,
    &[mint, destination, mint_authority, token_program],
    &[authority_signer_seeds],
  );

  result.map_err(|_| ErrorCode::TokenTransferFailed.into())
}
