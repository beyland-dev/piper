import { runtimeValue, artifact, task } from "@beyland/piper";
import { withImplementationPlan } from "./shared-tasks/with-implementation-plan.js";
import { withRiskReview } from "./shared-tasks/with-risk-review.js";
import { withTests } from "./shared-tasks/with-tests.js";

export default function composableReleaseWorkflow() {
	return withTests({
		testCommand: "pnpm vitest run tests/end-to-end.test.ts",
		steps: [
			withImplementationPlan({
				planningGoal:
					"Draft a release train plan that coordinates notes, rollout steps, and smoke checks",
				planOutput: "release-plan",
				status: "Preparing release deliverables from the shared plan...",
				steps: [
					task({
						goal: "Write release notes for the current branch",
						harness: "pi",
						context: [artifact("release-plan").value()],
						artifact: "release-notes",
					}),
					task({
						goal: "Prepare rollout instructions and smoke checks",
						harness: "pi",
						context: [
							artifact("release-plan").value(),
							runtimeValue(async ({ readTaskResult }) => {
								const plan = await readTaskResult("release-plan");
								return `The release plan touched ${plan.modifiedFiles.length} files while being prepared.`;
							}, "release plan file count"),
						],
						artifact: "rollout-guide",
					}),
				],
			}),
			withRiskReview({
				protectedFiles: [".github/workflows/release.yml", "infra/production.tf"],
				reviewGoal: "Review the release package for deployment risk and rollback gaps",
				reviewOutput: "release-review",
				steps: task({
					goal: "Check the release artifacts for missing operator guidance",
					harness: "pi",
					context: [
						artifact("release-notes").value(),
						artifact("rollout-guide").value(),
						"Look for missing rollback notes, smoke checks, and on-call instructions.",
					],
				}),
			}),
		],
	});
}
