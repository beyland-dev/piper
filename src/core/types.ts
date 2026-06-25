export type MaybePromise<T> = T | Promise<T>;

export interface ProgressUpdate {
  message: string;
  attempt: number;
  stream?: "stdout" | "stderr" | "system";
  timestamp: number;
}

export interface TaskResult {
  output: string;
  modifiedFiles: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskError {
  message: string;
  logs?: string;
  modifiedFiles?: string[];
  retryable: boolean;
}

export interface TaskHandle {
  readonly progress: AsyncIterable<ProgressUpdate>;
  readonly completed: Promise<TaskResult>;
  readonly errored: Promise<TaskError>;
}

export interface HarnessAdapter {
  name: string;
  startTask(params: {
    goal: string;
    model?: string;
    context: string[];
    constraints: string[];
    protectedFiles: string[];
    workspacePath: string;
  }): TaskHandle;
  retry(taskHandle: TaskHandle, failures: string[]): void;
  cancel(taskHandle: TaskHandle): void;
}

export interface RuntimeValueContext {
  workspacePath: string;
  readArtifact(name: string): Promise<string>;
  readTaskResult(name: string): Promise<TaskResult>;
}

export interface RuntimeValue<T> {
  readonly kind: "runtime-value";
  readonly description: string;
  readonly dependencies: readonly string[];
  resolve(context: RuntimeValueContext): MaybePromise<T>;
}

export interface Artifact<Name extends string = string> {
  readonly kind: "artifact";
  readonly name: Name;
  value(): RuntimeValue<string>;
  result(): RuntimeValue<TaskResult>;
}

export type ArtifactTarget = string | Artifact;
export type ContextValue = string | RuntimeValue<string>;
export type ValidationValue = string | RuntimeValue<boolean>;

export interface TaskProps {
  goal: string;
  harness: string;
  model?: string;
  context?: ContextValue[];
  constraints?: string[];
  validate?: ValidationValue[];
  artifact?: ArtifactTarget;
  "on:complete"?: (result: TaskResult) => void;
  "on:error"?: (error: TaskError) => void;
}

export interface ParallelProps {
  status?: string;
  children?: TaskNode | TaskNode[];
}

export interface RecoverProps {
  onFailure: (error: TaskError, retry: () => void) => TaskNode;
  maxRetries?: number;
  "on:fatal"?: (error: TaskError) => void;
  children?: TaskNode | TaskNode[];
}

export interface ProtectProps {
  protectedFiles: string[];
  validate?: ValidationValue[];
  children?: TaskNode | TaskNode[];
}

export interface TaskNodeBase<K extends string, P> {
  kind: K;
  props: P;
}

export interface TaskNodeProps extends TaskProps {}

export interface ParallelNodeProps extends Omit<ParallelProps, "children"> {
  children: TaskNode[];
}

export interface RecoverNodeProps extends Omit<RecoverProps, "children"> {
  children: TaskNode[];
}

export interface ProtectNodeProps extends Omit<ProtectProps, "children"> {
  children: TaskNode[];
}

export interface TaskElement extends TaskNodeBase<"task", TaskNodeProps> {}
export interface ParallelNode extends TaskNodeBase<"parallel", ParallelNodeProps> {}
export interface RecoverNode extends TaskNodeBase<"recover", RecoverNodeProps> {}
export interface ProtectNode extends TaskNodeBase<"protect", ProtectNodeProps> {}
export interface WorkflowNode extends TaskNodeBase<"workflow", { children: TaskNode[] }> {}

export type TaskNode =
  | TaskElement
  | ParallelNode
  | RecoverNode
  | ProtectNode
  | WorkflowNode
  | null
  | undefined
  | false;

export type TaskTree = TaskNode | TaskNode[];

export interface TaskAttemptInfo {
  id: string;
  goal: string;
  harness: string;
  model?: string;
  attempt: number;
}

export interface ExecutionSummary {
  completedTasks: number;
  failedTasks: number;
  artifacts: Record<string, string>;
  runId: string | null;
  artifactPath: string | null;
}

export interface RuntimeHooks {
  info(message: string): void;
  taskStarted(info: TaskAttemptInfo): void;
  taskProgress(info: TaskAttemptInfo, update: ProgressUpdate): void;
  taskRetry(info: TaskAttemptInfo, failures: string[]): void;
  taskCompleted(info: TaskAttemptInfo, result: TaskResult): void;
  taskFailed(info: TaskAttemptInfo, error: TaskError): void;
  summary(summary: ExecutionSummary): void;
}

export interface ArtifactStorageOptions {
  rootDir?: string;
  runId?: string;
}

export interface ExecutorOptions {
  workspacePath: string;
  harnesses: HarnessAdapter[];
  hooks?: RuntimeHooks;
  taskRetryLimit?: number;
  artifactStorage?: ArtifactStorageOptions | false;
}
