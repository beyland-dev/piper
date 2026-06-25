import { runtimeValue, artifact, workflow, task } from "@beyland/piper";

async function fetchPackageContext(packageName: string) {
	const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);

	if (!response.ok) {
		return `Unable to fetch npm registry metadata for ${packageName}: ${response.status} ${response.statusText}`;
	}

	const metadata = (await response.json()) as {
		"dist-tags"?: Record<string, string>;
		time?: Record<string, string>;
		description?: string;
	};
	const latestVersion = metadata["dist-tags"]?.latest;

	return [
		`Package: ${packageName}`,
		`Description: ${metadata.description ?? "unknown"}`,
		`Latest version: ${latestVersion ?? "unknown"}`,
		`Latest publish time: ${(latestVersion && metadata.time?.[latestVersion]) || "unknown"}`,
	].join("\n");
}

export default function dependencyIntelligenceWorkflow() {
	return workflow(
		task({
			goal: "Prepare dependency upgrade context from external registry data",
			harness: "pi",
			context: [
				runtimeValue(() => fetchPackageContext("typescript"), "TypeScript npm registry context"),
				runtimeValue(() => fetchPackageContext("vitest"), "Vitest npm registry context"),
				"Compare registry data against the current repository constraints before recommending changes.",
			],
			artifact: "dependency-intelligence",
		}),
		task({
			goal: "Plan a safe dependency update using the fetched package intelligence",
			harness: "pi",
			context: [
				artifact("dependency-intelligence").value(),
				"Call out compatibility risks, validation commands, and whether the update should be deferred.",
			],
			artifact: "dependency-update-plan",
		}),
		task({
			goal: "Run the dependency update plan through a final risk review",
			harness: "pi",
			context: [
				artifact("dependency-update-plan").value(),
				"Do not update dependencies automatically unless the plan says the risk is low and validation is clear.",
			],
			validate: [
				runtimeValue(
					async ({ readArtifact }) =>
						(await readArtifact("dependency-update-plan")).toLowerCase().includes("validation"),
					"plan includes validation guidance",
				),
			],
		}),
	);
}
