# Piper

A meta-framework for declaratively orchestrating coding agents.

It does not replace Pi, Copilot, Claude, or Codex; it gives you a declarative way to orchestrate them.

You (or an agent) describe workflows with a TypeScript builder API. The builder creates a task tree, and Piper's orchestrator executes that tree with normal JavaScript control flow. When a task needs agent work, Piper launches one of your configured coding agents.

## Install

```bash
# Install using pnpm
pnpm add -D @beyland/piper

# Install using npm
npm install --save-dev @beyland/piper
```

The package provides:

1. A `piper` CLI for running workflow files
2. A TypeScript SDK exported from `@beyland/piper`

## At a glance

### Define a workflow

```ts
import { artifact, task, workflow } from "@beyland/piper";

const plan = artifact("plan");

export default workflow(
  task({ goal: "Create plan", harness: "copilot", artifact: plan }),
  task({ goal: "Implement feature", harness: "copilot", context: [plan.value()] })
);
```

The `artifact("plan")` function call creates a typed artifact reference. Passing it as `artifact` publishes that task result; passing `plan.value()` in `context` waits for and reads that result.

### Run it with the CLI

```bash
piper workflows/simple-task.piper.ts --workspace .
```

Artifacts persist by default to `~/.piper/runs/<run-id>/artifacts.json`. You can point runs at a different artifact root:

```bash
PIPER_ARTIFACT_ROOT=/tmp/piper-runs piper workflows/simple-task.piper.ts
```

### Choose the agent harness per task

```ts
task({ goal: "Implement the feature", harness: "copilot" });
```

Built-in harnesses:

1. `mock`: deterministic test harness
2. `pi`: launches `PI_COMMAND` or `pi`
3. `copilot`: launches `COPILOT_COMMAND` or `copilot`

Real CLI harnesses also support command templates:

```bash
COPILOT_COMMAND_TEMPLATE='copilot {prompt}' pnpm exec piper workflows/simple-task.piper.ts --workspace .
```

Templates can use `{goal}`, `{model}`, `{context}`, `{workspacePath}`, `{prompt}`, `{retryReason}`, `{attempt}`, `{constraints}`, and `{protectedFiles}`. Values are shell-escaped before substitution.

### Compose agent workflows

Piper gives you workflow primitives for:

1. ordered work with `workflow(...)`
2. concurrent work with `parallel(...)`
3. task outputs with `artifact(...)` and `runtimeValue(...)`
4. retries and recovery with `recover(...)`
5. protected scopes and post-task checks with `protect(...)`

Piper does not contain the actual coding agent logic. That lives in the configured command invoked by a harness.

### Use the SDK directly

```ts
import { MockHarness, PiperOrchestrator, artifact, task, workflow } from "@beyland/piper";

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

SDK hooks let you observe execution, customize reporting, and integrate Piper into a larger toolchain.

### Add guardrails

Piper keeps post-run protected-file checks, and it also passes constraints to command harnesses so Pi/Copilot hooks can proactively block restricted tool calls before they happen.

For architecture details, project layout, and harness enforcement notes, read [ARCHITECTURE.md](ARCHITECTURE.md).
