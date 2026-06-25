import { ErrorBoundary, Guarded, Suspense, Task, useOutput } from "agent-runtime";

export default function OAuthWorkflow() {
  return (
    <ErrorBoundary
      maxRetries={2}
      fallback={(error, retry) => (
        <Task
          goal={`Recover from workflow failure: ${error.message}`}
          agent="pi"
          context={[`Failure details: ${error.logs ?? "none"}`]}
          on:complete={() => retry()}
        />
      )}
    >
      <Task
        goal="Create a plan for implementing OAuth2 login flow"
        agent="pi"
        context={[
          "The codebase uses Express and PostgreSQL.",
          "The auth module lives in src/auth/."
        ]}
        output="plan"
      />

      <Suspense fallback="Waiting for implementation tasks to complete...">
        <Task
          goal="Implement the OAuth controller based on the plan"
          agent="pi"
          context={[useOutput("plan")]}
        />
        <Task
          goal="Write tests for the OAuth flow"
          agent="pi"
          context={[useOutput("plan")]}
        />
      </Suspense>

      <Guarded protectedFiles={["auth_legacy.ts"]} validate={["node -e \"process.exit(0)\""]}>
        <Task
          goal="Review the OAuth implementation for security issues"
          agent="pi"
          context={["Look for token leakage, missing CSRF protection, and insecure redirect handling."]}
        />
      </Guarded>
    </ErrorBoundary>
  );
}
