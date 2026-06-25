# agent-runtime

Small TypeScript runtime for agent workflows.

You write workflows in TSX.
This project compiles them into a task tree and runs that tree with normal JavaScript control flow.
When a task needs real agent work, an adapter launches an external command such as `pi`.

If you want the blunt architecture explanation, read [ARCHITECTURE.md](ARCHITECTURE.md).

## What this project does

This project gives you:

1. a TSX authoring model for workflows
2. a runtime that executes tasks, retries failures, and stores outputs
3. adapters that hand tasks off to external agents
4. validation and guard rails for protected files and post-task checks

This project does not contain the actual coding agent logic.
That lives in the external command invoked by an adapter.

## Project layout

1. `src/cli`: CLI entry point for compiling and running workflows
2. `src/core`: task node types and helper components like `Task` and `Guarded`
3. `src/runtime`: the executor and runtime checks
4. `src/adapters`: bridges to external agents like `pi`
5. `examples`: sample workflows
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
pnpm run agent-run -- examples/simple-task.agent.tsx --workspace . --verbose
```

## Example

Example workflows live in `examples/`.

To run one:

```bash
pnpm run agent-run -- examples/simple-task.agent.tsx --workspace .
```

## Mental model

Think about the system like this:

1. TSX describes the workflow
2. the CLI compiles and loads it
3. the executor runs the workflow tree
4. adapters launch the real agent command

If you need more detail, use [ARCHITECTURE.md](ARCHITECTURE.md).
