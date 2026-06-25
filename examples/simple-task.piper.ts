import { task } from "@beyland/piper";

export default function simpleTaskWorkflow() {
	return task({
		goal: "Inspect the current repository and describe the next implementation step.",
		harness: "pi",
		context: [
			"Stay inside the current workspace.",
			"Summarize the codebase briefly before proposing the next step.",
		],
	});
}
