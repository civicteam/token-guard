import { Command, flags } from "@oclif/command";
import { initialize } from "../lib/initialize";
import {
  clusterFlag,
  gatekeeperNetworkPubkeyFlag,
  startTimeFlag,
  recipientPubkeyFlag,
} from "../lib/cli/flags";
import { fetchProgram } from "../lib/util";
import { getProvider } from "../lib/cli/utils";

export default class Create extends Command {
  static description = "Create a TokenGuard";

  static examples = [
    `$ token-guard create -r
TokenGuard created.
`,
  ];

  static flags: flags.Input<any> = {
    help: flags.help({ char: "h" }),
    recipient: recipientPubkeyFlag(),
    gatekeeperNetwork: gatekeeperNetworkPubkeyFlag(),
    cluster: clusterFlag(),
    startTime: startTimeFlag(),
    allowance: flags.integer({
      char: "a",
      description:
        "The number of times a buyer can use this tokenGuard (default no limit)",
    }),
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

    const tokenGuardState = await initialize(
      program,
      provider,
      flags.gatekeeperNetwork,
      flags.recipient,
      flags.startTime,
      flags.allowance,
      flags.maxAmount
    );

    this.log(
      `TokenGuard created.
ID: ${tokenGuardState.id}
Mint: ${tokenGuardState.outMint}

Additional Details:

GatekeeperNetwork: ${tokenGuardState.gatekeeperNetwork}
Recipient: ${tokenGuardState.recipient}
MintAuthority: ${tokenGuardState.mintAuthority}`
    );
  }
}
