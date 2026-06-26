import { agent, artifact, evaluate, loop, parallel, step } from "@beyland/piper";

const docsInventory = artifact("docs-inventory", "documentation-audit");
const examplesInventory = artifact("examples-inventory", "documentation-audit");
const docsPlan = artifact("documentation-refresh-plan", "plan");

export default function documentationRefreshLoop() {
	return loop(
		{
			objective: "Refresh documentation after a product or SDK change",
			agents: [
				agent("docs auditor", {
					harness: "copilot",
					instructions: "Look for stale claims, missing migration notes, and absent examples.",
				}),
				agent("docs writer", { harness: "copilot" }),
			],
		},
		parallel(
			step({
				role: "docs auditor",
				goal: "Review README and guide content for stale or missing documentation.",
				produces: docsInventory,
			}),
			step({
				role: "docs auditor",
				goal: "Review examples for missing workflows that should accompany the change.",
				produces: examplesInventory,
			}),
		),
		step({
			role: "docs writer",
			goal: "Create a concise documentation refresh plan with concrete pages and examples to update.",
			context: [docsInventory, examplesInventory],
			produces: docsPlan,
		}),
		evaluate({
			name: "documentation plan references examples",
			using: async ({ readArtifact }) =>
				(await readArtifact("documentation-refresh-plan")).toLowerCase().includes("example"),
		}),
	);
}
