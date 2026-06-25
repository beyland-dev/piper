import { derive, output, task } from "agent-runtime";

import { withImplementationPlan } from "./shared-tasks/with-implementation-plan.js";
import { withRiskReview } from "./shared-tasks/with-risk-review.js";
import { withTests } from "./shared-tasks/with-tests.js";

export default function composableReleaseWorkflow() {
  return withTests({
    testCommand: "pnpm vitest run tests/end-to-end.test.ts",
    children: [
      withImplementationPlan({
        planningGoal: "Draft a release train plan that coordinates notes, rollout steps, and smoke checks",
        planOutput: "release-plan",
        fallback: "Preparing release deliverables from the shared plan...",
        children: [
          task({
            goal: "Write release notes for the current branch",
            agent: "pi",
            context: [output("release-plan")],
            output: "release-notes"
          }),
          task({
            goal: "Prepare rollout instructions and smoke checks",
            agent: "pi",
            context: [
              output("release-plan"),
              derive(async ({ readTaskResult }) => {
                const plan = await readTaskResult("release-plan");
                return `The release plan touched ${plan.modifiedFiles.length} files while being prepared.`;
              }, "release plan file count")
            ],
            output: "rollout-guide"
          })
        ]
      }),
      withRiskReview({
        protectedFiles: [".github/workflows/release.yml", "infra/production.tf"],
        reviewGoal: "Review the release package for deployment risk and rollback gaps",
        reviewOutput: "release-review",
        children: task({
          goal: "Check the release artifacts for missing operator guidance",
          agent: "pi",
          context: [
            output("release-notes"),
            output("rollout-guide"),
            "Look for missing rollback notes, smoke checks, and on-call instructions."
          ]
        })
      })
    ]
  });
}
