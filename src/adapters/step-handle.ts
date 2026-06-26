import type { ProgressUpdate, StepError, StepHandle, StepResult } from "../core/types.js";
import { AsyncQueue } from "../utils/async-queue.js";

export class ManagedStepHandle implements StepHandle {
	private currentProgress: AsyncQueue<ProgressUpdate>;
	private currentCompleted: Promise<StepResult>;
	private currentErrored: Promise<StepError>;
	private cancelCurrentAttempt: () => void;
	private canceled: boolean;

	constructor() {
		this.currentProgress = new AsyncQueue<ProgressUpdate>();
		this.currentCompleted = new Promise<StepResult>(() => undefined);
		this.currentErrored = new Promise<StepError>(() => undefined);
		this.cancelCurrentAttempt = () => undefined;
		this.canceled = false;
	}

	get progress(): AsyncIterable<ProgressUpdate> {
		return this.currentProgress;
	}

	get completed(): Promise<StepResult> {
		return this.currentCompleted;
	}

	get errored(): Promise<StepError> {
		return this.currentErrored;
	}

	setAttempt(params: {
		progress: AsyncQueue<ProgressUpdate>;
		completed: Promise<StepResult>;
		errored: Promise<StepError>;
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
