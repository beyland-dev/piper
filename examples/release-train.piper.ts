import { runtimeValue, artifact, parallel, protect, recover, task } from "@beyland/piper";

export default function releaseTrainWorkflow() {
	return recover(
		{
			maxRetries: 1,
			onFailure: (error, retry) =>
				task({
					goal: `Prepare a rollback-oriented recovery plan for the failed release workflow: ${error.message}`,
					harness: "pi",
					context: [`Failure logs:\n${error.logs ?? "none"}`],
					"on:complete": () => retry(),
				}),
		},
		task({
			goal: "Audit the branch for release readiness",
			harness: "pi",
			context: [
				"Identify risky diffs, incomplete migrations, and missing operator documentation.",
				"Summarize the highest-risk files before proposing rollout work.",
			],
			artifact: "audit",
		}),
		task({
			goal: "Draft a release checklist and deployment sequence",
			harness: "pi",
			context: [
				artifact("audit").value(),
				runtimeValue(async ({ readTaskResult }) => {
					const audit = await readTaskResult("audit");
					return `Files touched during the audit: ${audit.modifiedFiles.join(", ") || "none"}`;
				}, "audit modified files"),
			],
			artifact: "release-plan",
			validate: [
				runtimeValue(
					async ({ readArtifact }) => (await readArtifact("audit")).trim().length > 0,
					"audit artifact is present",
				),
			],
		}),
		parallel(
			{ status: "Preparing release notes and rollout guidance in parallel..." },
			task({
				goal: "Write changelog entries and operator notes for the release",
				harness: "pi",
				context: [artifact("release-plan").value()],
				artifact: "release-notes",
			}),
			task({
				goal: "Produce a rollout and rollback guide for the release",
				harness: "pi",
				context: [
					artifact("release-plan").value(),
					runtimeValue(async ({ readTaskResult }) => {
						const plan = await readTaskResult("release-plan");
						return `The release plan modified ${plan.modifiedFiles.length} files while being prepared.`;
					}, "release plan metadata"),
				],
				artifact: "rollout-guide",
			}),
		),
		protect(
			{
				protectedFiles: ["infra/production.tf", ".github/workflows/release.yml"],
				validate: [
					runtimeValue(async ({ readArtifact }) => {
						const notes = (await readArtifact("release-notes")).toLowerCase();
						const guide = (await readArtifact("rollout-guide")).toLowerCase();
						return notes.includes("rollback") || guide.includes("rollback");
					}, "release artifacts mention rollback"),
				],
			},
			task({
				goal: "Review the release package for production risk",
				harness: "pi",
				context: [
					artifact("release-notes").value(),
					artifact("rollout-guide").value(),
					"Focus on deployment risk, observability gaps, and operator handoff quality.",
				],
				constraints: ["do not modify infra/production.tf"],
			}),
		),
	);
}
