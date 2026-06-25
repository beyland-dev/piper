import { CommandAgentAdapter, type CommandAgentAdapterOptions } from "./command-adapter.js";

export interface PiAdapterOptions extends CommandAgentAdapterOptions {}

export class PiAdapter extends CommandAgentAdapter {
  constructor(options: PiAdapterOptions = {}) {
    super(
      {
        name: "pi",
        defaultCommand: "pi",
        envPrefix: "PI"
      },
      options
    );
  }
}
