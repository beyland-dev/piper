import { agent, artifact, evaluate, loop, repeat, step } from "@beyland/piper";

const failurePattern = artifact("flaky-test-pattern", "test-analysis");
const fixReport = artifact("flaky-test-fix-report", "test-report");

export default function flakyTestTriageLoop() {
	return loop(
		{
			objective: "Diagnose and stabilize a flaky test without hiding real regressions",
			agents: [
				agent("test investigator", {
					harness: "copilot",
					instructions: "Do not delete assertions or skip tests unless explicitly approved.",
				}),
			],
		},
		step({
			role: "test investigator",
			goal: "Inspect recent failures and identify the likely source of nondeterminism.",
			produces: failurePattern,
		}),
		repeat(
			{ maxAttempts: 3, until: ["pnpm test"] },
			step({
				role: "test investigator",
				goal: "Apply a narrow stabilization fix and explain why it preserves coverage.",
				context: [failurePattern],
				produces: fixReport,
				constraints: [
					"Do not lower coverage requirements.",
					"Do not replace behavioral assertions with snapshots.",
				],
			}),
			evaluate({
				name: "flaky test fix preserves coverage intent",
				using: async ({ readArtifact }) =>
					(await readArtifact("flaky-test-fix-report")).toLowerCase().includes("coverage"),
			}),
		),
	);
}
