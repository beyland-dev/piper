import { CommandHarness, type CommandHarnessOptions } from "./command-adapter.js";

export interface PiHarnessOptions extends CommandHarnessOptions {}

export class PiHarness extends CommandHarness {
	constructor(options: PiHarnessOptions = {}) {
		super(
			{
				name: "pi",
				defaultCommand: "pi",
				envPrefix: "PI",
			},
			options,
		);
	}
}
