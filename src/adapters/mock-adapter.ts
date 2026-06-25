import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { AgentAdapter, ProgressUpdate, TaskError, TaskHandle, TaskResult } from "../core/types.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { createDeferred } from "../utils/deferred.js";
import { ManagedTaskHandle } from "./task-handle.js";

export interface MockBehavior {
  delayMs?: number;
  output?: string;
  progress?: string[];
  modifiedFiles?: Array<{ path: string; content: string }>;
  metadata?: Record<string, unknown>;
  failOnAttempt?: number | number[];
  retryable?: boolean;
  errorMessage?: string;
}

export interface MockAttemptRecord {
  goal: string;
  context: string[];
  attempt: number;
  failures: string[];
}

export interface MockAdapterOptions {
  delayMs?: number;
  behaviors?: Record<string, MockBehavior>;
  resolveBehavior?: (params: {
    goal: string;
    context: string[];
    workspacePath: string;
    attempt: number;
    failures: string[];
  }) => MockBehavior | undefined;
}

interface MockTaskState {
  goal: string;
  context: string[];
  workspacePath: string;
  attempt: number;
}

function shouldFail(attempt: number, failOnAttempt?: number | number[]): boolean {
  if (failOnAttempt == null) {
    return false;
  }

  if (Array.isArray(failOnAttempt)) {
    return failOnAttempt.includes(attempt);
  }

  return failOnAttempt === attempt;
}

export class MockAdapter implements AgentAdapter {
  name = "mock";
  readonly history: MockAttemptRecord[] = [];

  private readonly options: MockAdapterOptions;
  private readonly state = new WeakMap<ManagedTaskHandle, MockTaskState>();

  constructor(options: MockAdapterOptions = {}) {
    this.options = options;
  }

  startTask(params: { goal: string; context: string[]; workspacePath: string }): TaskHandle {
    const handle = new ManagedTaskHandle();
    const state: MockTaskState = {
      ...params,
      attempt: 0
    };

    this.state.set(handle, state);
    this.runAttempt(handle, []);
    return handle;
  }

  retry(taskHandle: TaskHandle, failures: string[]): void {
    this.runAttempt(taskHandle as ManagedTaskHandle, failures);
  }

  cancel(taskHandle: TaskHandle): void {
    (taskHandle as ManagedTaskHandle).cancel();
  }

  private resolveBehavior(state: MockTaskState, failures: string[]): MockBehavior {
    const attempt = state.attempt;

    return (
      this.options.resolveBehavior?.({
        goal: state.goal,
        context: state.context,
        workspacePath: state.workspacePath,
        attempt,
        failures
      }) ??
      this.options.behaviors?.[state.goal] ?? {
        delayMs: this.options.delayMs ?? 25,
        output: `Mock completed: ${state.goal}`
      }
    );
  }

  private runAttempt(handle: ManagedTaskHandle, failures: string[]): void {
    const state = this.state.get(handle);
    if (!state) {
      throw new Error("Unknown mock task handle");
    }

    state.attempt += 1;
    const attempt = state.attempt;
    const behavior = this.resolveBehavior(state, failures);
    const progress = new AsyncQueue<ProgressUpdate>();
    const completed = createDeferred<TaskResult>();
    const errored = createDeferred<TaskError>();
    let canceled = false;

    handle.setAttempt({
      progress,
      completed: completed.promise,
      errored: errored.promise,
      cancel: () => {
        canceled = true;
      }
    });

    this.history.push({
      goal: state.goal,
      context: state.context,
      attempt,
      failures
    });

    void (async () => {
      try {
        progress.push({
          message: `mock attempt ${attempt} started`,
          attempt,
          stream: "system",
          timestamp: Date.now()
        });

        for (const entry of behavior.progress ?? []) {
          progress.push({
            message: entry,
            attempt,
            stream: "system",
            timestamp: Date.now()
          });
        }

        await new Promise((resolveDelay) => setTimeout(resolveDelay, behavior.delayMs ?? this.options.delayMs ?? 25));

        if (canceled) {
          progress.close();
          errored.resolve({
            message: "Mock task canceled",
            retryable: false
          });
          return;
        }

        const modifiedFiles: string[] = [];
        for (const file of behavior.modifiedFiles ?? []) {
          const absolutePath = resolve(state.workspacePath, file.path);
          await mkdir(dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, file.content, "utf8");
          modifiedFiles.push(file.path);
        }

        progress.push({
          message: `mock attempt ${attempt} completed`,
          attempt,
          stream: "system",
          timestamp: Date.now()
        });
        progress.close();

        if (shouldFail(attempt, behavior.failOnAttempt)) {
          errored.resolve({
            message: behavior.errorMessage ?? `Mock task failed on attempt ${attempt}`,
            retryable: behavior.retryable ?? true,
            modifiedFiles
          });
          return;
        }

        completed.resolve({
          output: behavior.output ?? `Mock completed: ${state.goal}`,
          modifiedFiles,
          metadata: behavior.metadata
        });
      } catch (error) {
        progress.close();
        errored.resolve({
          message: error instanceof Error ? error.message : "Mock task failed unexpectedly",
          logs: error instanceof Error ? error.stack : String(error),
          retryable: false
        });
      }
    })();
  }
}
