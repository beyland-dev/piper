# Piper

A meta-framework for declaratively orchestrating coding agents.

It does not replace coding agents like Pi, Copilot, Claude, or Codex. It gives you a declarative way to orchestrate them.

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
	task({ goal: "Implement feature", harness: "copilot", context: [plan.value()] }),
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

### Generate a workflow from a prompt

Piper can also ask one of its configured harnesses to author an inspectable workflow file:

```bash
piper "Plan and implement a small bug fix" --workspace . --output workflows/generated.piper.ts
```

Generation is an authoring step. Piper asks the selected harness to write a `.piper.ts` file, validates that the file can be loaded as a workflow, and leaves the generated file on disk for review. Use `--save-only` to leave the file on disk without loading, validating, or executing it. Piper does not execute the generated workflow unless you opt in:

```bash
piper "Draft a release workflow" --save-only
piper "Plan a migration" --dry-run-generated
piper "Fix the failing tests" --execute
```

Use `--harness <name>` to choose the authoring harness. It defaults to `copilot`.

### Choose the agent harness per task

```ts
task({ goal: "Implement the feature", harness: "copilot" });
```

Built-in harnesses:

1. `mock`: deterministic test harness
2. `pi`: launches `PI_COMMAND` or `pi`
3. `copilot`: launches `COPILOT_COMMAND` or `copilot` with `-p` by default

Real CLI harnesses also support command templates:

```bash
COPILOT_COMMAND_TEMPLATE='copilot -p {prompt}' pnpm exec piper workflows/simple-task.piper.ts --workspace .
```

Templates can use `{goal}`, `{model}`, `{context}`, `{workspacePath}`, `{prompt}`, `{retryReason}`, `{attempt}`, `{constraints}`, and `{protectedFiles}`. Values are shell-escaped before substitution.

### Reflect Copilot sessions in VS Code with Agent Host

The `copilot` harness can also run through VS Code's Agent Host Protocol (AHP) instead of spawning `copilot -p`. This creates an underlying `copilotcli` Agent Host session for each Piper task so VS Code can see the same Copilot sessions.

```bash
PIPER_COPILOT_HARNESS=ahp pnpm exec piper workflows/simple-task.piper.ts --workspace .
```

By default Piper discovers the host by running `code agent host`. You can customize discovery with:

- `COPILOT_AHP_CODE_COMMAND`: command to run instead of `code`
- `COPILOT_AHP_ADDRESS`: explicit Agent Host WebSocket address
- `COPILOT_AHP_AUTO_START=0`: require `COPILOT_AHP_ADDRESS` instead of starting/discovering the host

If Agent Host requests GitHub authentication, Piper uses `gh auth token` for GitHub protected resources.

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
	harnesses: [new MockHarness()],
});

const summary = await orchestrator.execute(
	workflow(
		task({ goal: "Create plan", harness: "mock", artifact: plan }),
		task({ goal: "Implement plan", harness: "mock", context: [plan.value()] }),
	),
);

console.log(summary.artifactPath);
```

SDK hooks let you observe execution, customize reporting, and integrate Piper into a larger toolchain.

### Add guardrails

Piper keeps post-run protected-file checks, and it also passes constraints to command harnesses so Pi/Copilot hooks can proactively block restricted tool calls before they happen.

For architecture details, project layout, and harness enforcement notes, read [ARCHITECTURE.md](ARCHITECTURE.md).
