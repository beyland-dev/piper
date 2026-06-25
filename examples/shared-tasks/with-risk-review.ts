import { derive, protect, sequence, task, type TaskNode } from "agent-runtime";

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
  steps
}: WithRiskReviewProps) {
  return protect(
    {
      protectedFiles,
      validate: [
        derive(async ({ readOutput }) => {
          const review = (await readOutput(reviewOutput)).toLowerCase();
          return review.includes("risk") || review.includes("rollback") || review.includes("follow-up");
        }, `${reviewOutput} captures risk guidance`)
      ]
    },
    sequence(
      steps,
      task({
        goal: reviewGoal,
        agent: "pi",
        context: [
          "Focus on production risk, rollback gaps, and any follow-up work that should be ticketed.",
          "Keep protected files unchanged while performing the review."
        ],
        output: reviewOutput
      })
    )
  );
}
