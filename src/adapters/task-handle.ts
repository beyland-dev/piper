import { AsyncQueue } from "../utils/async-queue.js";
import type { ProgressUpdate, TaskError, TaskHandle, TaskResult } from "../core/types.js";

export class ManagedTaskHandle implements TaskHandle {
  private currentProgress: AsyncQueue<ProgressUpdate>;
  private currentCompleted: Promise<TaskResult>;
  private currentErrored: Promise<TaskError>;
  private cancelCurrentAttempt: () => void;

  constructor() {
    this.currentProgress = new AsyncQueue<ProgressUpdate>();
    this.currentCompleted = new Promise<TaskResult>(() => undefined);
    this.currentErrored = new Promise<TaskError>(() => undefined);
    this.cancelCurrentAttempt = () => undefined;
  }

  get progress(): AsyncIterable<ProgressUpdate> {
    return this.currentProgress;
  }

  get completed(): Promise<TaskResult> {
    return this.currentCompleted;
  }

  get errored(): Promise<TaskError> {
    return this.currentErrored;
  }

  setAttempt(params: {
    progress: AsyncQueue<ProgressUpdate>;
    completed: Promise<TaskResult>;
    errored: Promise<TaskError>;
    cancel?: () => void;
  }): void {
    this.currentProgress = params.progress;
    this.currentCompleted = params.completed;
    this.currentErrored = params.errored;
    this.cancelCurrentAttempt = params.cancel ?? (() => undefined);
  }

  cancel(): void {
    this.cancelCurrentAttempt();
  }
}
