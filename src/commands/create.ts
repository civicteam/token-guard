import { Command, flags } from "@oclif/command";
import { initialize } from "../lib/initialize";
import {
  clusterFlag,
  gatekeeperNetworkPubkeyFlag,
  recipientPubkeyFlag,
} from "../lib/cli/flags";
import { fetchProgram } from "../lib/util";
import { getProvider } from "../lib/cli/utils";

export default class Create extends Command {
  static description = "Create a TokenGuard";

  static examples = [
    `$ tokenguard create -r
TokenGuard created.
`,
  ];

  static flags: flags.Input<any> = {
    help: flags.help({ char: "h" }),
    recipientKey: recipientPubkeyFlag(),
    gatekeeperNetworkKey: gatekeeperNetworkPubkeyFlag(),
    cluster: clusterFlag(),
  };

  static args = [];

  async run() {
    const { flags } = this.parse(Create);
    const provider = getProvider(flags.cluster);
    const program = await fetchProgram(provider);

    const tokenGuardState = await initialize(
      program,
      provider,
      flags.gatekeeperNetworkKey,
      flags.recipientKey
    );

    this.log(
      `TokenGuard created. ID: ${tokenGuardState.id}

Details:

GatekeeperNetwork: ${tokenGuardState.gatekeeperNetwork}
Recipient: ${tokenGuardState.recipient}
Mint: ${tokenGuardState.outMint}
MintAuthority: ${tokenGuardState.mintAuthority}`
    );
  }
}
