# Piper

Piper is a meta-harness for designing loops that prompt coding agents.

It does not replace Copilot, Claude, Codex, Pi, Cursor, or other agents. It coordinates them through explicit roles, prompts, artifacts, feedback, evaluators, policies, retries, gates, and stopping conditions.

> Design loops, not prompts.

Piper aims to give coding-agent work the structure that meta-frameworks give web
applications. React provides component primitives; Next.js and Remix add the
application harness around those primitives: routing, data loading, mutation
flows, deployment assumptions, and conventions for how work moves through the
system. Piper plays a similar role for agents by providing orchestration, state,
artifacts, quality gates, retries, and handoffs.

## Install

```bash
pnpm add -D @beyland/piper
npm install --save-dev @beyland/piper
```

The package provides:

1. A TypeScript SDK for defining reusable agent loops
2. A `piper` CLI for running, previewing, generating, and inspecting loop files

## At a glance

```ts
import { agent, artifact, evaluate, loop, repeat, step } from "@beyland/piper";

const plan = artifact("plan", "plan");

export default loop(
	{
		objective: "Implement OAuth login safely",
		agents: [
			agent("planner", { harness: "copilot" }),
			agent("implementer", { harness: "copilot" }),
		],
	},
	step({
		role: "planner",
		goal: "Create an OAuth implementation plan",
		produces: plan,
	}),
	repeat(
		{ maxAttempts: 3, until: ["pnpm test"] },
		step({
			role: "implementer",
			goal: "Implement or revise the OAuth change",
			context: [plan],
		}),
		evaluate({
			name: "tests pass",
			using: "pnpm test",
			feedback: "Tests failed; revise the implementation using the failure output.",
		}),
	),
);
```

Artifacts persist by default to `~/.piper/runs/<run-id>/artifacts.json`. Each run records artifacts, feedback, events, and a summary.

## Core primitives

- `loop` — top-level objective, agents, state, policies, and stop conditions
- `agent` — named role with harness/model preferences, capabilities, instructions, and constraints
- `harness` — adapter metadata for real coding-agent execution environments
- `artifact` — typed durable output passed between steps
- `step` — one role-bound agent action with context, expected output, and validations
- `evaluate` — command, predicate, LLM/human-compatible quality gate
- `feedback` — structured critique that flows into later iterations
- `repeat` / `until` — explicit iteration until checks pass or attempts are exhausted
- `parallel` — concurrent investigation or decomposition branches
- `fanOut` — maps one artifact into parallel downstream slice steps
- `compare` — run branches and produce a decision artifact
- `gate` — approval checkpoint
- `policy` — guardrails for constraints and protected files
- `state` / `runtimeValue` / `input` — structured runtime and external data

## Recipe API

Piper ships high-level recipes for common agent systems:

- `planThenImplement`
- `implementUntilTestsPass`
- `researchThenSynthesize`
- `criticLoop`
- `parallelInvestigateThenDecide`
- `safeRefactor`
- `migrationPlaybook`
- `releaseTrain`

Recipes are plain loop builders, so they can be composed with lower-level primitives.

## Composition with TypeScript functions

Piper supports three levels of composition:

1. **Core primitives** such as `step`, `parallel`, `repeat`, `policy`, and `evaluate`
2. **Functions** that package reusable orchestration patterns without hiding control flow
3. **Recipes** that assemble full end-to-end loops for common workflows

Teams define reusable loop pieces as normal TypeScript functions. See
`examples/composition-functions.piper.ts` for a larger example.

```ts
import { artifact, evaluate, loop, repeat, step, type LoopTree } from "@beyland/piper";

const plan = artifact("plan", "plan");

function sharedPlan({ goal, children }: { goal: string; children: LoopTree }) {
	return loop(
		step({
			role: "planner",
			goal,
			produces: plan,
		}),
		children,
	);
}

function repairUntilTestsPass({ command, children }: { command: string; children: LoopTree }) {
	return repeat(
		{ maxAttempts: 3, until: [command] },
		children,
		evaluate({
			name: "tests pass",
			using: command,
			feedback: "Revise only the changes from this loop.",
		}),
	);
}

export default sharedPlan({
	goal: "Plan the checkout reliability change",
	children: repairUntilTestsPass({
		command: "pnpm test -- checkout",
		children: step({
			role: "implementer",
			goal: "Implement the planned checkout change",
			context: [plan],
		}),
	}),
});
```

Composition functions remain transparent: they return the same loop tree as
core primitives, preserve artifacts and policies, and can be previewed by the CLI.

## External data and runtime context

Piper loops are TypeScript programs, so they can fetch, build, or derive data with
ordinary JavaScript before handing work to an agent. This makes external data a
first-class loop input instead of a hidden prompt detail: load the data, format it
as focused context, then let Piper coordinate agents, artifacts, feedback, and
evaluators around it.

Use the smallest data boundary that matches the lifecycle:

1. **Build-time data** — fetch or compute values before constructing the loop when
   the data is static for the run.
2. **Runtime data** — use `input(...)` or `runtimeValue(...)` when data should be
   loaded as execution reaches a step or evaluator.
3. **Durable data** — use `artifact(...).value()` or `.result()` when an agent
   output must be reused or persisted for later steps.
4. **Run state** — use `loop({ state })` or `state(...)` for explicit run-scoped
   values that evaluators or runtime values need to read.

`input` is a named wrapper around `runtimeValue` for external or derived data.
It keeps integrations as normal JavaScript while making the data source visible
in the loop definition.

```ts
import { agent, artifact, input, loop, step } from "@beyland/piper";

const customerContext = input(
	"customer-escalation",
	async () => {
		const ticket = await loadTicketFromSupportSdk("ESC-123");
		return [
			"Source: support ticket ESC-123",
			`Customer: ${ticket.accountName}`,
			`Severity: ${ticket.severity}`,
			`Summary: ${ticket.summary}`,
		].join("\n");
	},
	{ description: "support ticket ESC-123" },
);

const plan = artifact("escalation-plan", "plan");

export default loop(
	{
		objective: "Plan the customer escalation response",
		agents: [agent("planner", { harness: "copilot" })],
	},
	step({
		role: "planner",
		goal: "Create a response plan grounded in the customer escalation data",
		context: [customerContext],
		produces: plan,
	}),
);
```

Prefer formatting helpers that summarize large payloads, include provenance such
as source and fetch time, redact secrets, and avoid dumping raw SDK objects into
agent context. Use evaluator functions when external data should decide whether
a loop passes, stops, or needs another iteration.

See `examples/external-data-context.piper.ts`,
`examples/sdk-backed-loop.piper.ts`, and `examples/data-driven-fanout.piper.ts`
for composable patterns.

## Run with the CLI

```bash
piper examples/simple-loop.piper.ts --workspace .
piper examples/simple-loop.piper.ts --dry-run
piper examples/simple-loop.piper.ts --print-compiled
```

Generate an inspectable loop file from a prompt:

```bash
piper "Plan and implement a small bug fix" --workspace . --output generated.piper.ts
piper "Draft a release train loop" --save-only
piper "Fix failing tests" --dry-run-generated
piper "Fix failing tests" --execute
```

Use `--harness <name>` to choose the authoring harness. It defaults to `copilot`.

## Built-in harnesses

1. `mock`: deterministic test harness
2. `pi`: launches `PI_COMMAND` or `pi`
3. `copilot`: launches `COPILOT_COMMAND` or `copilot` with `-p` by default

Command templates can use `{goal}`, `{model}`, `{context}`, `{workspacePath}`, `{prompt}`, `{retryReason}`, `{attempt}`, `{constraints}`, and `{protectedFiles}`.

```bash
COPILOT_COMMAND_TEMPLATE='copilot -p {prompt}' pnpm exec piper examples/simple-loop.piper.ts --workspace .
```

The `copilot` harness can also use VS Code Agent Host Protocol:

```bash
PIPER_COPILOT_HARNESS=ahp pnpm exec piper examples/simple-loop.piper.ts --workspace .
```

## SDK usage

```ts
import { MockHarness, PiperOrchestrator, loop, step } from "@beyland/piper";

const orchestrator = new PiperOrchestrator({
	workspacePath: process.cwd(),
	harnesses: [new MockHarness()],
});

const summary = await orchestrator.execute(
	loop(
		{ objective: "Smoke test a local loop" },
		step({ goal: "Produce a result", harness: "mock", produces: "result" }),
	),
);

console.log(summary.artifacts.result);
```

SDK hooks expose run events, step progress, retries, feedback, and summaries so Piper can integrate into local tooling, CI, or product surfaces.

## Guardrails

Policies pass constraints and protected files to harnesses and enforce protected-file checks after step attempts.

```ts
policy(
	{
		name: "safe migration boundary",
		protectedFiles: ["infra/production.tf"],
		constraints: ["do not deploy or rotate secrets"],
	},
	step({ goal: "Prepare migration plan", harness: "copilot" }),
);
```

For architecture details, read [ARCHITECTURE.md](ARCHITECTURE.md).
