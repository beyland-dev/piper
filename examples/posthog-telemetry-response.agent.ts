import { PostHog } from "posthog-node";

import { derive, output, parallel, sequence, task } from "agent-runtime";

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
  return sequence(
    task({
      goal: "Summarize production behavior from PostHog feature flag and payload context",
      agent: "pi",
      context: [
        derive(loadPostHogContext, "PostHog production context"),
        "Identify rollout state, suspicious flag combinations, and user cohorts that need extra care."
      ],
      output: "posthog-telemetry-brief"
    }),
    parallel(
      { fallback: "Preparing remediation and stakeholder guidance from PostHog context..." },
      task({
        goal: "Implement the smallest safe change suggested by the PostHog telemetry brief",
        agent: "pi",
        context: [
          output("posthog-telemetry-brief"),
          "Prefer changes gated by existing feature flags and preserve rollback behavior."
        ],
        output: "telemetry-fix"
      }),
      task({
        goal: "Draft an operator update that explains the observed production flag state",
        agent: "pi",
        context: [
          output("posthog-telemetry-brief"),
          "Call out whether rollout should continue, pause, or roll back."
        ],
        output: "operator-update"
      })
    ),
    task({
      goal: "Verify the telemetry-driven change and capture follow-up instrumentation gaps",
      agent: "pi",
      context: [
        output("telemetry-fix"),
        output("operator-update"),
        "Make sure the validation explains which PostHog signals should be watched after deploy."
      ],
      validate: [
        derive(async ({ readOutput }) => (await readOutput("operator-update")).toLowerCase().includes("rollout"), "operator update mentions rollout")
      ]
    })
  );
}
