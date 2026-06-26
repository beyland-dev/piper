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
- `state` / `runtimeValue` — structured runtime data

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

Piper should support three levels of composition:

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

Composition functions should remain transparent: they return the same loop tree as
core primitives, preserve artifacts and policies, and can be previewed by the CLI.

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
