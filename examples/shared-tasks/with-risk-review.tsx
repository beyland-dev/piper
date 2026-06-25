import { Guarded, Task, computed, type TaskNode } from "agent-runtime";

interface WithRiskReviewProps {
  protectedFiles: string[];
  reviewGoal: string;
  reviewOutput?: string;
  children?: TaskNode | TaskNode[];
}

export function WithRiskReview({
  protectedFiles,
  reviewGoal,
  reviewOutput = "risk-review",
  children
}: WithRiskReviewProps) {
  return (
    <Guarded
      protectedFiles={protectedFiles}
      validate={[
        computed(async ({ readOutput }) => {
          const review = (await readOutput(reviewOutput)).toLowerCase();
          return review.includes("risk") || review.includes("rollback") || review.includes("follow-up");
        }, `${reviewOutput} captures risk guidance`)
      ]}
    >
      <>
        {children}
        <Task
          goal={reviewGoal}
          agent="pi"
          context={[
            "Focus on production risk, rollback gaps, and any follow-up work that should be ticketed.",
            "Keep protected files unchanged while performing the review."
          ]}
          output={reviewOutput}
        />
      </>
    </Guarded>
  );
}