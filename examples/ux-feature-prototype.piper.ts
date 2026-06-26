import {
	agent,
	artifact,
	evaluate,
	feedback,
	gate,
	loop,
	parallel,
	policy,
	step,
} from "@beyland/piper";

const productIntent = artifact("product-intent", "brief");
const interactionAudit = artifact("interaction-audit", "ux-review");
const designSystemAudit = artifact("design-system-fit", "design-system-review");
const prototypePlan = artifact("prototype-plan", "plan");
const codedPrototype = artifact("coded-prototype", "prototype");
const handoffNotes = artifact("ux-handoff-notes", "handoff");

export default function uxFeaturePrototypeLoop() {
	return loop(
		{
			objective: "Prototype a new product feature in code with UX engineering guardrails",
			agents: [
				agent("ux engineer", {
					harness: "copilot",
					instructions:
						"Work in code, but optimize for interaction quality, design-system fit, accessibility, and clear product tradeoffs.",
				}),
				agent("product partner", {
					harness: "copilot",
					instructions:
						"Clarify user goals, constraints, and success criteria before implementation.",
				}),
			],
		},
		feedback({
			source: "design review",
			scope: "prototype-quality",
			severity: "info",
			message:
				"Prototype code should make product decisions visible, avoid one-off styling when system primitives exist, and document intentional gaps.",
		}),
		step({
			role: "product partner",
			goal: "Summarize the target user, problem, non-goals, success criteria, and open product questions.",
			produces: productIntent,
		}),
		parallel(
			{ status: "Checking interaction and system fit before coding..." },
			step({
				role: "ux engineer",
				goal: "Map the key user flow, edge states, empty states, loading states, and error states for the prototype.",
				context: [productIntent],
				produces: interactionAudit,
			}),
			step({
				role: "ux engineer",
				goal: "Identify reusable design-system components, tokens, patterns, and accessibility requirements for the feature.",
				context: [productIntent],
				produces: designSystemAudit,
			}),
		),
		policy(
			{
				name: "prototype boundaries",
				constraints: [
					"Prefer reversible prototype changes over broad architecture rewrites.",
					"Keep visual styling aligned with existing design-system tokens and components.",
					"Call out mocked data, incomplete product decisions, and intentional shortcuts.",
				],
			},
			step({
				role: "ux engineer",
				goal: "Create a concise prototype plan that names the files to touch and the user states to implement.",
				context: [productIntent, interactionAudit, designSystemAudit],
				produces: prototypePlan,
			}),
			gate({
				name: "approve prototype direction",
				message: "Product and design approve the prototype scope before coding.",
			}),
			step({
				role: "ux engineer",
				goal: "Build the coded prototype and keep the implementation easy to revise after design review.",
				context: [prototypePlan],
				produces: codedPrototype,
				acceptanceCriteria: [
					"Primary path and major edge states are visible in code.",
					"Prototype uses existing design-system primitives where available.",
					"Accessibility affordances are included for interactive controls.",
				],
			}),
		),
		step({
			role: "ux engineer",
			goal: "Write handoff notes covering interaction decisions, known gaps, follow-up questions, and validation suggestions.",
			context: [productIntent, interactionAudit, designSystemAudit, codedPrototype],
			produces: handoffNotes,
		}),
		evaluate({
			name: "handoff captures prototype gaps",
			using: async ({ readArtifact }) =>
				(await readArtifact("ux-handoff-notes")).toLowerCase().includes("gap"),
			feedback:
				"Add known gaps and intentional shortcuts so reviewers can distinguish prototype debt from bugs.",
		}),
	);
}
