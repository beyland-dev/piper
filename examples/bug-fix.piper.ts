import { protect, task } from "piper";

export default function bugFixWorkflow() {
  return protect(
    { protectedFiles: ["legacy-auth.ts"], validate: ["node -e \"process.exit(0)\""] },
    task({
      goal: "Fix the login redirect bug without touching the legacy authentication module.",
      harness: "pi",
      context: [
        "Preserve existing OAuth callback behavior.",
        "Add or update tests if the workspace already has them."
      ]
    })
  );
}
