import { Task, output } from "agent-runtime";

import { WithImplementationPlan } from "./shared-tasks/with-implementation-plan.js";
import { WithRiskReview } from "./shared-tasks/with-risk-review.js";
import { WithTests } from "./shared-tasks/with-tests.js";

export default function ComposableOAuthWorkflow() {
  return (
    <WithTests testCommand="pnpm test -- oauth">
      <WithRiskReview
        protectedFiles={["src/auth/legacy-oauth.ts", "infra/oauth-secrets.env"]}
        reviewGoal="Review the OAuth changes for token handling, rollback readiness, and supportability"
        reviewOutput="oauth-review"
      >
        <WithImplementationPlan
          planningGoal="Create a shared implementation plan for an OAuth login and token refresh rollout"
          planOutput="oauth-plan"
          fallback="Using the OAuth plan to coordinate endpoint work..."
        >
          <Task
            goal="Add the OAuth login endpoint and callback handling"
            agent="pi"
            context={[
              output("oauth-plan"),
              "Preserve existing session semantics and redirect behavior."
            ]}
          />
          <Task
            goal="Add the OAuth token refresh endpoint and related validation"
            agent="pi"
            context={[
              output("oauth-plan"),
              "Keep refresh token handling compatible with the rollout plan."
            ]}
          />
        </WithImplementationPlan>
      </WithRiskReview>
    </WithTests>
  );
}