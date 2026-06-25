import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { ROOT_CONSTRAINT_SCOPE, extendConstraintScope, protectedFileConstraint, type ConstraintScope } from "../core/constraint-context.js";
import { normalizeTree } from "../core/node-utils.js";
import { getArtifactName, isArtifact, isRuntimeValue } from "../core/output.js";
import type {
  HarnessAdapter,
  ContextValue,
  ExecutionSummary,
  ExecutorOptions,
  ArtifactStorageOptions,
  RuntimeHooks,
  RuntimeValueContext,
  TaskAttemptInfo,
  TaskError,
  TaskHandle,
  TaskNode,
  TaskResult,
  TaskTree
} from "../core/types.js";
import { captureGitSnapshot, enforceProtectedFiles } from "./constraint-checker.js";
import { runValidations } from "./validator.js";

const DEFAULT_PARALLEL_STATUS = "Running parallel tasks...";

class NullHooks implements RuntimeHooks {
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
  private readonly artifacts = new Map<string, TaskResult>();
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
    if (this.artifacts.has(name)) {
      throw new Error(`Output "${name}" has already been produced.`);
    }

    this.artifacts.set(name, result);
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
    if (!this.declaredOutputs.has(name) || this.artifacts.has(name) || this.failures.has(name)) {
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
      if (this.artifacts.has(name) || this.failures.has(name)) {
        continue;
      }

      const error = reason ? this.createExecutionAbortedError(name) : this.createNeverProducedError(name);
      this.failures.set(name, error);
      this.rejectWaiters(name, error);
    }
  }

  async waitForOutput(name: string): Promise<string> {
    const existing = this.artifacts.get(name);
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
    const existing = this.artifacts.get(name);
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
    return Object.fromEntries([...this.artifacts.entries()].map(([name, result]) => [name, result.output]));
  }

  snapshotResults(): Record<string, TaskResult> {
    return Object.fromEntries(this.artifacts.entries());
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
      `Unknown artifact "${name}". No task declares artifact="${name}". Add or fix artifact="${name}" on an upstream task.`
    );
  }

  private createTaskFailedError(name: string): Error {
    return new Error(`Artifact "${name}" was not produced because its task failed.`);
  }

  private createExecutionAbortedError(name: string): Error {
    return new Error(`Artifact "${name}" was not produced because execution aborted.`);
  }

  private createNeverProducedError(name: string): Error {
    return new Error(`Artifact "${name}" was declared but never produced.`);
  }
}

interface OutputGraph {
  declarations: Map<string, number>;
  references: Map<string, string[]>;
}

function addReference(references: Map<string, string[]>, name: string, description: string): void {
  const existing = references.get(name) ?? [];
  existing.push(description);
  references.set(name, existing);
}

function collectContextReferences(
  references: Map<string, string[]>,
  values: unknown[] | undefined,
  owner: string
): void {
  for (const value of values ?? []) {
    if (isArtifact(value)) {
      addReference(references, value.name, `${owner} context`);
      continue;
    }

    if (isRuntimeValue(value)) {
      for (const dependency of value.dependencies) {
        addReference(references, dependency, `${owner} runtime value "${value.description}"`);
      }
    }
  }
}

function collectValidationReferences(
  references: Map<string, string[]>,
  values: unknown[] | undefined,
  owner: string
): void {
  for (const value of values ?? []) {
    if (isRuntimeValue(value)) {
      for (const dependency of value.dependencies) {
        addReference(references, dependency, `${owner} validation "${value.description}"`);
      }
    }
  }
}

function collectOutputGraph(node: TaskNode): OutputGraph {
  const declarations = new Map<string, number>();
  const references = new Map<string, string[]>();

  const visit = (current: TaskNode): void => {
    if (!current) {
      return;
    }

    switch (current.kind) {
      case "task":
        if (current.props.artifact) {
          const name = getArtifactName(current.props.artifact);
          declarations.set(name, (declarations.get(name) ?? 0) + 1);
        }
        collectContextReferences(references, current.props.context, `task "${current.props.goal}"`);
        collectValidationReferences(references, current.props.validate, `task "${current.props.goal}"`);
        return;
      case "workflow":
      case "protect":
      case "recover":
        for (const child of current.props.children) {
          visit(child);
        }
        if (current.kind === "protect") {
          collectValidationReferences(references, current.props.validate, "protect block");
        }
        return;
      case "parallel":
        for (const child of current.props.children) {
          visit(child);
        }
        return;
      default:
        return;
    }
  };

  visit(node);
  return { declarations, references };
}

function validateOutputGraph(graph: OutputGraph): void {
  const failures: string[] = [];

  for (const [name, count] of graph.declarations) {
    if (count > 1) {
      failures.push(`Artifact "${name}" is declared ${count} times. Each artifact must have exactly one producer.`);
    }
  }

  for (const [name, locations] of graph.references) {
    if (!graph.declarations.has(name)) {
      failures.push(`Artifact "${name}" is referenced by ${locations.join(", ")} but no task declares it.`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Invalid workflow:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  }
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

function createRunId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

class OutputPersistence {
  readonly runId: string;
  readonly artifactPath: string;

  private readonly runDirectory: string;
  private readonly workspacePath: string;

  constructor(workspacePath: string, options: ArtifactStorageOptions = {}) {
    this.workspacePath = workspacePath;
    this.runId = options.runId ?? createRunId();
    const rootDir = options.rootDir ?? join(homedir(), ".piper", "runs");
    this.runDirectory = join(rootDir, this.runId);
    this.artifactPath = join(this.runDirectory, "artifacts.json");
  }

  async write(artifacts: Record<string, TaskResult>, summary?: Omit<ExecutionSummary, "artifacts">): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true });
    await writeFile(
      this.artifactPath,
      `${JSON.stringify(
        {
          runId: this.runId,
          workspacePath: this.workspacePath,
          updatedAt: new Date().toISOString(),
          summary,
          artifacts
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }
}

export class PiperOrchestrator {
  private readonly harnesses = new Map<string, HarnessAdapter>();
  private readonly hooks: RuntimeHooks;
  private readonly retryLimit: number;
  private readonly outputPersistence: OutputPersistence | null;
  private artifacts = new OutputStore();
  private readonly workspacePath: string;
  private taskIndex = 0;
  private completedTasks = 0;
  private failedTasks = 0;

  constructor(options: ExecutorOptions) {
    for (const harness of options.harnesses) {
      this.harnesses.set(harness.name, harness);
    }

    this.hooks = options.hooks ?? new NullHooks();
    this.retryLimit = options.taskRetryLimit ?? 3;
    this.workspacePath = options.workspacePath;
    this.outputPersistence =
      options.artifactStorage === false
        ? null
        : new OutputPersistence(options.workspacePath, options.artifactStorage);
  }

  async execute(tree: TaskTree): Promise<ExecutionSummary> {
    const normalizedTree = normalizeTree(tree);
    const outputGraph = collectOutputGraph(normalizedTree);
    validateOutputGraph(outputGraph);
    this.artifacts = new OutputStore(outputGraph.declarations);
    await this.persistOutputs();

    try {
      await this.executeNode(normalizedTree, ROOT_CONSTRAINT_SCOPE);
    } catch (error) {
      this.artifacts.closePending(error);
      await this.persistOutputs();
      throw error;
    }

    this.artifacts.closePending();

    const summary = {
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      artifacts: this.artifacts.snapshot(),
      runId: this.outputPersistence?.runId ?? null,
      artifactPath: this.outputPersistence?.artifactPath ?? null
    };

    await this.persistOutputs(summary);
    this.hooks.summary(summary);
    return summary;
  }

  private async persistOutputs(summary?: ExecutionSummary): Promise<void> {
    await this.outputPersistence?.write(
      this.artifacts.snapshotResults(),
      summary
        ? {
            completedTasks: summary.completedTasks,
            failedTasks: summary.failedTasks,
            runId: summary.runId,
            artifactPath: summary.artifactPath
          }
        : undefined
    );
  }

  private createRuntimeValueContext(): RuntimeValueContext {
    return {
      workspacePath: this.workspacePath,
      readArtifact: (name) => this.artifacts.waitForOutput(name),
      readTaskResult: (name) => this.artifacts.waitForResult(name)
    };
  }

  private async resolveContext(values: ContextValue[] = []): Promise<string[]> {
    const context = this.createRuntimeValueContext();

    return Promise.all(
      values.map(async (value) => {
        if (typeof value === "string") {
          return value;
        }

        if (isRuntimeValue(value)) {
          return value.resolve(context);
        }

        throw new Error("Encountered an invalid context value.");
      })
    );
  }

  private async observeAttempt(handle: TaskHandle, info: TaskAttemptInfo): Promise<TaskResult> {
    const progressTask = (async () => {
      for await (const update of handle.progress) {
        this.hooks.taskProgress(info, update);
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
    const harness = this.harnesses.get(node.props.harness);
    if (!harness) {
      throw new Error(`No harness registered for "${node.props.harness}".`);
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
        harness: node.props.harness,
        model: node.props.model,
        attempt
      };

      const snapshot = await captureGitSnapshot(this.workspacePath);
      this.hooks.taskStarted(info);

      if (attempt === 1) {
        taskHandle = harness.startTask({
          goal: node.props.goal,
          model: node.props.model,
          context: resolvedContext,
          constraints: childScope.constraints,
          protectedFiles: childScope.protectedFiles,
          workspacePath: this.workspacePath
        });
      } else {
        harness.retry(taskHandle as TaskHandle, failures);
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
          this.hooks.taskRetry(info, combinedFailures);
          continue;
        }

        if (node.props.artifact) {
          this.artifacts.fail(getArtifactName(node.props.artifact));
        }

        this.failedTasks += 1;
        this.hooks.taskFailed(info, error);
        node.props["on:error"]?.(error);
        throw error;
      }

      const constraintFailures = await enforceProtectedFiles({
        workspacePath: this.workspacePath,
        snapshot,
        protectedFiles: childScope.protectedFiles
      });
      const validationFailures = await runValidations(node.props.validate, this.createRuntimeValueContext());
      const allFailures = [...constraintFailures, ...validationFailures];

      if (allFailures.length > 0) {
        if (attempt < maxAttempts) {
          failures = allFailures;
          this.hooks.taskRetry(info, allFailures);
          continue;
        }

        const error: TaskError = {
          message: `Task failed after ${attempt} attempts.`,
          logs: allFailures.join("\n\n"),
          modifiedFiles: result.modifiedFiles,
          retryable: false
        };

        if (node.props.artifact) {
          this.artifacts.fail(getArtifactName(node.props.artifact));
        }

        this.failedTasks += 1;
        this.hooks.taskFailed(info, error);
        node.props["on:error"]?.(error);
        throw error;
      }

      if (node.props.artifact) {
        this.artifacts.set(getArtifactName(node.props.artifact), result);
        await this.persistOutputs();
      }

      this.completedTasks += 1;
      this.hooks.taskCompleted(info, result);
      node.props["on:complete"]?.(result);
      return;
    }

    throw new Error(`Task "${node.props.goal}" exited its retry loop unexpectedly.`);
  }

  private async executeParallel(node: Extract<TaskNode, { kind: "parallel" }>, scope: ConstraintScope): Promise<void> {
    this.hooks.info(node.props.status ?? DEFAULT_PARALLEL_STATUS);

    const childrenPromise = Promise.all(node.props.children.map((child) => this.executeNode(child, scope)));
    await childrenPromise;
  }

  private async executeRecover(node: Extract<TaskNode, { kind: "recover" }>, scope: ConstraintScope): Promise<void> {
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

        const recovery = node.props.onFailure(error, retry);
        const recoveryOutputGraph = collectOutputGraph(recovery);
        this.artifacts.declareAll(recoveryOutputGraph.declarations);
        await this.executeNode(recovery, scope);

        if (!retryRequested) {
          throw error;
        }
      }
    }
  }

  private async executeProtect(node: Extract<TaskNode, { kind: "protect" }>, scope: ConstraintScope): Promise<void> {
    const childScope = extendConstraintScope(
      scope,
      node.props.protectedFiles.map((filePath) => protectedFileConstraint(filePath))
    );

    await this.executeSequence(node.props.children, childScope);

    const failures = await runValidations(node.props.validate, this.createRuntimeValueContext());
    if (failures.length > 0) {
      throw {
        message: "Protect validation failed.",
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
      case "workflow":
        await this.executeSequence(node.props.children, scope);
        return;
      case "parallel":
        await this.executeParallel(node, scope);
        return;
      case "recover":
        await this.executeRecover(node, scope);
        return;
      case "protect":
        await this.executeProtect(node, scope);
        return;
      default:
        throw new Error(`Unsupported task node: ${(node as { kind?: string }).kind ?? "unknown"}`);
    }
  }
}
