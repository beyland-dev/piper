import { runtimeValue, artifact, parallel, protect, recover, workflow, task } from "@beyland/piper";

export default function incidentResponseWorkflow() {
  return workflow(
    task({
      goal: "Summarize the production incident from logs, alerts, and recent deploys",
      harness: "pi",
      context: [
        "Describe the blast radius, likely root cause, and the most suspicious files or services.",
        "Prefer a concise brief that can drive both engineering and stakeholder updates."
      ],
      artifact: "incident-brief",
      "on:complete": (result) => {
        console.log(`Captured incident brief with ${result.modifiedFiles.length} modified files.`);
      }
    }),
    parallel(
      {
        status: "Investigating the incident, preparing a hotfix, and drafting stakeholder guidance..."
      },
      task({
        goal: "Implement the smallest safe hotfix for the incident",
        harness: "pi",
        context: [
          artifact("incident-brief").value(),
          runtimeValue(async ({ readTaskResult }) => {
            const incident = await readTaskResult("incident-brief");
            return `Prefer files already implicated by the brief: ${incident.modifiedFiles.join(", ") || "none"}`;
          }, "incident file focus")
        ],
        artifact: "hotfix",
        validate: [
          runtimeValue(
            async ({ readArtifact }) => (await readArtifact("incident-brief")).toLowerCase().includes("root cause"),
            "incident brief identifies a root cause"
          )
        ],
        "on:error": (error) => {
          console.error(`Hotfix attempt failed: ${error.message}`);
        }
      }),
      task({
        goal: "Prepare a customer-facing incident update and next-step summary",
        harness: "pi",
        context: [artifact("incident-brief").value()],
        artifact: "status-update"
      })
    ),
    recover(
      {
        maxRetries: 2,
        onFailure: (error, retry) =>
          task({
            goal: `Diagnose why the verification phase failed after the hotfix: ${error.message}`,
            harness: "pi",
            context: [`Verification failure logs:\n${error.logs ?? "none"}`],
            "on:complete": () => retry()
          })
      },
      protect(
        {
          protectedFiles: ["db/schema.sql", "infra/secrets.env"],
          validate: [
            runtimeValue(async ({ readArtifact }) => (await readArtifact("postmortem-outline")).trim().length > 40, "postmortem outline exists")
          ]
        },
        task({
          goal: "Verify the hotfix, add a regression test, and draft a short postmortem outline",
          harness: "pi",
          context: [
            artifact("hotfix").value(),
            artifact("status-update").value(),
            "Call out residual risk, missing test coverage, and any follow-up work that should be ticketed."
          ],
          constraints: ["do not modify db/schema.sql", "do not modify infra/secrets.env"],
          artifact: "postmortem-outline"
        })
      )
    )
  );
}
