import { Task } from "agent-runtime";

export default function SimpleTaskWorkflow() {
  return (
    <Task
      goal="Inspect the current repository and describe the next implementation step."
      agent="pi"
      context={[
        "Stay inside the current workspace.",
        "Summarize the codebase briefly before proposing the next step."
      ]}
    />
  );
}
