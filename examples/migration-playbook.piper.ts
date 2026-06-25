import { runtimeValue, artifact, parallel, protect, workflow, task } from "piper";

export default function migrationPlaybookWorkflow() {
  return workflow(
    task({
      goal: "Inventory the legacy surface area before the migration begins",
      harness: "pi",
      context: [
        "Map the major integration points, risky files, and ordering constraints.",
        "Call out anything that will need a compatibility layer or phased rollout."
      ],
      artifact: "inventory"
    }),
    parallel(
      { status: "Designing migration tracks for API and data changes..." },
      task({
        goal: "Design the API compatibility track for the migration",
        harness: "pi",
        context: [
          artifact("inventory").value(),
          runtimeValue(({ workspacePath }) => `Workspace root for this migration: ${workspacePath}`, "workspace root")
        ],
        artifact: "api-track"
      }),
      task({
        goal: "Design the data backfill and cutover track for the migration",
        harness: "pi",
        context: [artifact("inventory").value()],
        artifact: "data-track"
      })
    ),
    task({
      goal: "Compose a final migration playbook from both tracks",
      harness: "pi",
      context: [
        artifact("api-track").value(),
        artifact("data-track").value(),
        runtimeValue(async ({ readTaskResult }) => {
          const apiTrack = await readTaskResult("api-track");
          const dataTrack = await readTaskResult("data-track");
          return `The API track modified ${apiTrack.modifiedFiles.length} files; the data track modified ${dataTrack.modifiedFiles.length} files.`;
        }, "track modification counts")
      ],
      artifact: "migration-playbook",
      validate: [
        runtimeValue(async ({ readArtifact }) => {
          const playbook = (await readArtifact("migration-playbook")).toLowerCase();
          return playbook.includes("rollback") && playbook.includes("cutover");
        }, "playbook mentions cutover and rollback")
      ]
    }),
    protect(
      {
        protectedFiles: ["src/legacy/billing.ts", "migrations/001_initial.sql"],
        validate: [
          runtimeValue(async ({ readArtifact }) => (await readArtifact("migration-playbook")).includes("phase"), "playbook is phased")
        ]
      },
      task({
        goal: "Review the migration playbook for sequencing and rollback gaps",
        harness: "pi",
        context: [
          artifact("migration-playbook").value(),
          "Focus on dependency ordering, rollback checkpoints, and stakeholder coordination."
        ]
      })
    )
  );
}
