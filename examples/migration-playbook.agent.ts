import { derive, output, parallel, protect, sequence, task } from "piper";

export default function migrationPlaybookWorkflow() {
  return sequence(
    task({
      goal: "Inventory the legacy surface area before the migration begins",
      agent: "pi",
      context: [
        "Map the major integration points, risky files, and ordering constraints.",
        "Call out anything that will need a compatibility layer or phased rollout."
      ],
      output: "inventory"
    }),
    parallel(
      { fallback: "Designing migration tracks for API and data changes..." },
      task({
        goal: "Design the API compatibility track for the migration",
        agent: "pi",
        context: [
          output("inventory"),
          derive(({ workspacePath }) => `Workspace root for this migration: ${workspacePath}`, "workspace root")
        ],
        output: "api-track"
      }),
      task({
        goal: "Design the data backfill and cutover track for the migration",
        agent: "pi",
        context: [output("inventory")],
        output: "data-track"
      })
    ),
    task({
      goal: "Compose a final migration playbook from both tracks",
      agent: "pi",
      context: [
        output("api-track"),
        output("data-track"),
        derive(async ({ readTaskResult }) => {
          const apiTrack = await readTaskResult("api-track");
          const dataTrack = await readTaskResult("data-track");
          return `The API track modified ${apiTrack.modifiedFiles.length} files; the data track modified ${dataTrack.modifiedFiles.length} files.`;
        }, "track modification counts")
      ],
      output: "migration-playbook",
      validate: [
        derive(async ({ readOutput }) => {
          const playbook = (await readOutput("migration-playbook")).toLowerCase();
          return playbook.includes("rollback") && playbook.includes("cutover");
        }, "playbook mentions cutover and rollback")
      ]
    }),
    protect(
      {
        protectedFiles: ["src/legacy/billing.ts", "migrations/001_initial.sql"],
        validate: [
          derive(async ({ readOutput }) => (await readOutput("migration-playbook")).includes("phase"), "playbook is phased")
        ]
      },
      task({
        goal: "Review the migration playbook for sequencing and rollback gaps",
        agent: "pi",
        context: [
          output("migration-playbook"),
          "Focus on dependency ordering, rollback checkpoints, and stakeholder coordination."
        ]
      })
    )
  );
}
