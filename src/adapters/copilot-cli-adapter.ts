import { CommandHarness, type CommandHarnessOptions } from "./command-adapter.js";

export interface CopilotCliHarnessOptions extends CommandHarnessOptions {
	name?: string;
}

export class CopilotCliHarness extends CommandHarness {
	constructor(options: CopilotCliHarnessOptions = {}) {
		const { name = "copilot", ...commandOptions } = options;

		super(
			{
				name,
				defaultCommand: "copilot",
				envPrefix: "COPILOT",
			},
			commandOptions,
		);
	}
}
