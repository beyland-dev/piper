import { task } from "@beyland/piper";

export default function simpleTaskWorkflow() {
	return task({
		goal: "AHP smoke test: inspect Piper and report how Copilot is being launched.",
		harness: "copilot",
		context: [
			"Read-only test run: do not edit files or run destructive commands.",
			"Summarize the repository briefly, then explain that this task was launched through Piper's copilot harness.",
			"Include the phrase 'Piper AHP smoke test complete' in the final response.",
		],
	});
}
