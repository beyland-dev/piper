import { agent, evaluate, input, loop, repeat, step } from "@beyland/piper";

type ReleaseSdk = {
	getReleaseHealth(version: string): Promise<{
		version: string;
		failedChecks: string[];
		recentErrors: string[];
	}>;
};

const releaseSdk: ReleaseSdk = {
	async getReleaseHealth(version) {
		return {
			version,
			failedChecks: ["checkout-retry-budget"],
			recentErrors: ["Retry budget exceeded for token refresh flow"],
		};
	},
};

const releaseHealth = input(
	"release-health",
	async () => {
		const health = await releaseSdk.getReleaseHealth("2026.06.26");
		return [
			`Source: release health SDK for ${health.version}`,
			`Failed checks: ${health.failedChecks.join(", ") || "none"}`,
			`Recent errors: ${health.recentErrors.join("; ") || "none"}`,
		].join("\n");
	},
	{ description: "release health from internal SDK" },
);

export default loop(
	{
		objective: "Use SDK-backed release health data to repair checkout reliability",
		agents: [agent("implementer", { harness: "copilot" })],
		state: { release: "2026.06.26" },
	},
	repeat(
		{ maxAttempts: 3, until: ["pnpm test -- checkout"] },
		step({
			role: "implementer",
			goal: "Repair the checkout retry failure using release health context.",
			context: [releaseHealth],
		}),
		evaluate({
			name: "checkout tests pass",
			using: "pnpm test -- checkout",
			feedback: "Use the release health details to revise the checkout retry fix.",
		}),
	),
);
