import { agent, artifact, evaluate, loop, parallel, step } from "@beyland/piper";

const bundleReport = artifact("bundle-size-report", "performance-report");
const runtimeReport = artifact("runtime-performance-report", "performance-report");
const budgetPlan = artifact("performance-budget-plan", "plan");

export default function performanceBudgetLoop() {
	return loop(
		{
			objective: "Evaluate a change against bundle and runtime performance budgets",
			agents: [
				agent("performance engineer", {
					harness: "copilot",
					instructions: "Report measurements and uncertainty instead of guessing.",
				}),
			],
		},
		parallel(
			{ status: "Collecting performance evidence..." },
			step({
				role: "performance engineer",
				goal: "Inspect bundle-size impact and identify the largest contributors.",
				produces: bundleReport,
			}),
			step({
				role: "performance engineer",
				goal: "Inspect runtime performance risk on critical interactions.",
				produces: runtimeReport,
			}),
		),
		step({
			role: "performance engineer",
			goal: "Create a performance budget plan with mitigation options.",
			context: [bundleReport, runtimeReport],
			produces: budgetPlan,
		}),
		evaluate({
			name: "performance plan includes measurement",
			using: async ({ readArtifact }) =>
				(await readArtifact("performance-budget-plan")).toLowerCase().includes("measure"),
			feedback: "Include the measurement command or method used for each performance claim.",
		}),
	);
}
