import { artifact, parallel, protect, recover, task } from "@beyland/piper";

export default function oAuthWorkflow() {
  return recover(
    {
      maxRetries: 2,
      onFailure: (error, retry) =>
        task({
          goal: `Recover from workflow failure: ${error.message}`,
          harness: "pi",
          context: [`Failure details: ${error.logs ?? "none"}`],
          "on:complete": () => retry()
        })
    },
    task({
      goal: "Create a plan for implementing OAuth2 login flow",
      harness: "pi",
      context: [
        "The codebase uses Express and PostgreSQL.",
        "The auth module lives in src/auth/."
      ],
      artifact: "plan"
    }),
    parallel(
      { status: "Waiting for implementation tasks to complete..." },
      task({
        goal: "Implement the OAuth controller based on the plan",
        harness: "pi",
        context: [artifact("plan").value()]
      }),
      task({
        goal: "Write tests for the OAuth flow",
        harness: "pi",
        context: [artifact("plan").value()]
      })
    ),
    protect(
      { protectedFiles: ["auth_legacy.ts"], validate: ["node -e \"process.exit(0)\""] },
      task({
        goal: "Review the OAuth implementation for security issues",
        harness: "pi",
        context: ["Look for token leakage, missing CSRF protection, and insecure redirect handling."]
      })
    )
  );
}
