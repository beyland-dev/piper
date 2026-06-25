import { Protect, Task } from "agent-runtime";

export default function BugFixWorkflow() {
  return (
    <Protect protectedFiles={["legacy-auth.ts"]} validate={["node -e \"process.exit(0)\""]}>
      <Task
        goal="Fix the login redirect bug without touching the legacy authentication module."
        agent="pi"
        context={[
          "Preserve existing OAuth callback behavior.",
          "Add or update tests if the workspace already has them."
        ]}
      />
    </Protect>
  );
}
