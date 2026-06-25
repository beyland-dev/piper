import { runtimeValue, protect, workflow, task, type TaskNode } from "@beyland/piper";

interface WithRiskReviewProps {
	protectedFiles: string[];
	reviewGoal: string;
	reviewOutput?: string;
	steps?: TaskNode | TaskNode[];
}

export function withRiskReview({
	protectedFiles,
	reviewGoal,
	reviewOutput = "risk-review",
	steps,
}: WithRiskReviewProps) {
	return protect(
		{
			protectedFiles,
			validate: [
				runtimeValue(async ({ readArtifact }) => {
					const review = (await readArtifact(reviewOutput)).toLowerCase();
					return (
						review.includes("risk") || review.includes("rollback") || review.includes("follow-up")
					);
				}, `${reviewOutput} captures risk guidance`),
			],
		},
		workflow(
			steps,
			task({
				goal: reviewGoal,
				harness: "pi",
				context: [
					"Focus on production risk, rollback gaps, and any follow-up work that should be ticketed.",
					"Keep protected files unchanged while performing the review.",
				],
				artifact: reviewOutput,
			}),
		),
	);
}
