import { web3 } from "@project-serum/anchor";

import { flags } from "@oclif/command";
import { ExtendedCluster, getClusterUrl } from "../util";
import { getKeypair, getProvider } from "./utils";

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
