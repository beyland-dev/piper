import { artifact, workflow, task } from "@beyland/piper";
import { withDesignSystemAudit } from "./shared-tasks/with-design-system-audit.js";
import { withTests } from "./shared-tasks/with-tests.js";

export default function designSystemAdherenceWorkflow() {
	return withTests({
		testCommand: "pnpm test -- design-system",
		steps: workflow(
			withDesignSystemAudit({
				designSystemDocs: [
					"docs/design-system.md",
					"packages/ui/tokens.ts",
					"packages/ui/button.tsx",
				],
				protectedFiles: ["packages/ui/tokens.ts", "packages/ui/theme.css"],
				auditGoal: "Audit the checkout UI changes for design system adherence before handoff",
				auditOutput: "checkout-design-system-audit",
				steps: task({
					goal: "Normalize the checkout screen to existing design system components",
					harness: "pi",
					context: [
						"Prefer existing Button, Card, FormField, and Alert primitives over custom CSS.",
						"Keep token definitions unchanged unless the audit explicitly calls for a separate design system proposal.",
					],
					artifact: "checkout-ui-normalization",
				}),
			}),
			task({
				goal: "Create follow-up tickets from the design system audit findings",
				harness: "pi",
				context: [
					artifact("checkout-design-system-audit").value(),
					"Group related adherence issues and include recommended system primitives.",
				],
			}),
		),
	});
}
