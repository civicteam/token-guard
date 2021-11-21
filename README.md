# token-guard
A composable gateway program for Solana dApps written in Anchor.

With TokenGuard, dapp developers can protect access to any dApp that
accepts tokens as payment, such as a Metaplex CandyMachine mint,
CandyMachine mint without requiring any on-chain smart-contract changes.

NOTE: TokenGuard is currently in beta on devnet only and is unaudited.

Devnet address: `tg7bdEQom2SZT1JB2d77RDJFYaL4eZ2FcM8HZZAg5Z8`

## How it works

Let's say you want to set up a CandyMachine that mints NFTs at x Sol each.

1. Set up a TokenGuard that exchanges Sol for a new token T,
created by TokenGuard (the mint authority is a PDA owned by TokenGuard),
if the user has a valid Civic Pass gateway token.

2. Set up a CandyMachine that accepts token T instead of Sol

3. In your UI, add a TokenGuard exchange instruction to the mint transaction.

Note: the equivalent pattern applies to other protocols. 

![Candy Machine Example](./docs/TokenGuardCandyMachine.png)

## Coming Soon

[ ] Support for SPL Token
[ ] Support for membership tokens, (non-consumed tokens)
[ ] Mainnet deployment
[ ] Audit

## Usage

Example: CandyMachine

## 1. Create a TokenGuard

```shell
$ yarn global add @civic/token-guard
$ token-guard create
TokenGuard created 

ID: FeHQD2mEHScoznRZQHFGTtTZALfPpDLCx8Pg4HyDYVwy
Mint: 6zV7KfgzuNHTEm922juUSFwGJ472Kx6w8J7Gf6kAYuzh
      
Additional Details:

GatekeeperNetwork: tgnuXXNMDLK8dy7Xm1TdeGyc95MDym4bvAQCwcW21Bf
Recipient: 48V9nmW9awiR9BmihdGhUL3ZpYJ8MCgGeUoSWbtqjicv
MintAuthority: JBS8QmUbFADgnU4MVDtZV1pzSfrV96L3gUfjZy45Aff6
```

## 2. Add a Token Account for the mint

(TODO include this in the TG initialisation step?)

```shell
spl-token -u devnet create-account 6zV7KfgzuNHTEm922juUSFwGJ472Kx6w8J7Gf6kAYuzh
```

## 3. Create the CandyMachine

Check out the [metaplex](https://github.com/metaplex-foundation/metaplex) repository
and follow the steps to install the metaplex CLI.

See [Candy Machine Overview](https://docs.metaplex.com/overviews/candy_machine_overview) for details

```shell
# Find the token account created in step 2
MINT=6zV7KfgzuNHTEm922juUSFwGJ472Kx6w8J7Gf6kAYuzh
TOKEN_ACCOUNT=$(spl-token -u devnet address --token ${MINT} -v --output json | jq '.associatedTokenAddress' | tr -d '"')

# Upload the assets
metaplex upload assets -k ${HOME}/.config/solana/id.json -c devnet
# Create the candy machine instance, referencing the token account
metaplex create_candy_machine -k ${HOME}/.config/solana/id.json -c devnet -t ${MINT} -p 1 -a ${TOKEN_ACCOUNT}
# Set the start date
metaplex update_candy_machine -d now -k ${HOME}/.config/solana/id.json -c devnet
```

### 4. Set up the UI

You need to make two changes to a traditional CandyMachine UI:

#### 4a. Discover a user's Gateway Tokens

Your UI must lookup a wallet's gateway token. For more details on gateway tokens,
see the [Civic Pass documentation](https://docs.civic.com).

Quickstart:

```js
import {findGatewayToken} from "@identity.com/solana-gateway-ts";

// Get the gatekeeper network address from https://docs.civic.com
const foundToken = await findGatewayToken(connection, wallet.publicKey, gatekeeperNetwork);
```

If you want to integrate Civic's KYC flow into your UI, you can use
Civic's [react component](https://www.npmjs.com/package/@civic/solana-gateway-react).

More details [here](https://docs.civic.com/civic-pass/ui-integration-react-component)

#### 4b. Add the TokenGuard instructions to the mint transaction

```js
import * as TokenGuard from "@civic/token-guard";

const tokenGuard = new PublicKey("<ID from step 1>")
const program = await TokenGuard.fetchProgram(provider)
const instructions = await TokenGuard.exchange(
    program,
    tokenGuard,
    payer,
    payer,
    gatewayToken,
    amount
  );

await program.rpc.mintNft({
  accounts: {
    // ... candymachine accounts
  },
  remainingAccounts: remainingAccounts,
  signers: [mint],
  instructions: [
    ...(tokenGuardInstructions),  // ADD THIS LINE
  //...other candymachine instructions,
  ],
});
```

## Build and deploy the program from scratch

```shell
$ cargo install anchor
$ anchor build
$ anchor deploy
$ anchor idl init
```
