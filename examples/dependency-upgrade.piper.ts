import { agent, artifact, evaluate, loop, policy, repeat, step } from "@beyland/piper";

const upgradePlan = artifact("dependency-upgrade-plan", "plan");
const validationReport = artifact("dependency-validation-report", "test-report");

export default function dependencyUpgradeLoop() {
	return loop(
		{
			objective: "Upgrade a dependency with compatibility checks and rollback notes",
			agents: [
				agent("maintainer", {
					harness: "copilot",
					instructions: "Prefer the package manager already used by the workspace.",
				}),
			],
		},
		policy(
			{
				name: "dependency safety",
				constraints: [
					"Do not migrate package managers.",
					"Do not broaden the upgrade scope beyond the requested dependency.",
				],
				protectedFiles: [".npmrc", ".github/workflows/release.yml"],
			},
			step({
				role: "maintainer",
				goal: "Prepare an upgrade plan with release notes, risk areas, and rollback steps.",
				produces: upgradePlan,
			}),
			repeat(
				{ maxAttempts: 3, until: ["pnpm test"] },
				step({
					role: "maintainer",
					goal: "Apply the dependency upgrade and resolve compatibility issues.",
					context: [upgradePlan],
					produces: validationReport,
				}),
				evaluate({
					name: "typecheck after dependency upgrade",
					using: "pnpm typecheck",
					feedback: "Fix type incompatibilities introduced by the dependency upgrade.",
				}),
			),
		),
	);
}
