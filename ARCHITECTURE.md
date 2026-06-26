# Architecture In Plain English

## The short version

Piper is a meta-framework for declaratively orchestrating coding agents.

Piper is almost a meta-harness: it does not replace Pi, Copilot, Claude, or Codex; it gives you a declarative way to orchestrate them.

You describe a workflow with TypeScript builder functions. The CLI compiles that TypeScript file. The compiled code returns a plain object tree. The orchestrator walks that tree. When it reaches a task, it calls a harness. The harness starts one of your configured coding agent commands, such as `pi` or Copilot CLI.

That is the whole shape of the system.

There is no secret boss agent in this repo. There is no LLM inside this framework deciding what to do next. Piper provides the orchestrator, and it runs workflows with normal TypeScript and JavaScript control flow. The default prompt-based CLI experience is an authoring helper: it asks a configured harness to write a workflow file before normal orchestration begins.

## Project layout

1. `src/cli`: CLI entry point for compiling and running workflows
2. `src/core`: Task node types and builder primitives like `task`, `parallel`, `protect`, and `recover`
3. `src/runtime`: orchestration engine and runtime checks
4. `src/adapters`: harness bridges to coding agent commands like `pi` and `copilot`
5. `automations`: Piper workflows used to develop this repo
6. `examples`: sample workflows
7. `tests`: Vitest coverage

## What the builder API really is

The builder API is the authoring surface for Piper workflows. It is a typed way to build a task tree.

When you write this:

```ts
task({ goal: "Inspect the repo", harness: "pi" });
```

you are really creating a plain object that says, in effect:

```ts
{ kind: "task", props: { goal: "Inspect the repo", harness: "pi" } }
```

The builders in `src/core/builder.ts` create task nodes. They do not talk to a model. They do not schedule work by themselves.

## The actual execution flow

From the CLI, the flow is:

1. `piper` reads the workflow path.
2. `esbuild` bundles the workflow into one ESM module.
3. The CLI imports that compiled module from a data URL.
4. The workflow's default export returns a task tree.
5. `PiperOrchestrator` walks the tree and runs each node.
6. Task nodes call adapters such as `PiHarness` or `CopilotCliHarness`.
7. The harness launches the configured coding agent command.
8. The orchestrator watches progress, retries failures, runs validations, and records artifacts.

If you want to know where the real work starts, it starts when the harness spawns the configured coding agent command.

## Who is responsible for what

### `src/cli`

This is the entry point.

Its job is to:

1. parse CLI flags
2. compile the workflow file
3. load the compiled workflow
4. create the orchestrator with harnesses
5. run the workflow

It is glue code. In prompt-based authoring mode, it first runs a single authoring task through a configured harness, validates the generated `.piper.ts` file with the same compile/load path, and only executes that generated workflow when explicitly requested.

### `src/core`

This folder defines the language you use to describe workflows.

It contains:

1. node types
2. builder functions like `task`, `workflow`, `parallel`, `protect`, and `recover`
3. runtime value helpers like `artifact` and `runtimeValue`

This layer describes work. It does not perform the work.

### `src/runtime`

This is the orchestration engine.

`PiperOrchestrator` is the center of the repo. It is the code that actually decides how the tree runs.

Its job is to:

1. walk the tree
2. run workflow nodes in order
3. run `parallel` children concurrently
4. handle retries for failed tasks
5. enforce protected file constraints
6. run validations
7. store artifacts so later tasks can read them

This is the part that performs orchestration, but it is just imperative code.

### Harness adapters

Harness adapters are the bridge from Piper workflows to your coding agent commands.

The important point is this: the framework does not contain the agent brain. The harness hands work off to something else.

For `PiHarness` and `CopilotCliHarness`, that means:

1. build a prompt from the task goal, context, and retry feedback
2. spawn the configured CLI command
3. stream stdout and stderr back as progress
4. resolve success or failure
5. report which files changed

If the external CLI itself uses an LLM, tools, or subagents, that behavior lives outside this repo.

### `src/utils`

Small support code.

This is where process spawning, shell escaping, async queues, and deferred promises live.

## What the workflow features actually mean

### `task`

One unit of agent work.

It says:

1. which harness to use
2. what goal to give it
3. what extra context to pass
4. what validations to run after it finishes

### `artifact` and `runtimeValue`

These let later tasks depend on earlier tasks.

`artifact("name")` creates a reusable artifact reference. Use it as a task `artifact` target to publish a result, and use `artifact("name").value()` in `context` to read that result.

`runtimeValue(...)` means "run a little function at runtime to build a context string or validation value."

### `workflow`

Run child nodes in order.

### `parallel`

Run child nodes concurrently. Piper prints a generic status message by default; pass `status` to customize that message for the workflow.

### `recover`

Catch a failure, run `onFailure` logic, and optionally retry.

### `protect`

Run tasks with extra safety rules.

This is where you can say certain files must not be changed, and where extra validations can run after the protected block finishes.

Protected files are enforced in two layers:

1. Piper passes constraints and protected files to harnesses through environment variables so harness-level hooks can block reads/writes before they happen.
2. Piper still checks git status after task attempts and reverts newly modified protected files.

The first layer is proactive when the harness supports hooks. The second layer is reactive and remains useful as defense in depth.

Command harnesses receive:

1. `AGENT_CONSTRAINTS`
2. `AGENT_PROTECTED_FILES`
3. `<HARNESS>_CONSTRAINTS`, for example `PI_CONSTRAINTS`
4. `<HARNESS>_PROTECTED_FILES`, for example `COPILOT_PROTECTED_FILES`

The same values are available in command templates as `{constraints}` and `{protectedFiles}`.

For now, Piper's recommended proactive enforcement is intentionally scoped to structured file tools: read, edit, and write/create. Bash/terminal access remains covered only by Piper's post-run protected-file checks.

A denial message should tell the harness what happened and discourage workarounds:

```txt
This file is restricted by the active Piper workflow. Do not try to access it through another tool or alternate path. Continue the task using the remaining available context.
```

## Workflow generation

The default prompt-based CLI path is a bootstrap path for creating workflow files from a prompt.

The important boundary is that generation happens before workflow execution:

1. the user provides an initial prompt
2. Piper asks a configured harness, such as Copilot or Pi, to write a `.piper.ts` file
3. Piper compiles and loads that file to verify it is a valid workflow
4. Piper leaves the file on disk for review, or runs it only when `--execute` is provided

This keeps the generated workflow explicit and inspectable. The runtime still executes a task tree; it does not dynamically ask a model what node to run next.

## What this framework is not

It is not a hidden autonomous runtime planner. It is not a scheduler backed by an implicit LLM. It is not a multi-agent system by itself. It is a deterministic orchestration framework with a TypeScript builder authoring layer, plus an explicit workflow-generation command for bootstrapping that layer.

## How to read an example workflow

Take `examples/migration-playbook.piper.ts`.

In plain words it says:

1. ask one harness task to inventory the migration
2. run two follow-up planning tasks in parallel
3. combine those results into one playbook
4. validate that the playbook mentions certain things
5. run a protected review step that must respect protected files

That file is not doing the work directly. It is describing the work so the orchestrator can run it.

## The most important mental model

Think of this framework in two layers.

Layer 1 is the workflow description. That is the TypeScript builder tree you write.

Layer 2 is the orchestration engine. That is the orchestrator plus harnesses.

The workflow description says what should happen. The orchestration engine makes it happen.

The actual coding agent, if there is one, starts outside this repo when a harness launches a command like `pi` or Copilot CLI.
