import type { AgentAdapter, ProgressUpdate, TaskError, TaskHandle, TaskResult } from "../core/types.js";
import { listModifiedFiles } from "../runtime/constraint-checker.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { createDeferred } from "../utils/deferred.js";
import { fillTemplate, shellEscape } from "../utils/shell.js";
import { spawnStreamingCommand } from "../utils/process.js";
import { ManagedTaskHandle } from "./task-handle.js";

export interface PiAdapterOptions {
  command?: string;
  commandTemplate?: string;
  env?: Record<string, string>;
}

interface PiTaskState {
  goal: string;
  context: string[];
  workspacePath: string;
  attempt: number;
}

function defaultPrompt(goal: string, context: string[], failures: string[]): string {
  const sections = [`Goal:\n${goal}`];

  if (context.length > 0) {
    sections.push(`Context:\n${context.join("\n\n")}`);
  }

  if (failures.length > 0) {
    sections.push(`Retry feedback:\n${failures.join("\n\n")}`);
  }

  return sections.join("\n\n");
}

export class PiAdapter implements AgentAdapter {
  name = "pi";

  private readonly options: PiAdapterOptions;
  private readonly state = new WeakMap<ManagedTaskHandle, PiTaskState>();

  constructor(options: PiAdapterOptions = {}) {
    this.options = options;
  }

  startTask(params: { goal: string; context: string[]; workspacePath: string }): TaskHandle {
    const handle = new ManagedTaskHandle();
    this.state.set(handle, {
      ...params,
      attempt: 0
    });
    this.runAttempt(handle, []);
    return handle;
  }

  retry(taskHandle: TaskHandle, failures: string[]): void {
    this.runAttempt(taskHandle as ManagedTaskHandle, failures);
  }

  cancel(taskHandle: TaskHandle): void {
    (taskHandle as ManagedTaskHandle).cancel();
  }

  private buildCommand(goal: string, context: string[], workspacePath: string, attempt: number, failures: string[]): string {
    const prompt = defaultPrompt(goal, context, failures);
    if (this.options.commandTemplate) {
      return fillTemplate(this.options.commandTemplate, {
        goal,
        context: context.join("\n"),
        workspacePath,
        prompt,
        retryReason: failures.join("\n"),
        attempt: String(attempt)
      });
    }

    const executable = this.options.command ?? "pi";
    return `${shellEscape(executable)} ${shellEscape(prompt)}`;
  }

  private runAttempt(handle: ManagedTaskHandle, failures: string[]): void {
    const state = this.state.get(handle);
    if (!state) {
      throw new Error("Unknown pi task handle");
    }

    state.attempt += 1;
    const attempt = state.attempt;
    const progress = new AsyncQueue<ProgressUpdate>();
    const completed = createDeferred<TaskResult>();
    const errored = createDeferred<TaskError>();

    handle.setAttempt({
      progress,
      completed: completed.promise,
      errored: errored.promise
    });

    void (async () => {
      try {
        const baseline = new Set(await listModifiedFiles(state.workspacePath));
        const command = this.buildCommand(state.goal, state.context, state.workspacePath, attempt, failures);
        const run = spawnStreamingCommand(command, {
          cwd: state.workspacePath,
          env: {
            ...this.options.env,
            PI_GOAL: state.goal,
            PI_CONTEXT: state.context.join("\n"),
            PI_PROMPT: defaultPrompt(state.goal, state.context, failures),
            PI_RETRY_REASON: failures.join("\n"),
            AGENT_GOAL: state.goal,
            AGENT_CONTEXT: state.context.join("\n"),
            AGENT_RETRY_REASON: failures.join("\n"),
            AGENT_WORKSPACE: state.workspacePath,
            AGENT_ATTEMPT: String(attempt)
          }
        });

        handle.setAttempt({
          progress,
          completed: completed.promise,
          errored: errored.promise,
          cancel: run.cancel
        });

        for await (const update of run.progress) {
          progress.push({
            ...update,
            attempt,
            timestamp: Date.now()
          });
        }

        const result = await run.completed;
        const currentFiles = await listModifiedFiles(state.workspacePath);
        const modifiedFiles = currentFiles.filter((file) => !baseline.has(file));
        progress.close();

        if (result.exitCode === 0) {
          completed.resolve({
            output: result.stdout || `pi completed: ${state.goal}`,
            modifiedFiles,
            metadata: {
              exitCode: result.exitCode,
              signal: result.signal
            }
          });
          return;
        }

        errored.resolve({
          message: `pi exited with code ${result.exitCode ?? "unknown"}`,
          logs: [result.stdout, result.stderr].filter(Boolean).join("\n"),
          modifiedFiles,
          retryable: true
        });
      } catch (error) {
        progress.close();
        errored.resolve({
          message: error instanceof Error ? error.message : "pi task failed unexpectedly",
          logs: error instanceof Error ? error.stack : String(error),
          retryable: false
        });
      }
    })();
  }
}
