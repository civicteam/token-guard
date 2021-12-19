import { web3 } from "@project-serum/anchor";
import { Command, flags } from "@oclif/command";
import { initialize } from "../lib/initialize";
import {
  clusterFlag,
  gatekeeperNetworkPubkeyFlag,
  startTimeFlag,
  recipientPubkeyFlag,
  membershipTokenFlag,
  membershipTokenStrategyFlag,
  allowanceFlag,
} from "../lib/cli/flags";
import { fetchProgram, MembershipToken, Strategy } from "../lib/util";
import { getProvider } from "../lib/cli/utils";

const getMembershipTokenFromFlags = (flags: {
  membershipToken?: web3.PublicKey;
  strategy?: Strategy;
}): MembershipToken | undefined => {
  if (!flags.membershipToken) return undefined;

  return {
    key: flags.membershipToken,
    strategy: flags.strategy || "SPL",
  };
};

export default class Create extends Command {
  static description = `🏰 TokenGuard 🏰

Create a TokenGuard instance, that can protect access to a program, by converting the input Sol into a new token.
  `;

  static examples = [
    `Create a simple token-guard on devnet:
$ token-guard create
TokenGuard created.

Create a token-guard using the Civic Pass gateway network tgnuXXNMDLK8dy7Xm1TdeGyc95MDym4bvAQCwcW21Bf
$ token-guard create -n tgnuXXNMDLK8dy7Xm1TdeGyc95MDym4bvAQCwcW21Bf

Create a token-guard requiring presentation of NFT membership token from creator 9SWeEEuzRA9My2ERFmxU2jWiahJejs7pTubTTidPqLJo
and allowance 1 (one use per holder of the nft)
$ token-guard create -m 9SWeEEuzRA9My2ERFmxU2jWiahJejs7pTubTTidPqLJo -s NFT-Creator -a 1

For more examples, see the README or run
$ token-guard create -h
`,
  ];

  static flags: flags.Input<any> = {
    help: flags.help({ char: "h" }),
    recipient: recipientPubkeyFlag(),
    gatekeeperNetwork: gatekeeperNetworkPubkeyFlag(),
    cluster: clusterFlag(),
    startTime: startTimeFlag(),
    membershipToken: membershipTokenFlag(),
    strategy: membershipTokenStrategyFlag(),
    allowance: allowanceFlag,
    maxAmount: flags.integer({
      char: "m",
      description: "The maximum transaction amount (default no limit)",
    }),
  };

  static args = [];

  async run() {
    const { flags } = this.parse(Create);
    const provider = getProvider(flags.cluster);
    const program = await fetchProgram(provider);

    const membershipToken = getMembershipTokenFromFlags(flags);

    const tokenGuardState = await initialize(
      program,
      provider,
      flags.gatekeeperNetwork,
      flags.recipient,
      flags.startTime,
      flags.allowance,
      flags.maxAmount,
      membershipToken
    );

    this.log(
      `TokenGuard created.
ID: ${tokenGuardState.id}
Mint: ${tokenGuardState.outMint}

Additional Details:

GatekeeperNetwork: ${tokenGuardState.gatekeeperNetwork}
Recipient: ${tokenGuardState.recipient}
MintAuthority: ${tokenGuardState.mintAuthority}
${
  tokenGuardState.membershipToken
    ? `MembershipToken: ${tokenGuardState.membershipToken.key}
Strategy: ${tokenGuardState.membershipToken.strategy}`
    : ""
}`
    );
  }
}
