import { derive, protect, sequence, task, type TaskNode } from "agent-runtime";

interface WithDesignSystemAuditProps {
  designSystemDocs?: string[];
  protectedFiles?: string[];
  auditGoal?: string;
  auditOutput?: string;
  steps?: TaskNode | TaskNode[];
}

export function withDesignSystemAudit({
  designSystemDocs = ["docs/design-system.md", "packages/ui/tokens.ts", "packages/ui/components"],
  protectedFiles = ["packages/ui/tokens.ts"],
  auditGoal = "Audit the changes for design system adherence",
  auditOutput = "design-system-audit",
  steps
}: WithDesignSystemAuditProps) {
  return protect(
    {
      protectedFiles,
      validate: [
        derive(async ({ readOutput }) => {
          const audit = (await readOutput(auditOutput)).toLowerCase();
          return audit.includes("design system") && (audit.includes("token") || audit.includes("component"));
        }, `${auditOutput} checks design system primitives`)
      ]
    },
    sequence(
      steps,
      task({
        goal: auditGoal,
        agent: "pi",
        context: [
          `Use these design system references as the source of truth: ${designSystemDocs.join(", ")}`,
          "Check spacing, typography, color, component reuse, accessibility states, and places where one-off CSS should be replaced.",
          "Return findings in a format another automation can consume: file, issue, severity, and recommended system primitive."
        ],
        constraints: protectedFiles.map((file) => `do not modify ${file}`),
        output: auditOutput
      })
    )
  );
}
