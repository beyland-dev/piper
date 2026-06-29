# Architecture In Plain English

## The short version

Piper is a meta-harness for coding agents. It sits above agent harnesses and executes explicit loops made of roles, steps, artifacts, evaluators, feedback, retries, policies, gates, and run records.

There is no hidden boss agent in Piper. A loop is an inspectable TypeScript object tree, and the runtime executes that tree with deterministic JavaScript control flow. Agent intelligence lives behind harnesses such as Copilot CLI, VS Code Agent Host Protocol, Pi, shell commands, or tests/mocks.

## Project layout

1. `src/core`: loop primitives, typed artifacts, runtime values, and builders
2. `src/runtime`: `PiperOrchestrator`, artifact persistence, feedback trail, gates, repeats, policies, and cancellation
3. `src/adapters`: harness bridges to real or mock coding-agent execution environments
4. `src/recipes`: polished high-level loop recipes
5. `src/cli`: CLI entry point for compiling, previewing, generating, and running loop files
6. `examples`: sample Piper loops
7. `tests`: Vitest coverage

## Mental model

Piper programs are loop systems:

1. `loop` declares the objective, known agents, initial state, policies, and stop checks.
2. `agent` names a role and binds it to a preferred harness/model/instruction set.
3. `step` asks a role or harness to produce work.
4. `artifact` stores durable outputs for later steps.
5. `evaluate` judges output quality.
6. Failures become structured `feedback`.
7. `repeat` sends the feedback trail into later attempts.
8. `parallel` explores independent branches.
9. `compare` records branch tradeoffs.
10. `gate` and `policy` enforce approval and guardrail boundaries.

The important shift is that Piper elevates feedback loops over one-off prompts.

## Runtime flow

From the CLI:

1. `piper` reads a `.piper.ts` file or receives an authoring prompt.
2. `esbuild` bundles the file and aliases `@beyland/piper` to the local runtime.
3. The module's default export returns a loop tree.
4. `PiperOrchestrator` walks the loop tree.
5. Step nodes prepare a harness attempt.
6. Before each harness attempt starts, Piper resolves step context and emits `context:start`, `context:value`, and `context:complete` runtime events. If preparation is cancelled or fails, it emits `context:cancel` or `context:fail` instead of starting the harness.
7. Harness adapters launch the configured coding-agent command or mock after context is ready.
8. The runtime records progress, artifacts, events, feedback, retries, and summaries.
9. Artifacts and run metadata are persisted to `~/.piper/runs/<run-id>/artifacts.json` by default.

Generation is still an authoring helper: Piper asks a harness to write a `.piper.ts` file, then validates or executes that explicit file only when requested.

## Harness boundary

Harnesses implement this contract:

1. Piper resolves strings, artifacts, and `runtimeValue` context before calling `startStep`.
2. `startStep` receives goal, resolved context, constraints, protected files, workspace path, and optional model.
3. The harness streams progress.
4. It resolves with output, modified files, and metadata, or rejects with a step error.
5. It supports retry and cancel.

Piper does not know how Copilot, Pi, Claude, Codex, or another agent thinks. It only coordinates the surrounding loop.

## Feedback and artifacts

Artifacts are durable named outputs. Later context can depend on `artifact("name")`, `artifact("name").value()`, or `artifact("name").result()`.

Evaluator failures create structured feedback records. Later steps automatically receive the feedback trail in their context, which makes retry loops explicit instead of hiding critique in logs.

## Policies and gates

Policies add constraints and protected files to a scope. The runtime passes those constraints to harnesses and also performs post-attempt protected-file enforcement as defense in depth.

Gates are explicit approval boundaries. They can be simple auto-approved checkpoints today or evaluator-backed checks that stop a loop.

## Recipes

Recipes in `src/recipes` are normal loop builders that package common systems:

- plan then implement
- implement until tests pass
- research then synthesize
- critic loop
- parallel investigate then decide
- safe refactor
- migration playbook
- release train

They should feel magical without becoming opaque: every recipe returns an inspectable loop tree.

## What Piper is not

Piper is not an agent, a hosted-only product, an editor-only plugin, or a hidden autonomous planner. It is an SDK-first runtime with a CLI-first developer experience for building explicit systems around coding agents.
