import { CommandAgentAdapter, type CommandAgentAdapterOptions } from "./command-adapter.js";

export interface CopilotCliAdapterOptions extends CommandAgentAdapterOptions {
  name?: string;
}

export class CopilotCliAdapter extends CommandAgentAdapter {
  constructor(options: CopilotCliAdapterOptions = {}) {
    const { name = "copilot", ...commandOptions } = options;

    super(
      {
        name,
        defaultCommand: "copilot",
        envPrefix: "COPILOT"
      },
      commandOptions
    );
  }
}
