import { agent, artifact, evaluate, loop, parallel, step } from "@beyland/piper";

const keyboardAudit = artifact("keyboard-audit", "accessibility-report");
const screenReaderAudit = artifact("screen-reader-audit", "accessibility-report");
const contrastAudit = artifact("contrast-audit", "accessibility-report");
const remediationPlan = artifact("accessibility-remediation-plan", "plan");

export default function accessibilityAuditLoop() {
	return loop(
		{
			objective: "Audit a product surface for accessibility regressions",
			agents: [
				agent("auditor", {
					harness: "copilot",
					instructions: "Prefer read-only inspection unless asked to prepare fixes.",
				}),
				agent("planner", { harness: "copilot" }),
			],
		},
		parallel(
			{ status: "Running accessibility checks in parallel..." },
			step({
				role: "auditor",
				goal: "Audit keyboard navigation, focus order, and focus visibility.",
				produces: keyboardAudit,
			}),
			step({
				role: "auditor",
				goal: "Audit screen reader labels, landmarks, and announcement behavior.",
				produces: screenReaderAudit,
			}),
			step({
				role: "auditor",
				goal: "Audit color contrast, reduced-motion handling, and visible states.",
				produces: contrastAudit,
			}),
		),
		step({
			role: "planner",
			goal: "Combine the accessibility findings into a prioritized remediation plan.",
			context: [keyboardAudit, screenReaderAudit, contrastAudit],
			produces: remediationPlan,
		}),
		evaluate({
			name: "remediation plan is actionable",
			using: async ({ readArtifact }) => {
				const plan = await readArtifact("accessibility-remediation-plan");
				return plan.toLowerCase().includes("priority");
			},
			feedback: "Add explicit priorities before handing this plan to implementers.",
		}),
	);
}
