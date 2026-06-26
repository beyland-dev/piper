import { agent, artifact, gate, loop, policy, step } from "@beyland/piper";

const flagPlan = artifact("feature-flag-plan", "rollout-plan");
const observabilityPlan = artifact("feature-observability-plan", "monitoring-plan");
const launchChecklist = artifact("feature-launch-checklist", "checklist");

export default function featureFlagRolloutLoop() {
	return loop(
		{
			objective: "Prepare a feature flag rollout with observability and rollback coverage",
			agents: [
				agent("release manager", { harness: "copilot" }),
				agent("observability reviewer", { harness: "copilot" }),
			],
		},
		policy(
			{
				name: "safe feature rollout",
				constraints: [
					"Use gradual rollout stages.",
					"Include rollback criteria before broad enablement.",
				],
			},
			step({
				role: "release manager",
				goal: "Draft a staged feature flag rollout plan.",
				produces: flagPlan,
			}),
			step({
				role: "observability reviewer",
				goal: "Define metrics, logs, dashboards, and alerts for the rollout.",
				context: [flagPlan],
				produces: observabilityPlan,
			}),
			gate({ name: "approve staged rollout" }),
			step({
				role: "release manager",
				goal: "Create the final launch checklist with owners and rollback triggers.",
				context: [flagPlan, observabilityPlan],
				produces: launchChecklist,
			}),
		),
	);
}
