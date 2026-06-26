import { agent, artifact, gate, loop, step } from "@beyland/piper";

const contractInventory = artifact("contract-inventory", "api-contract");
const compatibilityReport = artifact("compatibility-report", "risk-assessment");
const rolloutNotes = artifact("api-rollout-notes", "release-notes");

export default function apiContractReviewLoop() {
	return loop(
		{
			objective: "Review an API change for compatibility and rollout risk",
			agents: [
				agent("contract reviewer", {
					harness: "copilot",
					instructions: "Focus on request/response shape, versioning, and consumers.",
				}),
				agent("release writer", { harness: "copilot" }),
			],
		},
		step({
			role: "contract reviewer",
			goal: "Inventory the affected API endpoints, schemas, and known consumers.",
			produces: contractInventory,
		}),
		step({
			role: "contract reviewer",
			goal: "Assess backward compatibility, migration needs, and deprecation risk.",
			context: [contractInventory],
			produces: compatibilityReport,
			acceptanceCriteria: [
				"Call out every breaking change candidate.",
				"Identify consumer communication requirements.",
			],
		}),
		gate({
			name: "approve API compatibility plan",
			message: "Confirm the compatibility report is ready before writing rollout notes.",
		}),
		step({
			role: "release writer",
			goal: "Draft release notes and consumer guidance for the API change.",
			context: [contractInventory, compatibilityReport],
			produces: rolloutNotes,
		}),
	);
}
