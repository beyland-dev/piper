import type { ProgressUpdate, TaskError, TaskHandle, TaskResult } from "../core/types.js";
import { AsyncQueue } from "../utils/async-queue.js";

export class ManagedTaskHandle implements TaskHandle {
	private currentProgress: AsyncQueue<ProgressUpdate>;
	private currentCompleted: Promise<TaskResult>;
	private currentErrored: Promise<TaskError>;
	private cancelCurrentAttempt: () => void;
	private canceled: boolean;

	constructor() {
		this.currentProgress = new AsyncQueue<ProgressUpdate>();
		this.currentCompleted = new Promise<TaskResult>(() => undefined);
		this.currentErrored = new Promise<TaskError>(() => undefined);
		this.cancelCurrentAttempt = () => undefined;
		this.canceled = false;
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

		if (this.canceled) {
			this.cancelCurrentAttempt();
		}
	}

	cancel(): void {
		this.canceled = true;
		this.cancelCurrentAttempt();
	}
}
