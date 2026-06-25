# Piper

A framework for declaratively orchestrating your agents.

You describe workflows with a TypeScript builder API. The builder creates a task tree, and Piper's orchestrator executes that tree with normal JavaScript control flow. When a task needs agent work, a harness launches one of your configured agent commands, such as `pi` or `copilot`.

## What this project does

This project gives you:

1. A TypeScript builder API for creating composable and reusable agent workflows
2. An orchestrator that executes tasks, retries failures, and stores artifacts
3. Harnesses that hand tasks off to your agent commands
4. Validation and guard rails for protected files and post-task checks

Piper does not contain the actual coding agent logic. That lives in the external command, such as `pi` or `copilot`, invoked by a harness.

## Project layout

1. `src/cli`: CLI entry point for compiling and running workflows
2. `src/core`: Task node types and builder primitives like `task`, `parallel`, `protect`, and `recover`
3. `src/runtime`: Orchestration engine and runtime checks
4. `src/adapters`: Harness bridges to agent commands like `pi` and `copilot`
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
pnpm run piper -- examples/simple-task.piper.ts --workspace .
```

## Harnesses

Tasks choose a harness with the `harness` property:

```ts
task({ goal: "Implement the feature", harness: "copilot" });
```

Built-in harnesses:

1. `mock`: Deterministic test harness
2. `pi`: Launches `PI_COMMAND` or `pi`
3. `copilot`: Launches `COPILOT_COMMAND` or `copilot`

Both real CLI harnesses also support command templates:

```bash
COPILOT_COMMAND_TEMPLATE='copilot {prompt}' pnpm run piper -- examples/simple-task.piper.ts --workspace .
```

Templates can use `{goal}`, `{model}`, `{context}`, `{workspacePath}`, `{prompt}`, `{retryReason}`, and `{attempt}`. Values are shell-escaped before substitution.

Copilot CLI runs receive `COPILOT_GOAL`, `COPILOT_MODEL`, `COPILOT_CONTEXT`, `COPILOT_PROMPT`, and `COPILOT_RETRY_REASON`, plus the generic `AGENT_*` variables used by all command harnesses.

## Example

Example workflows live in `examples/`.

To run one:

```bash
pnpm run piper -- examples/simple-task.piper.ts --workspace .
```

Artifact dependencies are explicit:

```ts
import { artifact, workflow, task } from "piper";

const plan = artifact("plan");

export default workflow(
  task({ goal: "Create plan", harness: "mock", artifact: plan }),
  task({ goal: "Implement feature", harness: "mock", context: [plan.value()] })
);
```

`artifact("plan")` creates a typed artifact reference. Passing it as `artifact` publishes that task result; passing `plan.value()` in `context` waits for and reads that result. Piper validates missing and duplicate artifacts before a run starts.

`artifact` currently returns a small reference object:

```ts
const plan = artifact("plan");

plan.name;     // "plan"
plan.value();  // runtime value for the text output
plan.result(); // runtime value for the full TaskResult
```

Use `plan.value()` when a downstream task needs the artifact text. Use `plan.result()` when a `runtimeValue` needs the full `TaskResult`, including modified files and metadata.

## Piper SDK

You can run workflows without the CLI by using the SDK surface directly:

```ts
import { MockHarness, PiperOrchestrator, artifact, task, workflow } from "piper";

const plan = artifact("plan");

const orchestrator = new PiperOrchestrator({
  workspacePath: process.cwd(),
  harnesses: [new MockHarness()]
});

const summary = await orchestrator.execute(
  workflow(
    task({ goal: "Create plan", harness: "mock", artifact: plan }),
    task({ goal: "Implement plan", harness: "mock", context: [plan.value()] })
  )
);

console.log(summary.artifactPath);
```

SDK hooks let you observe execution:

```ts
const orchestrator = new PiperOrchestrator({
  workspacePath: process.cwd(),
  harnesses: [new MockHarness()],
  hooks: {
    info: console.log,
    taskStarted: (info) => console.log("started", info.goal),
    taskProgress: (_info, update) => console.log(update.message),
    taskRetry: (_info, failures) => console.log("retry", failures),
    taskCompleted: (_info, result) => console.log(result.output),
    taskFailed: (_info, error) => console.error(error.message),
    summary: (summary) => console.log(summary)
  }
});
```

Artifacts persist by default to `~/.piper/runs/<run-id>/artifacts.json`. To customize or disable:

```ts
new PiperOrchestrator({
  workspacePath: process.cwd(),
  harnesses: [new MockHarness()],
  artifactStorage: { rootDir: "/tmp/piper-runs", runId: "local-dev" }
});

new PiperOrchestrator({
  workspacePath: process.cwd(),
  harnesses: [new MockHarness()],
  artifactStorage: false
});
```

You can also point CLI runs at a different artifact root:

```bash
PIPER_ARTIFACT_ROOT=/tmp/piper-runs piper examples/simple-task.piper.ts
```

## Constraints and harness enforcement

Piper always keeps its post-run protected-file checks, but it also passes constraints to command harnesses so Pi/Copilot hooks can enforce them before tool calls run.

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

Pi can enforce this with a `tool_call` extension:

```ts
export default function (pi) {
  const protectedFiles = new Set(
    (process.env.AGENT_PROTECTED_FILES ?? "").split("\n").filter(Boolean)
  );

  pi.on("tool_call", async (event) => {
    if (!["read", "edit", "write"].includes(event.toolName)) return undefined;

    const path = event.input.path;
    if (typeof path === "string" && protectedFiles.has(path)) {
      return {
        block: true,
        reason:
          "This file is restricted by the active Piper workflow. Do not try to access it through another tool or alternate path. Continue the task using the remaining available context."
      };
    }

    return undefined;
  });
}
```

Copilot CLI can enforce the same policy with a `preToolUse` hook:

```js
const input = JSON.parse(await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (chunk) => (data += chunk));
  process.stdin.on("end", () => resolve(data));
}));

const protectedFiles = new Set((process.env.AGENT_PROTECTED_FILES ?? "").split("\n").filter(Boolean));
const path = input.toolArgs?.path ?? input.toolArgs?.filePath ?? input.toolArgs?.file_path;

if (["view", "edit", "create", "write"].includes(input.toolName) && protectedFiles.has(path)) {
  console.log(JSON.stringify({
    permissionDecision: "deny",
    permissionDecisionReason:
      "This file is restricted by the active Piper workflow. Do not try to access it through another tool or alternate path. Continue the task using the remaining available context."
  }));
} else {
  console.log(JSON.stringify({ permissionDecision: "allow" }));
}
```

## Mental model

Think about the system like this:

1. TypeScript builders describe the workflow
2. The CLI compiles and loads it
3. The orchestrator runs the workflow tree
4. Harnesses launch your agent commands

Use `workflow(...)` for ordered work, `parallel(...)` for concurrent work, `protect(...)` for protected-file scopes, and `recover(...)` for `onFailure` retry behavior. `parallel(...)` prints a generic status by default; pass `{ status: "..." }` to customize it.

If you want more detail, read [ARCHITECTURE.md](ARCHITECTURE.md).
