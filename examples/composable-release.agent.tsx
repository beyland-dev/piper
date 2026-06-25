import { Task, computed, useOutput } from "agent-runtime";

import { WithImplementationPlan } from "./shared-tasks/with-implementation-plan.js";
import { WithRiskReview } from "./shared-tasks/with-risk-review.js";
import { WithTests } from "./shared-tasks/with-tests.js";

export default function ComposableReleaseWorkflow() {
  return (
    <WithTests testCommand="pnpm vitest run tests/end-to-end.test.ts">
      <WithImplementationPlan
        planningGoal="Draft a release train plan that coordinates notes, rollout steps, and smoke checks"
        planOutput="release-plan"
        fallback="Preparing release deliverables from the shared plan..."
      >
        <Task
          goal="Write release notes for the current branch"
          agent="pi"
          context={[useOutput("release-plan")]}
          output="release-notes"
        />

        <Task
          goal="Prepare rollout instructions and smoke checks"
          agent="pi"
          context={[
            useOutput("release-plan"),
            computed(async ({ readTaskResult }) => {
              const plan = await readTaskResult("release-plan");
              return `The release plan touched ${plan.modifiedFiles.length} files while being prepared.`;
            }, "release plan file count")
          ]}
          output="rollout-guide"
        />
      </WithImplementationPlan>

      <WithRiskReview
        protectedFiles={[".github/workflows/release.yml", "infra/production.tf"]}
        reviewGoal="Review the release package for deployment risk and rollback gaps"
        reviewOutput="release-review"
      >
        <Task
          goal="Check the release artifacts for missing operator guidance"
          agent="pi"
          context={[
            useOutput("release-notes"),
            useOutput("rollout-guide"),
            "Look for missing rollback notes, smoke checks, and on-call instructions."
          ]}
        />
      </WithRiskReview>
    </WithTests>
  );
}