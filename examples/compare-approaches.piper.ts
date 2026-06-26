import { agent, artifact, compare, loop, step } from "@beyland/piper";

const decision = artifact("implementation-decision", "decision");

export default function compareApproachesLoop() {
	return loop(
		{
			objective: "Compare implementation approaches before committing to a design",
			agents: [
				agent("investigator", {
					harness: "copilot",
					instructions: "Research tradeoffs and avoid editing files.",
				}),
			],
		},
		compare({
			produces: decision,
			branches: [
				{
					name: "minimal patch",
					node: step({
						role: "investigator",
						goal: "Evaluate a minimal patch that preserves the current architecture.",
					}),
				},
				{
					name: "targeted refactor",
					node: step({
						role: "investigator",
						goal: "Evaluate a targeted refactor that improves the underlying design.",
					}),
				},
				{
					name: "configuration option",
					node: step({
						role: "investigator",
						goal: "Evaluate whether a configuration option solves the user need safely.",
					}),
				},
			],
			evaluator: async ({ readFeedback }) => ({
				passed: readFeedback().filter((item) => item.severity === "error").length === 0,
				feedback: "Prefer the branch with the best risk-to-maintainability balance.",
			}),
		}),
		step({
			role: "investigator",
			goal: "Summarize the chosen implementation approach and the rejected alternatives.",
			context: [decision],
		}),
	);
}
