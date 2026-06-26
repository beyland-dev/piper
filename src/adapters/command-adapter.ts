import type {
	HarnessAdapter,
	ProgressUpdate,
	StepError,
	StepHandle,
	StepResult,
} from "../core/types.js";
import { listModifiedFiles } from "../runtime/constraint-checker.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { createDeferred } from "../utils/deferred.js";
import { spawnStreamingCommand } from "../utils/process.js";
import { fillTemplate, shellEscape } from "../utils/shell.js";
import { ManagedStepHandle } from "./step-handle.js";

export interface CommandHarnessOptions {
	command?: string;
	commandTemplate?: string;
	env?: Record<string, string>;
}

interface CommandHarnessConfig {
	name: string;
	defaultCommand: string;
	defaultArguments?: string[];
	envPrefix: string;
}

interface CommandStepState {
	goal: string;
	model?: string;
	context: string[];
	constraints: string[];
	protectedFiles: string[];
	workspacePath: string;
	attempt: number;
}

export function defaultPrompt(goal: string, context: string[], failures: string[]): string {
	const sections = [`Goal:\n${goal}`];

	if (context.length > 0) {
		sections.push(`Context:\n${context.join("\n\n")}`);
	}

	if (failures.length > 0) {
		sections.push(`Retry feedback:\n${failures.join("\n\n")}`);
	}

	return sections.join("\n\n");
}

export class CommandHarness implements HarnessAdapter {
	readonly name: string;

	private readonly config: CommandHarnessConfig;
	private readonly options: CommandHarnessOptions;
	private readonly state = new WeakMap<ManagedStepHandle, CommandStepState>();

	constructor(config: CommandHarnessConfig, options: CommandHarnessOptions = {}) {
		this.config = config;
		this.name = config.name;
		this.options = options;
	}

	startStep(params: {
		goal: string;
		model?: string;
		context: string[];
		constraints?: string[];
		protectedFiles?: string[];
		workspacePath: string;
	}): StepHandle {
		const handle = new ManagedStepHandle();
		this.state.set(handle, {
			...params,
			constraints: params.constraints ?? [],
			protectedFiles: params.protectedFiles ?? [],
			attempt: 0,
		});
		this.runAttempt(handle, []);
		return handle;
	}

	retry(stepHandle: StepHandle, failures: string[]): void {
		this.runAttempt(stepHandle as ManagedStepHandle, failures);
	}

	cancel(stepHandle: StepHandle): void {
		(stepHandle as ManagedStepHandle).cancel();
	}

	private buildCommand(state: CommandStepState, attempt: number, failures: string[]): string {
		const { goal, model = "", context, workspacePath } = state;
		const prompt = defaultPrompt(goal, context, failures);
		if (this.options.commandTemplate) {
			return fillTemplate(this.options.commandTemplate, {
				goal,
				model,
				context: context.join("\n"),
				constraints: state.constraints.join("\n"),
				protectedFiles: state.protectedFiles.join("\n"),
				workspacePath,
				prompt,
				retryReason: failures.join("\n"),
				attempt: String(attempt),
			});
		}

		const executable = this.options.command ?? this.config.defaultCommand;
		const argumentsList = [...(this.config.defaultArguments ?? []), prompt];
		return [executable, ...argumentsList].map(shellEscape).join(" ");
	}

	private buildEnvironment(
		state: CommandStepState,
		attempt: number,
		failures: string[],
	): Record<string, string> {
		const context = state.context.join("\n");
		const prompt = defaultPrompt(state.goal, state.context, failures);
		const retryReason = failures.join("\n");
		const model = state.model ?? "";
		const constraints = state.constraints.join("\n");
		const protectedFiles = state.protectedFiles.join("\n");

		return {
			...this.options.env,
			[`${this.config.envPrefix}_GOAL`]: state.goal,
			[`${this.config.envPrefix}_MODEL`]: model,
			[`${this.config.envPrefix}_CONTEXT`]: context,
			[`${this.config.envPrefix}_CONSTRAINTS`]: constraints,
			[`${this.config.envPrefix}_PROTECTED_FILES`]: protectedFiles,
			[`${this.config.envPrefix}_PROMPT`]: prompt,
			[`${this.config.envPrefix}_RETRY_REASON`]: retryReason,
			AGENT_GOAL: state.goal,
			AGENT_MODEL: model,
			AGENT_CONTEXT: context,
			AGENT_CONSTRAINTS: constraints,
			AGENT_PROTECTED_FILES: protectedFiles,
			AGENT_RETRY_REASON: retryReason,
			AGENT_WORKSPACE: state.workspacePath,
			AGENT_ATTEMPT: String(attempt),
		};
	}

	private runAttempt(handle: ManagedStepHandle, failures: string[]): void {
		const state = this.state.get(handle);
		if (!state) {
			throw new Error(`Unknown ${this.config.name} step handle`);
		}

		state.attempt += 1;
		const attempt = state.attempt;
		const progress = new AsyncQueue<ProgressUpdate>();
		const completed = createDeferred<StepResult>();
		const errored = createDeferred<StepError>();
		let canceled = false;
		let run: ReturnType<typeof spawnStreamingCommand> | undefined;

		const cancelAttempt = () => {
			canceled = true;
			run?.cancel();
		};

		handle.setAttempt({
			progress,
			completed: completed.promise,
			errored: errored.promise,
			cancel: cancelAttempt,
		});

		void (async () => {
			try {
				const baseline = new Set(await listModifiedFiles(state.workspacePath));
				if (canceled) {
					progress.close();
					errored.resolve({
						message: `${this.config.name} step canceled`,
						retryable: false,
					});
					return;
				}

				const command = this.buildCommand(state, attempt, failures);
				run = spawnStreamingCommand(command, {
					cwd: state.workspacePath,
					env: this.buildEnvironment(state, attempt, failures),
				});

				handle.setAttempt({
					progress,
					completed: completed.promise,
					errored: errored.promise,
					cancel: cancelAttempt,
				});

				for await (const update of run.progress) {
					progress.push({
						...update,
						attempt,
						timestamp: Date.now(),
					});
				}

				const result = await run.completed;
				const currentFiles = await listModifiedFiles(state.workspacePath);
				const modifiedFiles = currentFiles.filter((file) => !baseline.has(file));
				progress.close();

				if (canceled) {
					errored.resolve({
						message: `${this.config.name} step canceled`,
						logs: [result.stdout, result.stderr].filter(Boolean).join("\n"),
						modifiedFiles,
						retryable: false,
					});
					return;
				}

				if (result.exitCode === 0) {
					completed.resolve({
						output: result.stdout || `${this.config.name} completed: ${state.goal}`,
						modifiedFiles,
						metadata: {
							exitCode: result.exitCode,
							signal: result.signal,
						},
					});
					return;
				}

				errored.resolve({
					message: `${this.config.name} exited with code ${result.exitCode ?? "unknown"}`,
					logs: [result.stdout, result.stderr].filter(Boolean).join("\n"),
					modifiedFiles,
					retryable: true,
				});
			} catch (error) {
				progress.close();
				errored.resolve({
					message:
						error instanceof Error ? error.message : `${this.config.name} step failed unexpectedly`,
					logs: error instanceof Error ? error.stack : String(error),
					retryable: false,
				});
			}
		})();
	}
}
