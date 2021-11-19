import { web3, Provider, Wallet } from "@project-serum/anchor";
import * as fs from "fs";
import path from "path";
import * as os from "os";
import { ExtendedCluster, getClusterUrl } from "../util";

const WALLET_PATH =
  process.env.TOKEN_GUARD_WALLET ||
  path.join(os.homedir(), ".config", "solana", "id.json");
const DEFAULT_COMMITMENT: web3.Commitment = "confirmed";

export const getKeypair = (): web3.Keypair =>
  web3.Keypair.fromSecretKey(
    Buffer.from(
      JSON.parse(
        fs.readFileSync(WALLET_PATH, {
          encoding: "utf-8",
        })
      )
    )
  );

export const getProvider = (cluster: ExtendedCluster) => {
  const connection = new web3.Connection(
    getClusterUrl(cluster),
    DEFAULT_COMMITMENT
  );
  const wallet = new Wallet(getKeypair());
  return new Provider(connection, wallet, {
    commitment: DEFAULT_COMMITMENT,
  });
};
