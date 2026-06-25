import { ROOT_CONSTRAINT_SCOPE, extendConstraintScope, protectedFileConstraint, type ConstraintScope } from "../core/constraint-context.js";
import { normalizeTree } from "../core/node-utils.js";
import { isSignal } from "../core/use-output.js";
import type {
  AgentAdapter,
  ExecutionSummary,
  ExecutorOptions,
  RuntimeReporter,
  SignalRuntimeContext,
  TaskAttemptInfo,
  TaskError,
  TaskHandle,
  TaskNode,
  TaskResult,
  TaskTree
} from "../core/types.js";
import { captureGitSnapshot, enforceProtectedFiles } from "./constraint-checker.js";
import { runValidations } from "./validator.js";

class NullReporter implements RuntimeReporter {
  info(): void {}
  taskStarted(): void {}
  taskProgress(): void {}
  taskRetry(): void {}
  taskCompleted(): void {}
  taskFailed(): void {}
  summary(): void {}
}

type Waiter<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

class OutputStore {
  private readonly outputs = new Map<string, TaskResult>();
  private readonly outputWaiters = new Map<string, Waiter<string>[]>();
  private readonly resultWaiters = new Map<string, Waiter<TaskResult>[]>();
  private readonly declaredOutputs = new Set<string>();
  private readonly pendingProducers = new Map<string, number>();
  private readonly failures = new Map<string, Error>();

  constructor(declarations: Map<string, number> = new Map()) {
    this.declareAll(declarations);
  }

  declareAll(declarations: Map<string, number>): void {
    for (const [name, count] of declarations) {
      this.declare(name, count);
    }
  }

  declare(name: string, count = 1): void {
    if (count <= 0) {
      return;
    }

    this.declaredOutputs.add(name);
    this.pendingProducers.set(name, (this.pendingProducers.get(name) ?? 0) + count);
  }

  set(name: string, result: TaskResult): void {
    if (this.outputs.has(name)) {
      throw new Error(`Output "${name}" has already been produced.`);
    }

    this.outputs.set(name, result);
    this.failures.delete(name);
    this.pendingProducers.set(name, 0);

    for (const waiter of this.outputWaiters.get(name) ?? []) {
      waiter.resolve(result.output);
    }
    for (const waiter of this.resultWaiters.get(name) ?? []) {
      waiter.resolve(result);
    }
    this.outputWaiters.delete(name);
    this.resultWaiters.delete(name);
  }

  fail(name: string, error = this.createTaskFailedError(name)): void {
    if (!this.declaredOutputs.has(name) || this.outputs.has(name) || this.failures.has(name)) {
      return;
    }

    const remainingProducers = Math.max(0, (this.pendingProducers.get(name) ?? 0) - 1);
    this.pendingProducers.set(name, remainingProducers);

    if (remainingProducers === 0) {
      this.failures.set(name, error);
      this.rejectWaiters(name, error);
    }
  }

  closePending(reason?: unknown): void {
    for (const name of this.declaredOutputs) {
      if (this.outputs.has(name) || this.failures.has(name)) {
        continue;
      }

      const error = reason ? this.createExecutionAbortedError(name) : this.createNeverProducedError(name);
      this.failures.set(name, error);
      this.rejectWaiters(name, error);
    }
  }

  async waitForOutput(name: string): Promise<string> {
    const existing = this.outputs.get(name);
    if (existing) {
      return existing.output;
    }

    const failure = this.failures.get(name);
    if (failure) {
      throw failure;
    }

    if (!this.declaredOutputs.has(name)) {
      throw this.createUnknownOutputError(name);
    }

    return new Promise<string>((resolve, reject) => {
      const waiters = this.outputWaiters.get(name) ?? [];
      waiters.push({ resolve, reject });
      this.outputWaiters.set(name, waiters);
    });
  }

  async waitForResult(name: string): Promise<TaskResult> {
    const existing = this.outputs.get(name);
    if (existing) {
      return existing;
    }

    const failure = this.failures.get(name);
    if (failure) {
      throw failure;
    }

    if (!this.declaredOutputs.has(name)) {
      throw this.createUnknownOutputError(name);
    }

    return new Promise<TaskResult>((resolve, reject) => {
      const waiters = this.resultWaiters.get(name) ?? [];
      waiters.push({ resolve, reject });
      this.resultWaiters.set(name, waiters);
    });
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries([...this.outputs.entries()].map(([name, result]) => [name, result.output]));
  }

  private rejectWaiters(name: string, error: Error): void {
    for (const waiter of this.outputWaiters.get(name) ?? []) {
      waiter.reject(error);
    }
    for (const waiter of this.resultWaiters.get(name) ?? []) {
      waiter.reject(error);
    }

    this.outputWaiters.delete(name);
    this.resultWaiters.delete(name);
  }

  private createUnknownOutputError(name: string): Error {
    return new Error(
      `Unknown output "${name}". No task declares output="${name}". Add or fix output="${name}" on an upstream task.`
    );
  }

  private createTaskFailedError(name: string): Error {
    return new Error(`Output "${name}" was not produced because its task failed.`);
  }

  private createExecutionAbortedError(name: string): Error {
    return new Error(`Output "${name}" was not produced because execution aborted.`);
  }

  private createNeverProducedError(name: string): Error {
    return new Error(`Output "${name}" was declared but never produced.`);
  }
}

function collectDeclaredOutputs(node: TaskNode): Map<string, number> {
  const declarations = new Map<string, number>();

  const visit = (current: TaskNode): void => {
    if (!current) {
      return;
    }

    switch (current.kind) {
      case "task":
        if (current.props.output) {
          declarations.set(current.props.output, (declarations.get(current.props.output) ?? 0) + 1);
        }
        return;
      case "sequence":
      case "guarded":
      case "error-boundary":
        for (const child of current.props.children) {
          visit(child);
        }
        return;
      case "suspense":
        for (const child of current.props.children) {
          visit(child);
        }
        if (current.props.fallback && typeof current.props.fallback !== "string") {
          visit(current.props.fallback);
        }
        return;
      default:
        return;
    }
  };

  visit(node);
  return declarations;
}

function toTaskError(error: unknown, fallbackMessage = "Task failed"): TaskError {
  if (typeof error === "object" && error !== null && "message" in error && "retryable" in error) {
    return error as TaskError;
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      logs: error.stack,
      retryable: false
    };
  }

  return {
    message: fallbackMessage,
    logs: typeof error === "string" ? error : undefined,
    retryable: false
  };
}

export class WorkflowExecutor {
  private readonly adapters = new Map<string, AgentAdapter>();
  private readonly reporter: RuntimeReporter;
  private readonly retryLimit: number;
  private outputs = new OutputStore();
  private readonly workspacePath: string;
  private taskIndex = 0;
  private completedTasks = 0;
  private failedTasks = 0;

  constructor(options: ExecutorOptions) {
    for (const adapter of options.adapters) {
      this.adapters.set(adapter.name, adapter);
    }

    this.reporter = options.reporter ?? new NullReporter();
    this.retryLimit = options.taskRetryLimit ?? 3;
    this.workspacePath = options.workspacePath;
  }

  async execute(tree: TaskTree): Promise<ExecutionSummary> {
    const normalizedTree = normalizeTree(tree);
    this.outputs = new OutputStore(collectDeclaredOutputs(normalizedTree));

    try {
      await this.executeNode(normalizedTree, ROOT_CONSTRAINT_SCOPE);
    } catch (error) {
      this.outputs.closePending(error);
      throw error;
    }

    this.outputs.closePending();

    const summary = {
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      outputs: this.outputs.snapshot()
    };

    this.reporter.summary(summary);
    return summary;
  }

  private createSignalRuntimeContext(): SignalRuntimeContext {
    return {
      workspacePath: this.workspacePath,
      readOutput: (name) => this.outputs.waitForOutput(name),
      readTaskResult: (name) => this.outputs.waitForResult(name)
    };
  }

  private async resolveContext(values: Array<string | { resolve(context: SignalRuntimeContext): Promise<string> | string }> = []): Promise<string[]> {
    const context = this.createSignalRuntimeContext();

    return Promise.all(
      values.map(async (value) => {
        if (typeof value === "string") {
          return value;
        }

        if (isSignal(value)) {
          return value.resolve(context);
        }

        throw new Error("Encountered an invalid context value.");
      })
    );
  }

  private async observeAttempt(handle: TaskHandle, info: TaskAttemptInfo): Promise<TaskResult> {
    const progressTask = (async () => {
      for await (const update of handle.progress) {
        this.reporter.taskProgress(info, update);
      }
    })();

    const outcome = await Promise.race([
      handle.completed.then((result) => ({ kind: "completed" as const, result })),
      handle.errored.then((error) => ({ kind: "errored" as const, error }))
    ]);

    await progressTask;

    if (outcome.kind === "errored") {
      throw outcome.error;
    }

    return outcome.result;
  }

  private async executeTask(node: Extract<TaskNode, { kind: "task" }>, scope: ConstraintScope): Promise<void> {
    const adapter = this.adapters.get(node.props.agent);
    if (!adapter) {
      throw new Error(`No adapter registered for agent "${node.props.agent}".`);
    }

    const taskId = `task-${++this.taskIndex}`;
    const resolvedContext = await this.resolveContext(node.props.context);
    const childScope = extendConstraintScope(scope, node.props.constraints);
    const maxAttempts = this.retryLimit + 1;
    let taskHandle: TaskHandle | undefined;
    let failures: string[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const info: TaskAttemptInfo = {
        id: taskId,
        goal: node.props.goal,
        agent: node.props.agent,
        attempt
      };

      const snapshot = await captureGitSnapshot(this.workspacePath);
      this.reporter.taskStarted(info);

      if (attempt === 1) {
        taskHandle = adapter.startTask({
          goal: node.props.goal,
          context: resolvedContext,
          workspacePath: this.workspacePath
        });
      } else {
        adapter.retry(taskHandle as TaskHandle, failures);
      }

      let result: TaskResult;
      try {
        result = await this.observeAttempt(taskHandle as TaskHandle, info);
      } catch (rawError) {
        const error = toTaskError(rawError);
        const constraintFailures = await enforceProtectedFiles({
          workspacePath: this.workspacePath,
          snapshot,
          protectedFiles: childScope.protectedFiles
        });

        const combinedFailures = [...constraintFailures];
        if (error.logs) {
          combinedFailures.push(error.logs);
        } else {
          combinedFailures.push(error.message);
        }

        if (error.retryable && attempt < maxAttempts) {
          failures = combinedFailures;
          this.reporter.taskRetry(info, combinedFailures);
          continue;
        }

        if (node.props.output) {
          this.outputs.fail(node.props.output);
        }

        this.failedTasks += 1;
        this.reporter.taskFailed(info, error);
        node.props["on:error"]?.(error);
        throw error;
      }

      const constraintFailures = await enforceProtectedFiles({
        workspacePath: this.workspacePath,
        snapshot,
        protectedFiles: childScope.protectedFiles
      });
      const validationFailures = await runValidations(node.props.validate, this.createSignalRuntimeContext());
      const allFailures = [...constraintFailures, ...validationFailures];

      if (allFailures.length > 0) {
        if (attempt < maxAttempts) {
          failures = allFailures;
          this.reporter.taskRetry(info, allFailures);
          continue;
        }

        const error: TaskError = {
          message: `Task failed after ${attempt} attempts.`,
          logs: allFailures.join("\n\n"),
          modifiedFiles: result.modifiedFiles,
          retryable: false
        };

        if (node.props.output) {
          this.outputs.fail(node.props.output);
        }

        this.failedTasks += 1;
        this.reporter.taskFailed(info, error);
        node.props["on:error"]?.(error);
        throw error;
      }

      if (node.props.output) {
        this.outputs.set(node.props.output, result);
      }

      this.completedTasks += 1;
      this.reporter.taskCompleted(info, result);
      node.props["on:complete"]?.(result);
      return;
    }

    throw new Error(`Task "${node.props.goal}" exited its retry loop unexpectedly.`);
  }

  private async executeSuspense(node: Extract<TaskNode, { kind: "suspense" }>, scope: ConstraintScope): Promise<void> {
    if (typeof node.props.fallback === "string") {
      this.reporter.info(node.props.fallback);
    }

    const fallbackPromise =
      node.props.fallback && typeof node.props.fallback !== "string"
        ? this.executeNode(node.props.fallback, scope)
        : Promise.resolve();

    const childrenPromise = Promise.all(node.props.children.map((child) => this.executeNode(child, scope)));
    await Promise.all([childrenPromise, fallbackPromise]);
  }

  private async executeErrorBoundary(node: Extract<TaskNode, { kind: "error-boundary" }>, scope: ConstraintScope): Promise<void> {
    const maxRetries = node.props.maxRetries ?? 3;
    let attempts = 0;

    while (true) {
      try {
        await this.executeSequence(node.props.children, scope);
        return;
      } catch (rawError) {
        const error = toTaskError(rawError, "Error boundary caught a failure.");
        if (attempts >= maxRetries) {
          node.props["on:fatal"]?.(error);
          throw error;
        }

        attempts += 1;
        let retryRequested = false;
        const retry = () => {
          retryRequested = true;
        };

        const fallback = node.props.fallback(error, retry);
        this.outputs.declareAll(collectDeclaredOutputs(fallback));
        await this.executeNode(fallback, scope);

        if (!retryRequested) {
          throw error;
        }
      }
    }
  }

  private async executeGuarded(node: Extract<TaskNode, { kind: "guarded" }>, scope: ConstraintScope): Promise<void> {
    const childScope = extendConstraintScope(
      scope,
      node.props.protectedFiles.map((filePath) => protectedFileConstraint(filePath))
    );

    await this.executeSequence(node.props.children, childScope);

    const failures = await runValidations(node.props.validate, this.createSignalRuntimeContext());
    if (failures.length > 0) {
      throw {
        message: "Guarded validation failed.",
        logs: failures.join("\n\n"),
        retryable: false
      } satisfies TaskError;
    }
  }

  private async executeSequence(children: TaskNode[], scope: ConstraintScope): Promise<void> {
    for (const child of children) {
      await this.executeNode(child, scope);
    }
  }

  private async executeNode(node: TaskNode, scope: ConstraintScope): Promise<void> {
    if (!node) {
      return;
    }

    switch (node.kind) {
      case "task":
        await this.executeTask(node, scope);
        return;
      case "sequence":
        await this.executeSequence(node.props.children, scope);
        return;
      case "suspense":
        await this.executeSuspense(node, scope);
        return;
      case "error-boundary":
        await this.executeErrorBoundary(node, scope);
        return;
      case "guarded":
        await this.executeGuarded(node, scope);
        return;
      default:
        throw new Error(`Unsupported task node: ${(node as { kind?: string }).kind ?? "unknown"}`);
    }
  }
}
