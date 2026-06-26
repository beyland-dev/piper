import { agent, artifact, gate, loop, parallel, policy, step } from "@beyland/piper";

const threatModel = artifact("threat-model", "security-review");
const dependencyReview = artifact("security-dependency-review", "security-review");
const hardeningPlan = artifact("security-hardening-plan", "plan");

export default function securityHardeningLoop() {
	return loop(
		{
			objective: "Plan a security hardening pass with explicit review gates",
			agents: [
				agent("security reviewer", {
					harness: "copilot",
					instructions: "Flag uncertainty and avoid exposing secrets in output.",
				}),
				agent("maintainer", { harness: "copilot" }),
			],
		},
		policy(
			{
				name: "security review boundaries",
				constraints: [
					"Do not print secret values.",
					"Do not change authentication or authorization behavior without a plan.",
				],
				protectedFiles: [".env", ".env.local", "secrets.json"],
			},
			parallel(
				step({
					role: "security reviewer",
					goal: "Create a lightweight threat model for the changed surface area.",
					produces: threatModel,
				}),
				step({
					role: "security reviewer",
					goal: "Review dependency and configuration risks relevant to the change.",
					produces: dependencyReview,
				}),
			),
			step({
				role: "maintainer",
				goal: "Draft a prioritized hardening plan with validation steps.",
				context: [threatModel, dependencyReview],
				produces: hardeningPlan,
			}),
			gate({
				name: "security owner approval",
				message: "Security owner reviews the hardening plan before implementation.",
			}),
		),
	);
}
