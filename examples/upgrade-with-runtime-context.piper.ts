import { agent, artifact, loop, runtimeValue, step } from "@beyland/piper";

const inventory = artifact("upgrade-inventory", "migration-map");
const plan = artifact("runtime-aware-upgrade-plan", "plan");

export default function upgradeWithRuntimeContextLoop() {
	return loop(
		{
			objective: "Plan an upgrade using runtime artifact and task metadata",
			agents: [
				agent("upgrade planner", {
					harness: "copilot",
					instructions: "Use runtime context to avoid duplicating stale assumptions.",
				}),
			],
		},
		step({
			role: "upgrade planner",
			goal: "Inventory files, tests, and documentation affected by the upgrade.",
			produces: inventory,
		}),
		step({
			role: "upgrade planner",
			goal: "Create an upgrade plan that reflects the inventory and modified-file metadata.",
			context: [
				inventory.value(),
				runtimeValue(async ({ readTaskResult }) => {
					const result = await readTaskResult("upgrade-inventory");
					return `Inventory step modified ${result.modifiedFiles.length} files: ${
						result.modifiedFiles.join(", ") || "none"
					}`;
				}, "upgrade inventory modified files"),
			],
			produces: plan,
		}),
	);
}
