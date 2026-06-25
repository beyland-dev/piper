import { Task, computed, useOutput } from "agent-runtime";

import { WithImplementationPlan } from "../examples/shared-tasks/with-implementation-plan.js";
import { WithRiskReview } from "../examples/shared-tasks/with-risk-review.js";
import { WithTests } from "../examples/shared-tasks/with-tests.js";

export default function RepoDevelopmentWorkflow() {
  return (
    <WithTests testCommand="pnpm test">
      <WithImplementationPlan
        planningGoal="Inspect src/, tests/, and README.md, then choose one small high-leverage improvement for the agent runtime that can be completed safely in a single pass"
        planOutput="repo-improvement-plan"
        fallback="Preparing a focused improvement plan for the repository..."
      >
        <Task
          goal="Implement the planned improvement, keeping the change narrow and adding or updating focused tests"
          agent="pi"
          context={[
            useOutput("repo-improvement-plan"),
            computed(async ({ readTaskResult }) => {
              const plan = await readTaskResult("repo-improvement-plan");
              return `The planning step modified ${plan.modifiedFiles.length} files while preparing the recommendation.`;
            }, "repo improvement plan file count"),
            "Prefer changes in src/ and tests/ unless the plan specifically calls for user-facing documentation updates.",
            "Keep public API changes minimal and justify them in code comments or test names when they are unavoidable."
          ]}
          output="implementation-summary"
          validate={[
            "pnpm typecheck",
            computed(async ({ readOutput }) => {
              const plan = (await readOutput("repo-improvement-plan")).toLowerCase();
              return plan.includes("test") || plan.includes("validation");
            }, "implementation plan includes testing guidance")
          ]}
        />

        <Task
          goal="Update README guidance only if the implemented improvement changes how maintainers should author or run workflows"
          agent="pi"
          context={[
            useOutput("repo-improvement-plan"),
            useOutput("implementation-summary"),
            "Skip documentation edits when the change is purely internal and does not affect authoring, runtime behavior, or development commands."
          ]}
        />
      </WithImplementationPlan>

      <WithRiskReview
        protectedFiles={["ARCHITECTURE.md", "pnpm-lock.yaml"]}
        reviewGoal="Review the completed repository change for runtime risk, missing validation, and any maintainer follow-up work"
        reviewOutput="repo-risk-review"
      >
        <Task
          goal="Write a short maintainer handoff summary for the completed repository improvement"
          agent="pi"
          context={[
            useOutput("implementation-summary"),
            useOutput("repo-risk-review"),
            "Summarize what changed, why it was chosen, and what a maintainer should verify before merging."
          ]}
          output="maintainer-handoff"
        />
      </WithRiskReview>
    </WithTests>
  );
}