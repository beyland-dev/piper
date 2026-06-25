import { derive, output, parallel, protect, recover, task } from "piper";

export default function releaseTrainWorkflow() {
  return recover(
    {
      maxRetries: 1,
      fallback: (error, retry) =>
        task({
          goal: `Prepare a rollback-oriented recovery plan for the failed release workflow: ${error.message}`,
          agent: "pi",
          context: [`Failure logs:\n${error.logs ?? "none"}`],
          "on:complete": () => retry()
        })
    },
    task({
      goal: "Audit the branch for release readiness",
      agent: "pi",
      context: [
        "Identify risky diffs, incomplete migrations, and missing operator documentation.",
        "Summarize the highest-risk files before proposing rollout work."
      ],
      output: "audit"
    }),
    task({
      goal: "Draft a release checklist and deployment sequence",
      agent: "pi",
      context: [
        output("audit"),
        derive(async ({ readTaskResult }) => {
          const audit = await readTaskResult("audit");
          return `Files touched during the audit: ${audit.modifiedFiles.join(", ") || "none"}`;
        }, "audit modified files")
      ],
      output: "release-plan",
      validate: [
        derive(async ({ readOutput }) => (await readOutput("audit")).trim().length > 0, "audit output is present")
      ]
    }),
    parallel(
      { fallback: "Preparing release notes and rollout guidance in parallel..." },
      task({
        goal: "Write changelog entries and operator notes for the release",
        agent: "pi",
        context: [output("release-plan")],
        output: "release-notes"
      }),
      task({
        goal: "Produce a rollout and rollback guide for the release",
        agent: "pi",
        context: [
          output("release-plan"),
          derive(async ({ readTaskResult }) => {
            const plan = await readTaskResult("release-plan");
            return `The release plan modified ${plan.modifiedFiles.length} files while being prepared.`;
          }, "release plan metadata")
        ],
        output: "rollout-guide"
      })
    ),
    protect(
      {
        protectedFiles: ["infra/production.tf", ".github/workflows/release.yml"],
        validate: [
          derive(async ({ readOutput }) => {
            const notes = (await readOutput("release-notes")).toLowerCase();
            const guide = (await readOutput("rollout-guide")).toLowerCase();
            return notes.includes("rollback") || guide.includes("rollback");
          }, "release artifacts mention rollback")
        ]
      },
      task({
        goal: "Review the release package for production risk",
        agent: "pi",
        context: [
          output("release-notes"),
          output("rollout-guide"),
          "Focus on deployment risk, observability gaps, and operator handoff quality."
        ],
        constraints: ["do not modify infra/production.tf"]
      })
    )
  );
}
