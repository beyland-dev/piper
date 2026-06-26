import { randomUUID } from "node:crypto";
import {
	AhpClient,
	type AhpActionEnvelope,
	type AhpAuthenticationToken,
	type ProtectedResourceMetadata,
	buildDefaultChatUri,
	fileUri,
	githubCliTokenProvider,
} from "../ahp/client.js";
import type {
	HarnessAdapter,
	ProgressUpdate,
	TaskError,
	TaskHandle,
	TaskResult,
} from "../core/types.js";
import { listModifiedFiles } from "../runtime/constraint-checker.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { createDeferred } from "../utils/deferred.js";
import { defaultPrompt } from "./command-adapter.js";
import { ManagedTaskHandle } from "./task-handle.js";

const DEFAULT_COPILOT_AHP_PROVIDER = "copilotcli";

export interface CopilotAhpHarnessOptions {
	name?: string;
	address?: string;
	codeCommand?: string;
	autoStartAgentHost?: boolean;
	provider?: string;
	tokenProvider?: (
		resources: ProtectedResourceMetadata[],
	) => Promise<readonly AhpAuthenticationToken[]>;
	connect?: (options: {
		address?: string;
		codeCommand?: string;
		autoStartAgentHost?: boolean;
		tokenProvider: (
			resources: ProtectedResourceMetadata[],
		) => Promise<readonly AhpAuthenticationToken[]>;
	}) => Promise<AhpClient>;
}

interface CopilotAhpTaskState {
	goal: string;
	model?: string;
	context: string[];
	workspacePath: string;
	attempt: number;
}

export class CopilotAhpHarness implements HarnessAdapter {
	readonly name: string;

	private readonly options: Required<Pick<CopilotAhpHarnessOptions, "provider" | "tokenProvider">> &
		Omit<CopilotAhpHarnessOptions, "name" | "provider" | "tokenProvider">;
	private readonly state = new WeakMap<ManagedTaskHandle, CopilotAhpTaskState>();

	constructor(options: CopilotAhpHarnessOptions = {}) {
		const {
			name = "copilot",
			provider = DEFAULT_COPILOT_AHP_PROVIDER,
			tokenProvider = githubCliTokenProvider,
			...rest
		} = options;
		this.name = name;
		this.options = { provider, tokenProvider, ...rest };
	}

	startTask(params: {
		goal: string;
		model?: string;
		context: string[];
		workspacePath: string;
	}): TaskHandle {
		const handle = new ManagedTaskHandle();
		this.state.set(handle, {
			...params,
			attempt: 0,
		});
		this.runAttempt(handle, []);
		return handle;
	}

	retry(taskHandle: TaskHandle, failures: string[]): void {
		this.runAttempt(taskHandle as ManagedTaskHandle, failures);
	}

	cancel(taskHandle: TaskHandle): void {
		(taskHandle as ManagedTaskHandle).cancel();
	}

	private runAttempt(handle: ManagedTaskHandle, failures: string[]): void {
		const state = this.state.get(handle);
		if (!state) {
			throw new Error("Unknown Copilot AHP task handle");
		}

		state.attempt += 1;
		const attempt = state.attempt;
		const progress = new AsyncQueue<ProgressUpdate>();
		const completed = createDeferred<TaskResult>();
		const errored = createDeferred<TaskError>();
		let canceled = false;
		let client: AhpClient | undefined;
		let turnChannel: string | undefined;
		let turnId: string | undefined;

		const cancelAttempt = () => {
			canceled = true;
			if (client && turnChannel && turnId) {
				try {
					client.dispatchAction(turnChannel, {
						type: "chat/turnCancelled",
						turnId,
					});
				} finally {
					client.close();
				}
				return;
			}
			client?.close();
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
					errored.resolve({ message: "copilot AHP task canceled", retryable: false });
					return;
				}

				client = await this.connect();
				const sessionUri = `${this.options.provider}:/${randomUUID()}`;
				turnChannel = buildDefaultChatUri(sessionUri);
				turnId = randomUUID();

				await this.createSession(client, {
					sessionUri,
					workspacePath: state.workspacePath,
					model: state.model,
				});

				await client.request("createChat", {
					channel: sessionUri,
					chat: turnChannel,
				});
				await client.request("subscribe", { channel: sessionUri });
				await client.request("subscribe", { channel: turnChannel });

				const prompt = defaultPrompt(state.goal, state.context, failures);
				const output = await this.runTurn({
					client,
					progress,
					attempt,
					turnChannel,
					turnId,
					prompt,
					isCanceled: () => canceled,
				});

				const currentFiles = await listModifiedFiles(state.workspacePath);
				const modifiedFiles = currentFiles.filter((file) => !baseline.has(file));
				progress.close();

				if (canceled) {
					errored.resolve({
						message: "copilot AHP task canceled",
						logs: output,
						modifiedFiles,
						retryable: false,
					});
					return;
				}

				completed.resolve({
					output: output || `copilot AHP completed: ${state.goal}`,
					modifiedFiles,
					metadata: {
						sessionUri,
						chatUri: turnChannel,
						turnId,
						provider: this.options.provider,
					},
				});
			} catch (error) {
				progress.close();
				errored.resolve({
					message: error instanceof Error ? error.message : "copilot AHP task failed unexpectedly",
					logs: error instanceof Error ? error.stack : String(error),
					retryable: !canceled,
				});
			} finally {
				client?.close();
			}
		})();
	}

	private async connect(): Promise<AhpClient> {
		const connect = this.options.connect ?? AhpClient.connect;
		return connect({
			address: this.options.address,
			codeCommand: this.options.codeCommand,
			autoStartAgentHost: this.options.autoStartAgentHost,
			tokenProvider: this.options.tokenProvider,
		});
	}

	private async createSession(
		client: AhpClient,
		params: {
			sessionUri: string;
			workspacePath: string;
			model?: string;
		},
	): Promise<void> {
		await client.requestWithAuth(
			"createSession",
			{
				channel: params.sessionUri,
				provider: this.options.provider,
				workingDirectory: fileUri(params.workspacePath),
				...(params.model ? { model: { id: params.model } } : {}),
			},
			this.options.tokenProvider,
		);
	}

	private async runTurn(params: {
		client: AhpClient;
		progress: AsyncQueue<ProgressUpdate>;
		attempt: number;
		turnChannel: string;
		turnId: string;
		prompt: string;
		isCanceled: () => boolean;
	}): Promise<string> {
		let output = "";
		const seenToolCalls = new Set<string>();

		params.client.dispatchAction(params.turnChannel, {
			type: "chat/turnStarted",
			turnId: params.turnId,
			message: {
				text: params.prompt,
				origin: { kind: "user" },
			},
		});

		for await (const notification of params.client.notifications) {
			if (params.isCanceled()) {
				return output;
			}

			if (notification.method !== "action") {
				continue;
			}

			const envelope = notification.params as AhpActionEnvelope;
			if (envelope.channel !== params.turnChannel) {
				continue;
			}

			const action = envelope.action;
			if (action.turnId !== params.turnId) {
				continue;
			}

			switch (action.type) {
				case "chat/responsePart": {
					const content = readResponsePartContent(action.part);
					if (content) {
						output += content;
						this.pushProgress(params.progress, params.attempt, content, "stdout");
					}
					break;
				}
				case "chat/delta": {
					const content = typeof action.content === "string" ? action.content : "";
					if (content) {
						output += content;
						this.pushProgress(params.progress, params.attempt, content, "stdout");
					}
					break;
				}
				case "chat/reasoning": {
					const content = typeof action.content === "string" ? action.content : "";
					if (content) {
						this.pushProgress(params.progress, params.attempt, content, "system");
					}
					break;
				}
				case "chat/toolCallStart":
				case "chat/toolCallReady": {
					const toolCallId = typeof action.toolCallId === "string" ? action.toolCallId : undefined;
					if (toolCallId && seenToolCalls.has(`${action.type}:${toolCallId}`)) {
						break;
					}
					if (toolCallId) {
						seenToolCalls.add(`${action.type}:${toolCallId}`);
					}
					const message = formatToolProgress(action);
					if (message) {
						this.pushProgress(params.progress, params.attempt, message, "system");
					}
					break;
				}
				case "chat/error": {
					const message = readErrorMessage(action.error);
					throw new Error(message);
				}
				case "chat/turnCancelled":
					throw new Error("copilot AHP turn was cancelled");
				case "chat/turnComplete":
					return output;
			}
		}

		throw new Error("AHP connection closed before the Copilot turn completed.");
	}

	private pushProgress(
		progress: AsyncQueue<ProgressUpdate>,
		attempt: number,
		message: string,
		stream: "stdout" | "stderr" | "system",
	): void {
		const trimmed = message.trim();
		if (!trimmed) {
			return;
		}
		progress.push({
			message: trimmed,
			attempt,
			stream,
			timestamp: Date.now(),
		});
	}
}

function readResponsePartContent(part: unknown): string {
	if (!part || typeof part !== "object") {
		return "";
	}
	const responsePart = part as { kind?: unknown; content?: unknown };
	if (responsePart.kind === "markdown" || responsePart.kind === "reasoning") {
		return typeof responsePart.content === "string" ? responsePart.content : "";
	}
	return "";
}

function readErrorMessage(error: unknown): string {
	if (!error || typeof error !== "object") {
		return "copilot AHP turn failed";
	}
	const value = error as { message?: unknown; code?: unknown };
	if (typeof value.message === "string") {
		return value.message;
	}
	if (typeof value.code === "string") {
		return value.code;
	}
	return "copilot AHP turn failed";
}

function formatToolProgress(action: { [key: string]: unknown }): string | undefined {
	if (typeof action.displayName === "string") {
		return `Tool: ${action.displayName}`;
	}
	if (typeof action.invocationMessage === "string") {
		return action.invocationMessage;
	}
	if (
		action.invocationMessage &&
		typeof action.invocationMessage === "object" &&
		typeof (action.invocationMessage as { value?: unknown }).value === "string"
	) {
		return (action.invocationMessage as { value: string }).value;
	}
	if (typeof action.toolName === "string") {
		return `Tool: ${action.toolName}`;
	}
	return undefined;
}
