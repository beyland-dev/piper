import { runtimeValue, artifact, parallel, workflow, task } from "@beyland/piper";

const mockPostHogApi = {
	async getAllFlags(_distinctId: string, { flagKeys }: { flagKeys: string[] }) {
		const flagState: Record<string, boolean | string> = {
			"checkout-redesign": true,
			"billing-v2": "internal-beta",
		};

		return Object.fromEntries(flagKeys.map((flagKey) => [flagKey, flagState[flagKey] ?? false]));
	},
	async getFeatureFlagPayload(flagKey: string, _distinctId: string, flagValue: boolean | string) {
		const payloads: Record<string, unknown> = {
			"checkout-redesign": {
				cohort: "enterprise",
				rollout: "35%",
				riskSignal: "elevated payment retries",
			},
			"billing-v2": {
				cohort: "internal",
				rollout: "10%",
				riskSignal: "invoice preview latency",
			},
		};

		return payloads[flagKey] ?? { rollout: "0%", flagValue };
	},
	async flush() {},
};

async function loadPostHogContext() {
	const distinctId = process.env.POSTHOG_CONTEXT_DISTINCT_ID ?? "production-agent-context";
	const host = "mock://posthog.local";
	const flagKeys = (process.env.POSTHOG_CONTEXT_FLAGS ?? "checkout-redesign,billing-v2")
		.split(",")
		.map((flag) => flag.trim())
		.filter(Boolean);

	const posthog = mockPostHogApi;

	try {
		const flags = await posthog.getAllFlags(distinctId, { flagKeys });
		const payloads = await Promise.all(
			flagKeys.map(
				async (flagKey) =>
					[
						flagKey,
						await posthog.getFeatureFlagPayload(flagKey, distinctId, flags[flagKey]),
					] as const,
			),
		);

		return [
			`PostHog host: ${host}`,
			`Distinct ID used for production context: ${distinctId}`,
			`Feature flags: ${JSON.stringify(flags, null, 2)}`,
			`Flag payloads: ${JSON.stringify(Object.fromEntries(payloads), null, 2)}`,
		].join("\n");
	} finally {
		await posthog.flush();
	}
}

export default function postHogTelemetryResponseWorkflow() {
	return workflow(
		task({
			goal: "Summarize production behavior from PostHog feature flag and payload context",
			harness: "pi",
			context: [
				runtimeValue(loadPostHogContext, "PostHog production context"),
				"Identify rollout state, suspicious flag combinations, and user cohorts that need extra care.",
			],
			artifact: "posthog-telemetry-brief",
		}),
		parallel(
			{ status: "Preparing remediation and stakeholder guidance from PostHog context..." },
			task({
				goal: "Implement the smallest safe change suggested by the PostHog telemetry brief",
				harness: "pi",
				context: [
					artifact("posthog-telemetry-brief").value(),
					"Prefer changes gated by existing feature flags and preserve rollback behavior.",
				],
				artifact: "telemetry-fix",
			}),
			task({
				goal: "Draft an operator update that explains the observed production flag state",
				harness: "pi",
				context: [
					artifact("posthog-telemetry-brief").value(),
					"Call out whether rollout should continue, pause, or roll back.",
				],
				artifact: "operator-update",
			}),
		),
		task({
			goal: "Verify the telemetry-driven change and capture follow-up instrumentation gaps",
			harness: "pi",
			context: [
				artifact("telemetry-fix").value(),
				artifact("operator-update").value(),
				"Make sure the validation explains which PostHog signals should be watched after deploy.",
			],
			validate: [
				runtimeValue(
					async ({ readArtifact }) =>
						(await readArtifact("operator-update")).toLowerCase().includes("rollout"),
					"operator update mentions rollout",
				),
			],
		}),
	);
}
