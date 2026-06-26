import { agent, artifact, loop, step } from "@beyland/piper";

const summary = artifact("summary", "summary");

export default function simpleLoop() {
	return loop(
		{
			objective: "Inspect Piper and explain how the configured harness was launched",
			agents: [
				agent("researcher", {
					harness: "copilot",
					instructions: "Stay read-only and produce a concise run summary.",
				}),
			],
		},
		step({
			role: "researcher",
			goal: "Inspect Piper and report how Copilot is being launched.",
			context: [
				"Read-only test run: do not edit files or run destructive commands.",
				"Include the phrase 'Piper meta-harness smoke test complete' in the final response.",
			],
			produces: summary,
		}),
	);
}
