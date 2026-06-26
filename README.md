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

- `loop` — declares one inspectable agent feedback system: its objective, agents,
  state, policies, stop conditions, and nested work
- `agent` — named role with harness/model preferences, capabilities, instructions, and constraints
- `harness` — adapter metadata for real coding-agent execution environments
- `artifact` — typed durable output passed between steps
- `step` — one role-bound agent action with context, expected output, and validations
- `evaluate` — command, predicate, LLM/human-compatible quality gate
- `feedback` — structured critique that flows into later iterations
- `repeat` / `until` — explicit iteration until checks pass or attempts are exhausted
- `parallel` — concurrent investigation or decomposition branches
- `compare` — run branches and produce a decision artifact
- `gate` — approval checkpoint
- `policy` — guardrails for constraints and protected files
- `state` / `runtimeValue` — structured runtime data

`loop` is the name for the whole feedback system, not just a root-level marker.
`repeat` is the primitive for "try this again until it passes." Compatibility
aliases (`workflow`, `task`, `protect`, `recover`) remain exported, but new loops
should prefer the loop-oriented names.

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

## Composition and proposed blocks

Piper should support three levels of composition:

1. **Core primitives** such as `step`, `parallel`, `repeat`, `policy`, and `evaluate`
2. **Blocks** that package reusable orchestration patterns without hiding control flow
3. **Recipes** that assemble full end-to-end loops for common workflows

Today, teams can define blocks as normal TypeScript functions. See
`examples/composition-blocks.piper.ts` for that pattern. A future blocks API could
make those patterns first-class:

```ts
import { artifact, block, evaluate, loop, parallel, repeat, step } from "@beyland/piper";

const plan = artifact("plan", "plan");
const apiChange = artifact("api-change", "implementation");
const uiChange = artifact("ui-change", "implementation");

const sharedPlan = block("sharedPlan", ({ goal, output }) =>
	step({
		role: "planner",
		goal,
		produces: output,
	}),
);

const testRepair = block("testRepair", ({ command, children }) =>
	repeat(
		{ maxAttempts: 3, until: [command] },
		children,
		evaluate({
			name: "tests pass",
			using: command,
			feedback: "Revise only the changes from this loop.",
		}),
	),
);

export default loop(
	{ objective: "Improve checkout reliability" },
	sharedPlan({
		goal: "Plan API and UI slices",
		output: plan,
	}),
	testRepair({
		command: "pnpm test -- checkout",
		children: parallel(
			step({
				role: "implementer",
				goal: "Implement the API slice",
				context: [plan],
				produces: apiChange,
			}),
			step({
				role: "implementer",
				goal: "Implement the UI slice",
				context: [plan],
				produces: uiChange,
			}),
		),
	}),
);
```

Possible first-party block surfaces:

- `block(name, builder)` — names a reusable subgraph for previewing, tracing, docs, and reuse
- `sequence(...children)` — groups ordered work without creating a full recipe
- `fanOut({ from, into, using })` — maps one artifact into parallel downstream
  slices, like "turn this plan into API, UI, test, and docs work at the same time"
- `repairUntil({ command | check, attempts }, child)` — wraps implementation plus evaluator feedback
- `reviewBoundary({ protectedFiles, reviewers }, child)` — adds policy and review gates around risky work
- `handoff({ from, to, artifact, instructions })` — makes agent-to-agent transfer explicit
- `bundle({ artifacts, summary })` — packages multiple outputs into a named reviewable artifact

Blocks should remain transparent: they compile to the same loop tree as core
primitives, preserve artifacts and policies, and can be previewed or inlined by
the CLI.

### Why blocks instead of only scopes?

A scope-like primitive is useful when you want to say "these constraints apply to
this region of work." Piper already has that shape through `policy(...)`: a team
can wrap a migration step and say the agent must not touch production Terraform,
rotate secrets, or broaden the requested dependency upgrade.

That still does not describe the user's whole job. Imagine a staff engineer is
rolling out a checkout reliability project. They first need one planner to read
incident notes and produce a shared plan. Then they need the API work, UI work,
test work, and documentation work to happen in parallel from that same plan.
Each branch should produce a named artifact so reviewers can inspect it later.
If tests fail, only the implementation branches should re-run with the failure
feedback; the original plan should stay stable. Before merge, the work needs a
review boundary around risky files and a final bundle that summarizes what
changed.

A scope can guard part of that story, but it cannot name reusable orchestration
pieces, fan one artifact into several downstream branches, preserve the branch
outputs as first-class artifacts, or show the whole shape in a preview. Blocks
are meant to package those repeated orchestration shapes while still compiling
down to the same transparent primitives.

## Run with the CLI

```bash
piper examples/simple-task.piper.ts --workspace .
piper examples/simple-task.piper.ts --dry-run
piper examples/simple-task.piper.ts --print-compiled
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
COPILOT_COMMAND_TEMPLATE='copilot -p {prompt}' pnpm exec piper examples/simple-task.piper.ts --workspace .
```

The `copilot` harness can also use VS Code Agent Host Protocol:

```bash
PIPER_COPILOT_HARNESS=ahp pnpm exec piper examples/simple-task.piper.ts --workspace .
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
