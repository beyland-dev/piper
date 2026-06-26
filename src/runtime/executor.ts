import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	ROOT_CONSTRAINT_SCOPE,
	extendConstraintScope,
	protectedFileConstraint,
	type ConstraintScope,
} from "../core/constraint-context.js";
import { normalizeTree } from "../core/node-utils.js";
import { getArtifactName, isArtifact, isRuntimeValue } from "../core/output.js";
import type {
	ArtifactStorageOptions,
	ConcreteLoopNode,
	ContextValue,
	EvaluationResult,
	EvaluationValue,
	ExecutionSummary,
	ExecutorOptions,
	FeedbackRecord,
	HarnessAdapter,
	RuntimeHooks,
	RuntimeValueContext,
	StepAttemptInfo,
	TaskError,
	TaskHandle,
	TaskResult,
	TaskTree,
} from "../core/types.js";
import { runCommand } from "../utils/process.js";
import { captureGitSnapshot, enforceProtectedFiles } from "./constraint-checker.js";

const DEFAULT_PARALLEL_STATUS = "Running parallel loop branches...";

class NullHooks implements RuntimeHooks {
	info(): void {}
	stepStarted(): void {}
	stepProgress(): void {}
	stepRetry(): void {}
	stepCompleted(): void {}
	stepFailed(): void {}
	event(): void {}
	summary(): void {}
}

type Waiter<T> = {
	resolve: (value: T) => void;
	reject: (error: Error) => void;
};

type CancellationState = {
	error: PiperCancellationError | null;
	promise: Promise<PiperCancellationError>;
	resolve: (error: PiperCancellationError) => void;
};

type ActiveTask = {
	harness: HarnessAdapter;
};

function createCancellationState(): CancellationState {
	let resolveCancellation!: (error: PiperCancellationError) => void;
	const promise = new Promise<PiperCancellationError>((resolve) => {
		resolveCancellation = resolve;
	});

	return {
		error: null,
		promise,
		resolve: resolveCancellation,
	};
}

class OutputStore {
	private readonly artifacts = new Map<string, TaskResult>();
	private readonly outputWaiters = new Map<string, Waiter<string>[]>();
	private readonly resultWaiters = new Map<string, Waiter<TaskResult>[]>();
	private readonly declaredOutputs = new Set<string>();
	private readonly failures = new Map<string, Error>();

	declare(name: string): void {
		this.declaredOutputs.add(name);
	}

	declareAll(names: Iterable<string>): void {
		for (const name of names) {
			this.declare(name);
		}
	}

	set(name: string, result: TaskResult): void {
		this.declaredOutputs.add(name);
		this.artifacts.set(name, result);
		this.failures.delete(name);

		for (const waiter of this.outputWaiters.get(name) ?? []) {
			waiter.resolve(result.output);
		}
		for (const waiter of this.resultWaiters.get(name) ?? []) {
			waiter.resolve(result);
		}
		this.outputWaiters.delete(name);
		this.resultWaiters.delete(name);
	}

	fail(name: string, error = new Error(`Artifact "${name}" was not produced.`)): void {
		if (!this.declaredOutputs.has(name) || this.artifacts.has(name)) {
			return;
		}

		this.failures.set(name, error);
		this.rejectWaiters(name, error);
	}

	closePending(reason?: unknown): void {
		for (const name of this.declaredOutputs) {
			if (this.artifacts.has(name) || this.failures.has(name)) {
				continue;
			}

			const error = reason
				? new Error(`Artifact "${name}" was not produced because execution aborted.`)
				: new Error(`Artifact "${name}" was declared but never produced.`);
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
			throw new Error(
				`Unknown artifact "${name}". Add a step or compare node with produces="${name}" before reading it.`,
			);
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
			throw new Error(
				`Unknown artifact "${name}". Add a step or compare node with produces="${name}" before reading it.`,
			);
		}

		return new Promise<TaskResult>((resolve, reject) => {
			const waiters = this.resultWaiters.get(name) ?? [];
			waiters.push({ resolve, reject });
			this.resultWaiters.set(name, waiters);
		});
	}

	snapshot(): Record<string, string> {
		return Object.fromEntries(
			[...this.artifacts.entries()].map(([name, result]) => [name, result.output]),
		);
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
}

function collectArtifactDeclarations(node: ConcreteLoopNode): string[] {
	const names: string[] = [];
	const visit = (current: ConcreteLoopNode): void => {
		switch (current.kind) {
			case "step":
				if (current.props.produces ?? current.props.artifact) {
					names.push(getArtifactName((current.props.produces ?? current.props.artifact)!));
				}
				return;
			case "compare":
				if (current.props.produces) {
					names.push(getArtifactName(current.props.produces));
				}
				for (const branch of current.props.branches) {
					visit(branch.node);
				}
				return;
			case "loop":
			case "repeat":
			case "parallel":
			case "policy":
				for (const child of current.props.children) {
					visit(child);
				}
				return;
			default:
				return;
		}
	};

	visit(node);
	return names;
}

function toTaskError(error: unknown, fallbackMessage = "Step failed"): TaskError {
	if (typeof error === "object" && error !== null && "message" in error && "retryable" in error) {
		return error as TaskError;
	}

	if (error instanceof Error) {
		return {
			message: error.message,
			logs: error.stack,
			retryable: false,
		};
	}

	return {
		message: fallbackMessage,
		logs: typeof error === "string" ? error : undefined,
		retryable: false,
	};
}

function createRunId(): string {
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const random = Math.random().toString(36).slice(2, 8);
	return `${timestamp}-${random}`;
}

function attemptLabel(count: number): string {
	return `${count} ${count === 1 ? "attempt" : "attempts"}`;
}

class EvaluationFailure extends Error {
	readonly feedback: string[];

	constructor(feedback: string[]) {
		super(feedback.join("\n\n") || "Evaluation failed.");
		this.name = "EvaluationFailure";
		this.feedback = feedback;
	}
}

export class PiperCancellationError extends Error {
	readonly signal?: NodeJS.Signals;

	constructor(message = "Piper execution cancelled.", signal?: NodeJS.Signals) {
		super(message);
		this.name = "PiperCancellationError";
		this.signal = signal;
	}
}

export function isPiperCancellationError(error: unknown): error is PiperCancellationError {
	return error instanceof PiperCancellationError;
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

	async write(params: {
		artifacts: Record<string, TaskResult>;
		feedback: FeedbackRecord[];
		events: unknown[];
		summary?: Omit<ExecutionSummary, "artifacts" | "feedback" | "events">;
	}): Promise<void> {
		await mkdir(this.runDirectory, { recursive: true });
		await writeFile(
			this.artifactPath,
			`${JSON.stringify(
				{
					runId: this.runId,
					workspacePath: this.workspacePath,
					updatedAt: new Date().toISOString(),
					...params,
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
	}
}

export class PiperOrchestrator {
	private readonly harnesses = new Map<string, HarnessAdapter>();
	private readonly hooks: RuntimeHooks;
	private readonly retryLimit: number;
	private readonly outputPersistence: OutputPersistence | null;
	private readonly activeTasks = new Map<TaskHandle, ActiveTask>();
	private artifacts = new OutputStore();
	private cancellationState = createCancellationState();
	private readonly workspacePath: string;
	private stepIndex = 0;
	private completedSteps = 0;
	private failedSteps = 0;
	private readonly feedback: FeedbackRecord[] = [];
	private readonly events: ExecutionSummary["events"] = [];
	private readonly state = new Map<string, unknown>();
	private readonly agents = new Map<
		string,
		{ harness?: string; model?: string; instructions?: string; constraints: readonly string[] }
	>();

	constructor(options: ExecutorOptions) {
		for (const harness of options.harnesses) {
			this.harnesses.set(harness.name, harness);
		}

		this.hooks = options.hooks ?? new NullHooks();
		this.retryLimit = options.stepRetryLimit ?? options.taskRetryLimit ?? 3;
		this.workspacePath = options.workspacePath;
		this.outputPersistence =
			options.artifactStorage === false
				? null
				: new OutputPersistence(options.workspacePath, options.artifactStorage);
	}

	async execute(tree: TaskTree): Promise<ExecutionSummary> {
		if (!this.cancellationState.error) {
			this.cancellationState = createCancellationState();
		}

		const normalizedTree = normalizeTree(tree);
		this.artifacts = new OutputStore();
		this.artifacts.declareAll(collectArtifactDeclarations(normalizedTree));
		this.feedback.length = 0;
		this.events.length = 0;
		this.state.clear();
		this.agents.clear();
		await this.persistOutputs();

		try {
			this.throwIfCancelled();
			await this.executeNode(normalizedTree, ROOT_CONSTRAINT_SCOPE);
			this.throwIfCancelled();
		} catch (error) {
			this.artifacts.closePending(error);
			await this.persistOutputs(isPiperCancellationError(error) ? this.createSummary() : undefined);
			throw error;
		}

		this.artifacts.closePending();

		const summary = this.createSummary();

		await this.persistOutputs(summary);
		this.hooks.summary(summary);
		return summary;
	}

	async cancel(
		reason: string | PiperCancellationError = "Piper execution cancelled.",
		signal?: NodeJS.Signals,
	): Promise<void> {
		const error =
			reason instanceof PiperCancellationError
				? reason
				: new PiperCancellationError(reason, signal);

		if (!this.cancellationState.error) {
			this.cancellationState.error = error;
			this.cancellationState.resolve(error);
		}

		this.artifacts.closePending(error);

		const cancelErrors: unknown[] = [];
		for (const [handle, activeTask] of this.activeTasks) {
			try {
				activeTask.harness.cancel(handle);
			} catch (cancelError) {
				cancelErrors.push(cancelError);
			}
		}

		await this.persistOutputs(this.createSummary());

		if (cancelErrors.length > 0) {
			throw new AggregateError(cancelErrors, "Failed to cancel one or more active steps.");
		}
	}

	private createSummary(): ExecutionSummary {
		return {
			completedSteps: this.completedSteps,
			failedSteps: this.failedSteps,
			completedTasks: this.completedSteps,
			failedTasks: this.failedSteps,
			artifacts: this.artifacts.snapshot(),
			feedback: [...this.feedback],
			events: [...this.events],
			runId: this.outputPersistence?.runId ?? null,
			artifactPath: this.outputPersistence?.artifactPath ?? null,
		};
	}

	private async persistOutputs(summary?: ExecutionSummary): Promise<void> {
		await this.outputPersistence?.write({
			artifacts: this.artifacts.snapshotResults(),
			feedback: this.feedback,
			events: this.events,
			summary: summary
				? {
						completedSteps: summary.completedSteps,
						failedSteps: summary.failedSteps,
						completedTasks: summary.completedTasks,
						failedTasks: summary.failedTasks,
						runId: summary.runId,
						artifactPath: summary.artifactPath,
					}
				: undefined,
		});
	}

	private recordEvent(event: Omit<ExecutionSummary["events"][number], "timestamp">): void {
		const entry = { ...event, timestamp: Date.now() };
		this.events.push(entry);
		this.hooks.event(entry);
	}

	private addFeedback(params: Omit<FeedbackRecord, "id" | "timestamp">): FeedbackRecord {
		const record: FeedbackRecord = {
			id: `feedback-${this.feedback.length + 1}`,
			timestamp: Date.now(),
			...params,
		};
		this.feedback.push(record);
		this.recordEvent({
			type: "feedback",
			message: record.message,
			nodeId: record.source,
			metadata: { severity: record.severity, scope: record.scope, iteration: record.iteration },
		});
		return record;
	}

	private createRuntimeValueContext(): RuntimeValueContext {
		return {
			workspacePath: this.workspacePath,
			readArtifact: (name) => this.artifacts.waitForOutput(name),
			readTaskResult: (name) => this.artifacts.waitForResult(name),
			readState: <T = unknown>(name: string) => this.state.get(name) as T | undefined,
			readFeedback: (scope) =>
				scope ? this.feedback.filter((record) => record.scope === scope) : [...this.feedback],
		};
	}

	private async resolveContext(values: ContextValue[] = []): Promise<string[]> {
		const context = this.createRuntimeValueContext();
		const resolved = await this.cancelable(
			Promise.all(
				values.map(async (value) => {
					if (typeof value === "string") {
						return value;
					}

					if (isArtifact(value)) {
						return value.value().resolve(context);
					}

					if (isRuntimeValue(value)) {
						return value.resolve(context);
					}

					throw new Error("Encountered an invalid context value.");
				}),
			),
		);

		if (this.feedback.length === 0) {
			return resolved;
		}

		return [
			...resolved,
			[
				"Structured feedback from prior loop iterations:",
				...this.feedback.map(
					(record) =>
						`- [${record.severity}] ${record.scope ? `${record.scope}: ` : ""}${record.message}`,
				),
			].join("\n"),
		];
	}

	private async evaluateValue(value: EvaluationValue): Promise<EvaluationResult> {
		if (typeof value === "string") {
			const result = await runCommand(value, {
				cwd: this.workspacePath,
			});

			return {
				passed: result.exitCode === 0,
				feedback:
					result.exitCode === 0
						? undefined
						: [`Evaluation command failed: ${value}`, result.stdout, result.stderr]
								.filter(Boolean)
								.join("\n"),
			};
		}

		if (isRuntimeValue(value)) {
			const passed = await value.resolve(this.createRuntimeValueContext());
			return {
				passed: passed === true,
				feedback: passed === true ? undefined : `Runtime evaluation failed: ${value.description}`,
			};
		}

		const result = await value(this.createRuntimeValueContext());
		if (typeof result === "boolean") {
			return { passed: result, feedback: result ? undefined : "Evaluator returned false." };
		}
		return result;
	}

	private async runEvaluations(
		values: EvaluationValue[] | undefined,
		source: string,
		scope?: string,
	): Promise<string[]> {
		const failures: string[] = [];

		for (const value of values ?? []) {
			const result = await this.evaluateValue(value);
			if (!result.passed) {
				const message = result.feedback ?? "Evaluation failed.";
				failures.push(message);
				this.addFeedback({
					source,
					scope,
					message,
					severity: "error",
				});
			}
		}

		return failures;
	}

	private async observeAttempt(handle: TaskHandle, info: StepAttemptInfo): Promise<TaskResult> {
		const progressTask = (async () => {
			for await (const update of handle.progress) {
				this.hooks.stepProgress(info, update);
			}
		})();

		const outcome = await Promise.race([
			handle.completed.then((result) => ({ kind: "completed" as const, result })),
			handle.errored.then((error) => ({ kind: "errored" as const, error })),
			this.cancellationState.promise.then((error) => ({ kind: "cancelled" as const, error })),
		]);

		if (outcome.kind === "cancelled") {
			throw outcome.error;
		}

		await progressTask;

		if (outcome.kind === "errored") {
			throw outcome.error;
		}

		return outcome.result;
	}

	private registerActiveTask(handle: TaskHandle, harness: HarnessAdapter): () => void {
		this.activeTasks.set(handle, { harness });
		return () => {
			this.activeTasks.delete(handle);
		};
	}

	private async executeStep(
		node: Extract<ConcreteLoopNode, { kind: "step" }>,
		scope: ConstraintScope,
	): Promise<void> {
		const roleName = typeof node.props.role === "string" ? node.props.role : node.props.role?.name;
		const inlineAgent = typeof node.props.role === "object" ? node.props.role : undefined;
		const registeredAgent = roleName ? this.agents.get(roleName) : undefined;
		const harnessName = node.props.harness ?? inlineAgent?.harness ?? registeredAgent?.harness;
		if (!harnessName) {
			throw new Error(
				`Step "${node.props.goal}" must specify a harness or use an agent with a harness.`,
			);
		}

		const harness = this.harnesses.get(harnessName);
		if (!harness) {
			throw new Error(`No harness registered for "${harnessName}".`);
		}

		this.throwIfCancelled();

		const stepId = node.props.id ?? `step-${++this.stepIndex}`;
		const agentConstraints = [
			...(inlineAgent?.constraints ?? []),
			...(registeredAgent?.constraints ?? []),
		];
		const childScope = extendConstraintScope(scope, [
			...agentConstraints,
			...(node.props.constraints ?? []),
		]);
		const maxAttempts = this.retryLimit + 1;
		let taskHandle: TaskHandle | undefined;
		let failures: string[] = [];

		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			this.throwIfCancelled();

			const model = node.props.model ?? inlineAgent?.model ?? registeredAgent?.model;
			const info: StepAttemptInfo = {
				id: stepId,
				goal: node.props.goal,
				role: roleName,
				harness: harnessName,
				model,
				attempt,
			};

			const snapshot = await captureGitSnapshot(this.workspacePath);
			this.recordEvent({
				type: "step:start",
				message: node.props.goal,
				nodeId: stepId,
				metadata: { attempt, role: roleName, harness: harnessName },
			});
			this.hooks.stepStarted(info);

			const resolvedContext = await this.resolveContext([
				...(inlineAgent?.instructions ? [`Role instructions:\n${inlineAgent.instructions}`] : []),
				...(registeredAgent?.instructions
					? [`Role instructions:\n${registeredAgent.instructions}`]
					: []),
				...(node.props.instructions ? [`Step instructions:\n${node.props.instructions}`] : []),
				...(node.props.acceptanceCriteria?.length
					? [
							`Acceptance criteria:\n${node.props.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
						]
					: []),
				...(node.props.context ?? []),
			]);

			if (attempt === 1) {
				taskHandle = harness.startTask({
					goal: node.props.goal,
					model,
					context: resolvedContext,
					constraints: childScope.constraints,
					protectedFiles: childScope.protectedFiles,
					workspacePath: this.workspacePath,
				});
			} else {
				harness.retry(taskHandle as TaskHandle, failures);
			}

			let result: TaskResult;
			let unregisterActiveTask: (() => void) | undefined;
			try {
				unregisterActiveTask = this.registerActiveTask(taskHandle as TaskHandle, harness);
				result = await this.observeAttempt(taskHandle as TaskHandle, info);
			} catch (rawError) {
				if (isPiperCancellationError(rawError)) {
					throw rawError;
				}

				const error = toTaskError(rawError);
				const constraintFailures = await enforceProtectedFiles({
					workspacePath: this.workspacePath,
					snapshot,
					protectedFiles: childScope.protectedFiles,
				});

				const combinedFailures = [...constraintFailures, error.logs ?? error.message];

				if (error.retryable && attempt < maxAttempts) {
					failures = combinedFailures;
					this.hooks.stepRetry(info, combinedFailures);
					this.recordEvent({
						type: "step:retry",
						message: combinedFailures.join("\n\n"),
						nodeId: stepId,
						metadata: { attempt },
					});
					continue;
				}

				if (node.props.produces ?? node.props.artifact) {
					this.artifacts.fail(getArtifactName((node.props.produces ?? node.props.artifact)!));
				}

				this.failedSteps += 1;
				this.hooks.stepFailed(info, error);
				node.props.onError?.(error);
				node.props["on:error"]?.(error);
				this.recordEvent({
					type: "step:fail",
					message: error.message,
					nodeId: stepId,
					metadata: { attempt },
				});
				throw error;
			} finally {
				unregisterActiveTask?.();
			}

			this.throwIfCancelled();

			const constraintFailures = await enforceProtectedFiles({
				workspacePath: this.workspacePath,
				snapshot,
				protectedFiles: childScope.protectedFiles,
			});
			const validationFailures = await this.runEvaluations(node.props.validate, stepId, roleName);
			const allFailures = [...constraintFailures, ...validationFailures];

			if (allFailures.length > 0) {
				if (attempt < maxAttempts) {
					failures = allFailures;
					this.hooks.stepRetry(info, allFailures);
					this.recordEvent({
						type: "step:retry",
						message: allFailures.join("\n\n"),
						nodeId: stepId,
						metadata: { attempt },
					});
					continue;
				}

				const error: TaskError = {
					message: `Step failed after ${attemptLabel(attempt)}.`,
					logs: allFailures.join("\n\n"),
					modifiedFiles: result.modifiedFiles,
					retryable: false,
				};

				if (node.props.produces ?? node.props.artifact) {
					this.artifacts.fail(getArtifactName((node.props.produces ?? node.props.artifact)!));
				}

				this.failedSteps += 1;
				this.hooks.stepFailed(info, error);
				node.props.onError?.(error);
				node.props["on:error"]?.(error);
				this.recordEvent({
					type: "step:fail",
					message: error.message,
					nodeId: stepId,
					metadata: { attempt },
				});
				throw error;
			}

			if (node.props.produces ?? node.props.artifact) {
				this.artifacts.set(getArtifactName((node.props.produces ?? node.props.artifact)!), result);
				await this.persistOutputs();
			}

			this.completedSteps += 1;
			this.hooks.stepCompleted(info, result);
			node.props.onComplete?.(result);
			node.props["on:complete"]?.(result);
			this.recordEvent({
				type: "step:complete",
				message: node.props.goal,
				nodeId: stepId,
				metadata: { attempt, modifiedFiles: result.modifiedFiles },
			});
			return;
		}

		throw new Error(`Step "${node.props.goal}" exited its retry loop unexpectedly.`);
	}

	private async executeEvaluate(
		node: Extract<ConcreteLoopNode, { kind: "evaluate" }>,
	): Promise<void> {
		this.recordEvent({
			type: "evaluate:start",
			message: node.props.name,
			nodeId: node.props.id,
		});
		const result = await this.evaluateValue(node.props.using);

		if (result.passed) {
			this.recordEvent({
				type: "evaluate:pass",
				message: node.props.name,
				nodeId: node.props.id,
				metadata: result.metadata,
			});
			return;
		}

		const message =
			node.props.feedback ?? result.feedback ?? `Evaluation failed: ${node.props.name}`;
		this.addFeedback({
			source: node.props.id ?? node.props.name,
			scope: node.props.scope,
			message,
			severity: "error",
		});
		this.recordEvent({
			type: "evaluate:fail",
			message,
			nodeId: node.props.id,
			metadata: result.metadata,
		});
		throw new EvaluationFailure([message]);
	}

	private async executeRepeat(
		node: Extract<ConcreteLoopNode, { kind: "repeat" }>,
		scope: ConstraintScope,
	): Promise<void> {
		const maxAttempts = node.props.maxAttempts ?? (node.props.maxRetries ?? 2) + 1;
		this.recordEvent({
			type: "repeat:start",
			message: `Repeat ${node.props.id ?? "loop"}`,
			nodeId: node.props.id,
			metadata: { maxAttempts },
		});

		let latestFailures: string[] = [];
		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			this.recordEvent({
				type: "repeat:iteration",
				message: `Iteration ${attempt}`,
				nodeId: node.props.id,
				metadata: { attempt },
			});

			try {
				await this.executeSequence(node.props.children, scope);
				const failures = await this.runEvaluations(node.props.until, node.props.id ?? "repeat");
				if (failures.length === 0) {
					this.recordEvent({
						type: "repeat:complete",
						message: `Repeat completed after ${attempt} iteration(s).`,
						nodeId: node.props.id,
						metadata: { attempt },
					});
					return;
				}
				latestFailures = failures;
			} catch (error) {
				if (isPiperCancellationError(error)) {
					throw error;
				}

				latestFailures =
					error instanceof EvaluationFailure ? error.feedback : [toTaskError(error).message];

				if (node.props.onFailure && attempt < maxAttempts) {
					let retryRequested = false;
					const retry = () => {
						retryRequested = true;
					};
					await this.executeNode(
						normalizeTree(node.props.onFailure(toTaskError(error), retry)),
						scope,
					);
					if (retryRequested) {
						continue;
					}
				}
			}

			if (attempt < maxAttempts) {
				for (const failure of latestFailures) {
					this.addFeedback({
						source: node.props.id ?? "repeat",
						message: failure,
						severity: "warning",
						iteration: attempt,
					});
				}
				continue;
			}
		}

		throw {
			message: `Repeat loop exhausted ${attemptLabel(maxAttempts)}.`,
			logs: latestFailures.join("\n\n"),
			retryable: false,
		} satisfies TaskError;
	}

	private async executeParallel(
		node: Extract<ConcreteLoopNode, { kind: "parallel" }>,
		scope: ConstraintScope,
	): Promise<void> {
		const message = node.props.status ?? DEFAULT_PARALLEL_STATUS;
		this.hooks.info(message);
		this.recordEvent({
			type: "parallel:start",
			message,
			nodeId: node.props.id,
		});

		await Promise.all(node.props.children.map((child) => this.executeNode(child, scope)));

		this.recordEvent({
			type: "parallel:complete",
			message,
			nodeId: node.props.id,
		});
	}

	private async executeCompare(
		node: Extract<ConcreteLoopNode, { kind: "compare" }>,
		scope: ConstraintScope,
	): Promise<void> {
		const before = this.artifacts.snapshot();
		await Promise.all(node.props.branches.map((branch) => this.executeNode(branch.node, scope)));
		const after = this.artifacts.snapshot();
		const branchSummary = node.props.branches.map((branch) => `- ${branch.name}`).join("\n");
		const result = node.props.evaluator?.(this.createRuntimeValueContext());
		const evaluation = result ? await result : true;
		const passed = typeof evaluation === "boolean" ? evaluation : evaluation.passed;

		if (!passed) {
			throw new EvaluationFailure([
				typeof evaluation === "boolean"
					? "Compare evaluator rejected all branches."
					: (evaluation.feedback ?? "Compare evaluator rejected all branches."),
			]);
		}

		if (node.props.produces) {
			this.artifacts.set(getArtifactName(node.props.produces), {
				output: `Compared branches:\n${branchSummary}`,
				modifiedFiles: [],
				metadata: { before, after },
			});
			await this.persistOutputs();
		}

		this.recordEvent({
			type: "compare:complete",
			message: `Compared ${node.props.branches.length} branch(es).`,
			nodeId: node.props.id,
		});
	}

	private async executeGate(node: Extract<ConcreteLoopNode, { kind: "gate" }>): Promise<void> {
		const approved =
			typeof node.props.approve === "function"
				? await this.evaluateValue(node.props.approve)
				: { passed: node.props.approve ?? true };

		if (approved.passed) {
			this.recordEvent({
				type: "gate:approved",
				message: node.props.message ?? node.props.name,
				nodeId: node.props.id,
			});
			return;
		}

		const message = approved.feedback ?? `Gate rejected: ${node.props.name}`;
		this.recordEvent({
			type: "gate:rejected",
			message,
			nodeId: node.props.id,
		});
		throw new EvaluationFailure([message]);
	}

	private async executePolicy(
		node: Extract<ConcreteLoopNode, { kind: "policy" }>,
		scope: ConstraintScope,
	): Promise<void> {
		const childScope = extendConstraintScope(scope, [
			...(node.props.constraints ?? []),
			...(node.props.protectedFiles ?? []).map((filePath) => protectedFileConstraint(filePath)),
		]);

		this.recordEvent({
			type: "policy:enter",
			message: node.props.name ?? "Policy scope",
			nodeId: node.props.id,
			metadata: {
				constraints: childScope.constraints,
				protectedFiles: childScope.protectedFiles,
			},
		});

		await this.executeSequence(node.props.children, childScope);
		const failures = await this.runEvaluations(node.props.validate, node.props.id ?? "policy");
		if (failures.length > 0) {
			throw new EvaluationFailure(failures);
		}

		this.recordEvent({
			type: "policy:exit",
			message: node.props.name ?? "Policy scope",
			nodeId: node.props.id,
		});
	}

	private async executeSequence(
		children: ConcreteLoopNode[],
		scope: ConstraintScope,
	): Promise<void> {
		for (const child of children) {
			this.throwIfCancelled();
			await this.executeNode(child, scope);
		}
	}

	private async executeNode(node: ConcreteLoopNode, scope: ConstraintScope): Promise<void> {
		this.throwIfCancelled();

		switch (node.kind) {
			case "loop":
				for (const [name, value] of Object.entries(node.props.state ?? {})) {
					this.state.set(name, value);
				}
				for (const agent of node.props.agents ?? []) {
					this.agents.set(agent.name, agent);
				}
				this.recordEvent({
					type: "loop:start",
					message: node.props.objective,
					nodeId: node.props.id,
				});
				await this.executeSequence(node.props.children, scope);
				await this.runEvaluations(node.props.stopWhen, node.props.id ?? "loop");
				this.recordEvent({
					type: "loop:complete",
					message: node.props.objective,
					nodeId: node.props.id,
				});
				return;
			case "step":
				await this.executeStep(node, scope);
				return;
			case "evaluate":
				await this.executeEvaluate(node);
				return;
			case "repeat":
				await this.executeRepeat(node, scope);
				return;
			case "parallel":
				await this.executeParallel(node, scope);
				return;
			case "compare":
				await this.executeCompare(node, scope);
				return;
			case "gate":
				await this.executeGate(node);
				return;
			case "policy":
				await this.executePolicy(node, scope);
				return;
			case "state":
				this.state.set(node.props.name, node.props.value);
				return;
			case "feedback":
				this.addFeedback({
					source: node.props.source ?? node.props.id ?? "feedback",
					scope: node.props.scope,
					message: node.props.message,
					severity: node.props.severity ?? "info",
				});
				return;
		}
	}

	private throwIfCancelled(): void {
		if (this.cancellationState.error) {
			throw this.cancellationState.error;
		}
	}

	private async cancelable<T>(promise: Promise<T>): Promise<T> {
		const outcome = await Promise.race([
			promise.then((value) => ({ kind: "resolved" as const, value })),
			this.cancellationState.promise.then((error) => ({ kind: "cancelled" as const, error })),
		]);

		if (outcome.kind === "cancelled") {
			throw outcome.error;
		}

		return outcome.value;
	}
}
