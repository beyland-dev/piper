# Architecture In Plain English

## The short version

This repo is a small runtime for agent workflows.

You write a workflow in TSX.
The CLI compiles that TSX file.
The compiled code returns a plain object tree.
The executor walks that tree.
When it hits a task, it calls an adapter.
The adapter starts an external agent command such as `pi`.

That is the whole shape of the system.

There is no secret boss agent in this repo.
There is no LLM inside this framework deciding what to do next.
The framework itself is the orchestrator, and it does that with normal TypeScript and JavaScript control flow.

## What the TSX really is

The TSX is not a UI.
It is not React running in a browser.
It is just a nice way to build a task tree.

When you write this:

```tsx
<Task goal="Inspect the repo" agent="pi" />
```

you are really creating a plain object that says, in effect:

```ts
{ kind: "task", props: { goal: "Inspect the repo", agent: "pi" } }
```

The JSX runtime in `src/jsx-runtime.ts` just turns components and fragments into task nodes.
It does not talk to a model.
It does not schedule work by itself.

## The actual runtime flow

From the CLI, the flow is:

1. `agent-run` reads the workflow path.
2. `esbuild` bundles the workflow into one ESM module.
3. The CLI imports that compiled module from a data URL.
4. The workflow's default export returns a task tree.
5. `WorkflowExecutor` walks the tree and runs each node.
6. Task nodes call adapters such as `PiAdapter`.
7. The adapter launches the external agent command.
8. The executor watches progress, retries failures, runs validations, and records outputs.

If you want to know where the real work starts, it starts when the adapter spawns the external command.

## Who is responsible for what

### `src/cli`

This is the entry point.

Its job is to:

1. parse CLI flags
2. compile the workflow file
3. load the compiled workflow
4. create the executor with adapters
5. run the workflow

It is glue code.

### `src/jsx-runtime.ts`

This is the TSX translator layer.

Its job is to:

1. accept TSX component calls
2. turn fragments into sequences
3. call component functions like `Task`, `Suspense`, `Guarded`, and `ErrorBoundary`

It does not execute tasks.

### `src/core`

This folder defines the language of the workflow.

It contains:

1. node types
2. helper components like `Task`, `Suspense`, `Guarded`, and `ErrorBoundary`
3. signal helpers like `useOutput` and `computed`

This layer describes work.
It does not perform the work.

### `src/runtime`

This is the engine.

`WorkflowExecutor` is the center of the repo.
It is the code that actually decides how the tree runs.

Its job is to:

1. walk the tree
2. run sequence nodes in order
3. run `Suspense` children in parallel
4. handle retries for failed tasks
5. enforce protected file constraints
6. run validations
7. store outputs so later tasks can read them

This is the part that acts like an orchestrator, but it is just imperative code.

### `src/adapters`

Adapters are the bridge to real agents.

The important point is this:
the framework does not contain the agent brain.
The adapter hands work off to something else.

For `PiAdapter`, that means:

1. build a prompt from the task goal, context, and retry feedback
2. spawn the `pi` command
3. stream stdout and stderr back as progress
4. resolve success or failure
5. report which files changed

If `pi` itself uses an LLM, tools, or subagents, that behavior lives outside this repo.

### `src/utils`

Small support code.

This is where process spawning, shell escaping, async queues, and deferred promises live.

## What the workflow features actually mean

### `Task`

One unit of agent work.

It says:

1. which agent to use
2. what goal to give it
3. what extra context to pass
4. what validations to run after it finishes

### `useOutput` and `computed`

These let later tasks depend on earlier tasks.

`useOutput("name")` means "wait for that task's text output and use it here."

`computed(...)` means "run a little function at runtime to build a context string or validation value."

### `Suspense`

In this repo, `Suspense` is not React data fetching.

It means:

1. show a fallback message or fallback node
2. run child tasks in parallel

### `ErrorBoundary`

Catch a failure, run fallback logic, and optionally retry.

### `Guarded`

Run tasks with extra safety rules.

This is where you can say certain files must not be changed, and where extra validations can run after the guarded block finishes.

## What this framework is not

It is not a general autonomous planner.
It is not a scheduler backed by a hidden LLM.
It is not a multi-agent system by itself.
It is not React, except in syntax style.

It is a deterministic workflow runner with a TSX authoring layer.

## How to read an example workflow

Take `examples/migration-playbook.agent.tsx`.

In plain words it says:

1. ask one agent task to inventory the migration
2. run two follow-up planning tasks in parallel
3. combine those results into one playbook
4. validate that the playbook mentions certain things
5. run a guarded review step that must respect protected files

That file is not doing the work directly.
It is describing the work so the executor can do it.

## The most important mental model

Think of this repo in two layers.

Layer 1 is the workflow description.
That is the TSX you write.

Layer 2 is the runtime engine.
That is the executor plus adapters.

The workflow description says what should happen.
The runtime engine makes it happen.

The actual coding agent, if there is one, starts outside this repo when an adapter launches a command like `pi`.
