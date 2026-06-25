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

export interface AgentAdapter {
  name: string;
  startTask(params: {
    goal: string;
    context: string[];
    workspacePath: string;
  }): TaskHandle;
  retry(taskHandle: TaskHandle, failures: string[]): void;
  cancel(taskHandle: TaskHandle): void;
}

export interface SignalRuntimeContext {
  workspacePath: string;
  readOutput(name: string): Promise<string>;
  readTaskResult(name: string): Promise<TaskResult>;
}

export interface Signal<T> {
  readonly kind: "signal";
  readonly description: string;
  resolve(context: SignalRuntimeContext): MaybePromise<T>;
}

export type ContextValue = string | Signal<string>;
export type ValidationValue = string | Signal<boolean>;

export interface TaskProps {
  goal: string;
  agent: string;
  context?: ContextValue[];
  constraints?: string[];
  validate?: ValidationValue[];
  output?: string;
  "on:complete"?: (result: TaskResult) => void;
  "on:error"?: (error: TaskError) => void;
}

export interface SuspenseProps {
  fallback?: TaskNode | string;
  children?: TaskNode | TaskNode[];
}

export interface ErrorBoundaryProps {
  fallback: (error: TaskError, retry: () => void) => TaskNode;
  maxRetries?: number;
  "on:fatal"?: (error: TaskError) => void;
  children?: TaskNode | TaskNode[];
}

export interface GuardedProps {
  protectedFiles: string[];
  validate?: ValidationValue[];
  children?: TaskNode | TaskNode[];
}

export interface TaskNodeBase<K extends string, P> {
  kind: K;
  props: P;
}

export interface TaskComponentProps extends TaskProps {}

export interface SuspenseComponentProps extends Omit<SuspenseProps, "children"> {
  children: TaskNode[];
}

export interface ErrorBoundaryComponentProps extends Omit<ErrorBoundaryProps, "children"> {
  children: TaskNode[];
}

export interface GuardedComponentProps extends Omit<GuardedProps, "children"> {
  children: TaskNode[];
}

export interface TaskElement extends TaskNodeBase<"task", TaskComponentProps> {}
export interface SuspenseNode extends TaskNodeBase<"suspense", SuspenseComponentProps> {}
export interface ErrorBoundaryNode extends TaskNodeBase<"error-boundary", ErrorBoundaryComponentProps> {}
export interface GuardedNode extends TaskNodeBase<"guarded", GuardedComponentProps> {}
export interface SequenceNode extends TaskNodeBase<"sequence", { children: TaskNode[] }> {}

export type TaskNode =
  | TaskElement
  | SuspenseNode
  | ErrorBoundaryNode
  | GuardedNode
  | SequenceNode
  | null
  | undefined
  | false;

export type TaskTree = TaskNode | TaskNode[];

export interface TaskAttemptInfo {
  id: string;
  goal: string;
  agent: string;
  attempt: number;
}

export interface ExecutionSummary {
  completedTasks: number;
  failedTasks: number;
  outputs: Record<string, string>;
}

export interface RuntimeReporter {
  info(message: string): void;
  taskStarted(info: TaskAttemptInfo): void;
  taskProgress(info: TaskAttemptInfo, update: ProgressUpdate): void;
  taskRetry(info: TaskAttemptInfo, failures: string[]): void;
  taskCompleted(info: TaskAttemptInfo, result: TaskResult): void;
  taskFailed(info: TaskAttemptInfo, error: TaskError): void;
  summary(summary: ExecutionSummary): void;
}

export interface ExecutorOptions {
  workspacePath: string;
  adapters: AgentAdapter[];
  reporter?: RuntimeReporter;
  taskRetryLimit?: number;
}
