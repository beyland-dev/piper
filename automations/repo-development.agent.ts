import { derive, output, task } from "agent-runtime";

import { withImplementationPlan } from "../examples/shared-tasks/with-implementation-plan.js";
import { withRiskReview } from "../examples/shared-tasks/with-risk-review.js";
import { withTests } from "../examples/shared-tasks/with-tests.js";

export default function repoDevelopmentWorkflow() {
  return withTests({
    testCommand: "pnpm test",
    children: [
      withImplementationPlan({
        planningGoal: "Inspect src/, tests/, and README.md, then choose one small high-leverage improvement for the agent runtime that can be completed safely in a single pass",
        planOutput: "repo-improvement-plan",
        fallback: "Preparing a focused improvement plan for the repository...",
        children: [
          task({
            goal: "Implement the planned improvement, keeping the change narrow and adding or updating focused tests",
            agent: "pi",
            context: [
              output("repo-improvement-plan"),
              derive(async ({ readTaskResult }) => {
                const plan = await readTaskResult("repo-improvement-plan");
                return `The planning step modified ${plan.modifiedFiles.length} files while preparing the recommendation.`;
              }, "repo improvement plan file count"),
              "Prefer changes in src/ and tests/ unless the plan specifically calls for user-facing documentation updates.",
              "Keep public API changes minimal and justify them in code comments or test names when they are unavoidable."
            ],
            output: "implementation-summary",
            validate: [
              "pnpm typecheck",
              derive(async ({ readOutput }) => {
                const plan = (await readOutput("repo-improvement-plan")).toLowerCase();
                return plan.includes("test") || plan.includes("validation");
              }, "implementation plan includes testing guidance")
            ]
          }),
          task({
            goal: "Update README guidance only if the implemented improvement changes how maintainers should author or run workflows",
            agent: "pi",
            context: [
              output("repo-improvement-plan"),
              output("implementation-summary"),
              "Skip documentation edits when the change is purely internal and does not affect authoring, runtime behavior, or development commands."
            ]
          })
        ]
      }),
      withRiskReview({
        protectedFiles: ["ARCHITECTURE.md", "pnpm-lock.yaml"],
        reviewGoal: "Review the completed repository change for runtime risk, missing validation, and any maintainer follow-up work",
        reviewOutput: "repo-risk-review",
        children: task({
          goal: "Write a short maintainer handoff summary for the completed repository improvement",
          agent: "pi",
          context: [
            output("implementation-summary"),
            output("repo-risk-review"),
            "Summarize what changed, why it was chosen, and what a maintainer should verify before merging."
          ],
          output: "maintainer-handoff"
        })
      })
    ]
  });
}
