import { agent, artifact, feedback, loop, parallel, step } from "@beyland/piper";

const timeline = artifact("escalation-timeline", "incident-timeline");
const reproduction = artifact("escalation-reproduction", "bug-report");
const customerUpdate = artifact("customer-update", "status-update");

export default function customerEscalationLoop() {
	return loop(
		{
			objective: "Triage a customer escalation and prepare a safe response",
			agents: [
				agent("support engineer", { harness: "copilot" }),
				agent("maintainer", { harness: "copilot" }),
			],
		},
		feedback({
			source: "support",
			scope: "customer-impact",
			severity: "warning",
			message: "Customer-facing updates must separate confirmed facts from hypotheses.",
		}),
		parallel(
			step({
				role: "support engineer",
				goal: "Build a timeline from reports, logs, and recent changes.",
				produces: timeline,
			}),
			step({
				role: "maintainer",
				goal: "Attempt to reproduce the escalation with the available information.",
				produces: reproduction,
			}),
		),
		step({
			role: "support engineer",
			goal: "Draft a customer update with status, impact, next steps, and unknowns.",
			context: [timeline, reproduction],
			produces: customerUpdate,
		}),
	);
}
