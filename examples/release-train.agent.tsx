import { ErrorBoundary, Guarded, Suspense, Task, computed, useOutput } from "agent-runtime";

export default function ReleaseTrainWorkflow() {
  return (
    <ErrorBoundary
      maxRetries={1}
      fallback={(error, retry) => (
        <Task
          goal={`Prepare a rollback-oriented recovery plan for the failed release workflow: ${error.message}`}
          agent="pi"
          context={[`Failure logs:\n${error.logs ?? "none"}`]}
          on:complete={() => retry()}
        />
      )}
    >
      <Task
        goal="Audit the branch for release readiness"
        agent="pi"
        context={[
          "Identify risky diffs, incomplete migrations, and missing operator documentation.",
          "Summarize the highest-risk files before proposing rollout work."
        ]}
        output="audit"
      />

      <Task
        goal="Draft a release checklist and deployment sequence"
        agent="pi"
        context={[
          useOutput("audit"),
          computed(async ({ readTaskResult }) => {
            const audit = await readTaskResult("audit");
            return `Files touched during the audit: ${audit.modifiedFiles.join(", ") || "none"}`;
          }, "audit modified files")
        ]}
        output="release-plan"
        validate={[
          computed(async ({ readOutput }) => (await readOutput("audit")).trim().length > 0, "audit output is present")
        ]}
      />

      <Suspense fallback="Preparing release notes and rollout guidance in parallel...">
        <Task
          goal="Write changelog entries and operator notes for the release"
          agent="pi"
          context={[useOutput("release-plan")]}
          output="release-notes"
        />

        <Task
          goal="Produce a rollout and rollback guide for the release"
          agent="pi"
          context={[
            useOutput("release-plan"),
            computed(async ({ readTaskResult }) => {
              const plan = await readTaskResult("release-plan");
              return `The release plan modified ${plan.modifiedFiles.length} files while being prepared.`;
            }, "release plan metadata")
          ]}
          output="rollout-guide"
        />
      </Suspense>

      <Guarded
        protectedFiles={["infra/production.tf", ".github/workflows/release.yml"]}
        validate={[
          computed(async ({ readOutput }) => {
            const notes = (await readOutput("release-notes")).toLowerCase();
            const guide = (await readOutput("rollout-guide")).toLowerCase();
            return notes.includes("rollback") || guide.includes("rollback");
          }, "release artifacts mention rollback")
        ]}
      >
        <Task
          goal="Review the release package for production risk"
          agent="pi"
          context={[
            useOutput("release-notes"),
            useOutput("rollout-guide"),
            "Focus on deployment risk, observability gaps, and operator handoff quality."
          ]}
          constraints={["do not modify infra/production.tf"]}
        />
      </Guarded>
    </ErrorBoundary>
  );
}