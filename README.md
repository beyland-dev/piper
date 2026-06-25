# Piper

Small TypeScript runtime for agent workflows.

You write workflows with a TypeScript builder API. The builder creates a task tree and the runtime executes that tree with normal JavaScript control flow. When a task needs real agent work, an adapter launches an external command such as `pi` or `copilot`.

## What this project does

This project gives you:

1. A TypeScript builder authoring model for workflows
2. A runtime that executes tasks, retries failures, and stores outputs
3. Adapters that hand tasks off to external agents
4. Validation and guard rails for protected files and post-task checks

This project does not contain the actual coding agent logic. That lives in the external command (i.e. `pi` or `copilot`) invoked by an adapter.

## Project layout

1. `src/cli`: CLI entry point for compiling and running workflows
2. `src/core`: Task node types and builder primitives like `task`, `parallel`, `protect`, and `recover`
3. `src/runtime`: The executor and runtime checks
4. `src/adapters`: Bridges to external agents like `pi` and `copilot`
5. `examples`: Sample workflows
6. `tests`: Vitest coverage

## Install

```bash
pnpm install
```

## Common commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm run piper -- examples/simple-task.agent.ts --workspace . --verbose
```

## Agent adapters

Tasks choose an adapter with the `agent` property:

```ts
task({ goal: "Implement the feature", agent: "copilot" });
```

Built-in adapters:

1. `mock`: Deterministic test adapter
2. `pi`: Launches `PI_COMMAND` or `pi`
3. `copilot`: Launches `COPILOT_COMMAND` or `copilot`

Both real CLI adapters also support command templates:

```bash
COPILOT_COMMAND_TEMPLATE='copilot {prompt}' pnpm run piper -- examples/simple-task.agent.ts --workspace .
```

Templates can use `{goal}`, `{context}`, `{workspacePath}`, `{prompt}`, `{retryReason}`, and `{attempt}`. Values are shell-escaped before substitution.

Copilot CLI runs receive `COPILOT_GOAL`, `COPILOT_CONTEXT`, `COPILOT_PROMPT`, and `COPILOT_RETRY_REASON`, plus the generic `AGENT_*` variables used by all command adapters.

## Example

Example workflows live in `examples/`.

To run one:

```bash
pnpm run piper -- examples/simple-task.agent.ts --workspace .
```

Output dependencies are explicit:

```ts
import { output, sequence, task } from "piper";

export default sequence(
  task({ goal: "Create plan", agent: "mock", output: "plan" }),
  task({ goal: "Implement feature", agent: "mock", context: [output("plan")] })
);
```

`output="plan"` publishes that task result. `output("plan")` waits for it. If no task declares that output, or the producing task fails before publishing it, execution fails with a clear runtime error.

## Mental model

Think about the system like this:

1. TypeScript builders describe the workflow
2. The CLI compiles and loads it
3. The executor runs the workflow tree
4. Adapters launch the real agent command

Use `sequence(...)` for ordered work, `parallel(...)` for concurrent work, `protect(...)` for protected-file scopes, and `recover(...)` for fallback/retry behavior.

If you want more detail, read [ARCHITECTURE.md](ARCHITECTURE.md).
