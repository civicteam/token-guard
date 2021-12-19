import { web3 } from "@project-serum/anchor";

import { flags } from "@oclif/command";
import {
  ExtendedCluster,
  getClusterUrl,
  parseStrategy,
  Strategy,
} from "../util";
import { getKeypair, getProvider } from "./utils";
import { Definition, IOptionFlag } from "@oclif/command/lib/flags";

export const gatekeeperNetworkPubkeyFlag = flags.build<web3.PublicKey>({
  char: "n",
  parse: (pubkey: string) => new web3.PublicKey(pubkey),
  default: () =>
    new web3.PublicKey("tgnuXXNMDLK8dy7Xm1TdeGyc95MDym4bvAQCwcW21Bf"),
  description:
    "The public key (in base 58) of the gatekeeper network to accept gateway tokens from.",
});

export const recipientPubkeyFlag = flags.build<web3.PublicKey>({
  char: "r",
  parse: (pubkey: string) => new web3.PublicKey(pubkey),
  default: () => getKeypair().publicKey,
  description:
    "The public key (in base 58) of the recipient of funds paid via this TokenGuard.",
});

export const membershipTokenFlag = flags.build<web3.PublicKey>({
  char: "m",
  parse: (pubkey: string) => new web3.PublicKey(pubkey),
  description: `An optional membership token that a user must present when exchanging via TokenGuard.

The membership token can be an SPL token or NFT from a particular collection.

If this key is an SPL-Token mint, the user must present a token account with a balance of at least one token.
Otherwise, the key is assumed to identify the NFT collection, and the user must present a token account from the same collection.`,
});

export const membershipTokenStrategyFlag = flags.build<Strategy>({
  char: "s",
  parse: (strategy: string) => parseStrategy(strategy),
  default: (context) => {
    if (context.flags.membershipToken) {
      return "SPL";
    }
    return undefined;
  },
  dependsOn: ["membershipToken"],
  options: ["SPL", "NFT-Creator"],
  description: `If presenting a membership token, the strategy to use to validate the token.
If the token is an NFT, the presented token must belong to the same collection.
The NFT collection is defined by the first creator in the metadata.`,
});

export const allowanceFlag: IOptionFlag<number | undefined> = flags.integer({
  char: "a",
  description: `The number of times a buyer can use this tokenGuard (default no limit)`,
});

export const clusterFlag = flags.build<ExtendedCluster>({
  char: "c",
  env: "SOLANA_CLUSTER",
  parse: (cluster: string) => cluster as ExtendedCluster,
  default: () => "devnet",
  description:
    "The cluster to target: mainnet-beta, testnet, devnet, civicnet, localnet. Alternatively, set the environment variable SOLANA_CLUSTER",
});

export const startTimeFlag = flags.build<number>({
  char: "l",
  parse: (timestampOrNow: string) => {
    if (timestampOrNow === "now") {
      return Date.now();
    }
    return parseInt(timestampOrNow, 10);
  },
  description: "An optional timestamp at which to enable the token guard",
});
