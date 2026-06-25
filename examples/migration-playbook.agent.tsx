import { Guarded, Suspense, Task, computed, useOutput } from "agent-runtime";

export default function MigrationPlaybookWorkflow() {
  return (
    <>
      <Task
        goal="Inventory the legacy surface area before the migration begins"
        agent="pi"
        context={[
          "Map the major integration points, risky files, and ordering constraints.",
          "Call out anything that will need a compatibility layer or phased rollout."
        ]}
        output="inventory"
      />

      <Suspense fallback="Designing migration tracks for API and data changes...">
        <Task
          goal="Design the API compatibility track for the migration"
          agent="pi"
          context={[
            useOutput("inventory"),
            computed(({ workspacePath }) => `Workspace root for this migration: ${workspacePath}`, "workspace root")
          ]}
          output="api-track"
        />

        <Task
          goal="Design the data backfill and cutover track for the migration"
          agent="pi"
          context={[useOutput("inventory")]}
          output="data-track"
        />
      </Suspense>

      <Task
        goal="Compose a final migration playbook from both tracks"
        agent="pi"
        context={[
          useOutput("api-track"),
          useOutput("data-track"),
          computed(async ({ readTaskResult }) => {
            const apiTrack = await readTaskResult("api-track");
            const dataTrack = await readTaskResult("data-track");
            return `The API track modified ${apiTrack.modifiedFiles.length} files; the data track modified ${dataTrack.modifiedFiles.length} files.`;
          }, "track modification counts")
        ]}
        output="migration-playbook"
        validate={[
          computed(async ({ readOutput }) => {
            const playbook = (await readOutput("migration-playbook")).toLowerCase();
            return playbook.includes("rollback") && playbook.includes("cutover");
          }, "playbook mentions cutover and rollback")
        ]}
      />

      <Guarded
        protectedFiles={["src/legacy/billing.ts", "migrations/001_initial.sql"]}
        validate={[
          computed(async ({ readOutput }) => (await readOutput("migration-playbook")).includes("phase"), "playbook is phased")
        ]}
      >
        <Task
          goal="Review the migration playbook for sequencing and rollback gaps"
          agent="pi"
          context={[
            useOutput("migration-playbook"),
            "Focus on dependency ordering, rollback checkpoints, and stakeholder coordination."
          ]}
        />
      </Guarded>
    </>
  );
}