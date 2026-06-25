import { derive, output, parallel, protect, recover, sequence, task } from "piper";

export default function incidentResponseWorkflow() {
  return sequence(
    task({
      goal: "Summarize the production incident from logs, alerts, and recent deploys",
      agent: "pi",
      context: [
        "Describe the blast radius, likely root cause, and the most suspicious files or services.",
        "Prefer a concise brief that can drive both engineering and stakeholder updates."
      ],
      output: "incident-brief",
      "on:complete": (result) => {
        console.log(`Captured incident brief with ${result.modifiedFiles.length} modified files.`);
      }
    }),
    parallel(
      {
        fallback: task({
          goal: "Draft a temporary status update while the investigation is in progress",
          agent: "pi",
          context: [
            "Acknowledge the incident, note active investigation, and avoid overcommitting to an ETA."
          ]
        })
      },
      task({
        goal: "Implement the smallest safe hotfix for the incident",
        agent: "pi",
        context: [
          output("incident-brief"),
          derive(async ({ readTaskResult }) => {
            const incident = await readTaskResult("incident-brief");
            return `Prefer files already implicated by the brief: ${incident.modifiedFiles.join(", ") || "none"}`;
          }, "incident file focus")
        ],
        output: "hotfix",
        validate: [
          derive(
            async ({ readOutput }) => (await readOutput("incident-brief")).toLowerCase().includes("root cause"),
            "incident brief identifies a root cause"
          )
        ],
        "on:error": (error) => {
          console.error(`Hotfix attempt failed: ${error.message}`);
        }
      }),
      task({
        goal: "Prepare a customer-facing incident update and next-step summary",
        agent: "pi",
        context: [output("incident-brief")],
        output: "status-update"
      })
    ),
    recover(
      {
        maxRetries: 2,
        fallback: (error, retry) =>
          task({
            goal: `Diagnose why the verification phase failed after the hotfix: ${error.message}`,
            agent: "pi",
            context: [`Verification failure logs:\n${error.logs ?? "none"}`],
            "on:complete": () => retry()
          })
      },
      protect(
        {
          protectedFiles: ["db/schema.sql", "infra/secrets.env"],
          validate: [
            derive(async ({ readOutput }) => (await readOutput("postmortem-outline")).trim().length > 40, "postmortem outline exists")
          ]
        },
        task({
          goal: "Verify the hotfix, add a regression test, and draft a short postmortem outline",
          agent: "pi",
          context: [
            output("hotfix"),
            output("status-update"),
            "Call out residual risk, missing test coverage, and any follow-up work that should be ticketed."
          ],
          constraints: ["do not modify db/schema.sql", "do not modify infra/secrets.env"],
          output: "postmortem-outline"
        })
      )
    )
  );
}
