import { output, parallel, protect, recover, task } from "piper";

export default function oAuthWorkflow() {
  return recover(
    {
      maxRetries: 2,
      fallback: (error, retry) =>
        task({
          goal: `Recover from workflow failure: ${error.message}`,
          agent: "pi",
          context: [`Failure details: ${error.logs ?? "none"}`],
          "on:complete": () => retry()
        })
    },
    task({
      goal: "Create a plan for implementing OAuth2 login flow",
      agent: "pi",
      context: [
        "The codebase uses Express and PostgreSQL.",
        "The auth module lives in src/auth/."
      ],
      output: "plan"
    }),
    parallel(
      { fallback: "Waiting for implementation tasks to complete..." },
      task({
        goal: "Implement the OAuth controller based on the plan",
        agent: "pi",
        context: [output("plan")]
      }),
      task({
        goal: "Write tests for the OAuth flow",
        agent: "pi",
        context: [output("plan")]
      })
    ),
    protect(
      { protectedFiles: ["auth_legacy.ts"], validate: ["node -e \"process.exit(0)\""] },
      task({
        goal: "Review the OAuth implementation for security issues",
        agent: "pi",
        context: ["Look for token leakage, missing CSRF protection, and insecure redirect handling."]
      })
    )
  );
}
