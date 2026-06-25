import { PostHog } from "posthog-node";

import { runtimeValue, artifact, parallel, workflow, task } from "piper";

async function loadPostHogContext() {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY;
  const distinctId = process.env.POSTHOG_CONTEXT_DISTINCT_ID ?? "production-agent-context";
  const host = process.env.POSTHOG_HOST ?? "https://app.posthog.com";
  const flagKeys = (process.env.POSTHOG_CONTEXT_FLAGS ?? "checkout-redesign,billing-v2")
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);

  if (!apiKey) {
    return [
      "PostHog context was not loaded because POSTHOG_PROJECT_API_KEY is unset.",
      "Set POSTHOG_CONTEXT_DISTINCT_ID and POSTHOG_CONTEXT_FLAGS to evaluate the same production flags the agent should reason about."
    ].join("\n");
  }

  const posthog = new PostHog(apiKey, { host, evaluationContexts: ["production"] });

  try {
    const flags = await posthog.getAllFlags(distinctId, { flagKeys });
    const payloads = await Promise.all(
      flagKeys.map(async (flagKey) => [flagKey, await posthog.getFeatureFlagPayload(flagKey, distinctId, flags[flagKey])] as const)
    );

    return [
      `PostHog host: ${host}`,
      `Distinct ID used for production context: ${distinctId}`,
      `Feature flags: ${JSON.stringify(flags, null, 2)}`,
      `Flag payloads: ${JSON.stringify(Object.fromEntries(payloads), null, 2)}`
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
        "Identify rollout state, suspicious flag combinations, and user cohorts that need extra care."
      ],
      artifact: "posthog-telemetry-brief"
    }),
    parallel(
      { status: "Preparing remediation and stakeholder guidance from PostHog context..." },
      task({
        goal: "Implement the smallest safe change suggested by the PostHog telemetry brief",
        harness: "pi",
        context: [
          artifact("posthog-telemetry-brief").value(),
          "Prefer changes gated by existing feature flags and preserve rollback behavior."
        ],
        artifact: "telemetry-fix"
      }),
      task({
        goal: "Draft an operator update that explains the observed production flag state",
        harness: "pi",
        context: [
          artifact("posthog-telemetry-brief").value(),
          "Call out whether rollout should continue, pause, or roll back."
        ],
        artifact: "operator-update"
      })
    ),
    task({
      goal: "Verify the telemetry-driven change and capture follow-up instrumentation gaps",
      harness: "pi",
      context: [
        artifact("telemetry-fix").value(),
        artifact("operator-update").value(),
        "Make sure the validation explains which PostHog signals should be watched after deploy."
      ],
      validate: [
        runtimeValue(async ({ readArtifact }) => (await readArtifact("operator-update")).toLowerCase().includes("rollout"), "operator update mentions rollout")
      ]
    })
  );
}
