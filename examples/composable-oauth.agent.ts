import { output, task } from "agent-runtime";

import { withImplementationPlan } from "./shared-tasks/with-implementation-plan.js";
import { withRiskReview } from "./shared-tasks/with-risk-review.js";
import { withTests } from "./shared-tasks/with-tests.js";

export default function composableOAuthWorkflow() {
  return withTests({
    testCommand: "pnpm test -- oauth",
    steps: withRiskReview({
      protectedFiles: ["src/auth/legacy-oauth.ts", "infra/oauth-secrets.env"],
      reviewGoal: "Review the OAuth changes for token handling, rollback readiness, and supportability",
      reviewOutput: "oauth-review",
      steps: withImplementationPlan({
        planningGoal: "Create a shared implementation plan for an OAuth login and token refresh rollout",
        planOutput: "oauth-plan",
        fallback: "Using the OAuth plan to coordinate endpoint work...",
        steps: [
          task({
            goal: "Add the OAuth login endpoint and callback handling",
            agent: "pi",
            context: [
              output("oauth-plan"),
              "Preserve existing session semantics and redirect behavior."
            ]
          }),
          task({
            goal: "Add the OAuth token refresh endpoint and related validation",
            agent: "pi",
            context: [
              output("oauth-plan"),
              "Keep refresh token handling compatible with the rollout plan."
            ]
          })
        ]
      })
    })
  });
}
