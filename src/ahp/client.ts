import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { AsyncQueue } from "../utils/async-queue.js";

export const AHP_ROOT_CHANNEL = "ahp-root://";
export const AHP_PROTOCOL_VERSION = "0.5.0";
export const AHP_AUTH_REQUIRED = -32007;

export interface AhpJsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export class AhpRpcError extends Error {
	readonly code: number;
	readonly data?: unknown;

	constructor(error: AhpJsonRpcError) {
		super(error.message);
		this.name = "AhpRpcError";
		this.code = error.code;
		this.data = error.data;
	}
}

export interface AhpActionEnvelope {
	channel: string;
	action: AhpAction;
	serverSeq?: number;
	origin?: {
		clientId: string;
		clientSeq: number;
	};
}

export interface AhpNotification {
	method: string;
	params?: unknown;
}

export interface AhpAction {
	type: string;
	[key: string]: unknown;
}

export interface ProtectedResourceMetadata {
	resource: string;
	authorization_servers?: string[];
	scopes_supported?: string[];
}

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: unknown;
}

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

type WebSocketLike = {
	readonly readyState: number;
	send(data: string): void;
	close(): void;
	addEventListener(
		type: "open" | "message" | "error" | "close",
		listener: (event: unknown) => void,
	): void;
	removeEventListener(
		type: "open" | "message" | "error" | "close",
		listener: (event: unknown) => void,
	): void;
};

type WebSocketFactory = (address: string) => WebSocketLike;

export interface AhpClientOptions {
	address?: string;
	clientId?: string;
	protocolVersions?: string[];
	codeCommand?: string;
	autoStartAgentHost?: boolean;
	webSocketFactory?: WebSocketFactory;
	tokenProvider?: (
		resources: ProtectedResourceMetadata[],
	) => Promise<readonly AhpAuthenticationToken[]>;
}

export interface AhpAuthenticationToken {
	resource: string;
	token: string;
}

export interface AhpInitializeResult {
	protocolVersion: string;
	serverSeq: number;
	snapshots: unknown[];
	defaultDirectory?: string;
}

export class AhpClient {
	readonly clientId: string;
	readonly notifications = new AsyncQueue<AhpNotification>();

	private nextRequestId = 1;
	private nextClientSeq = 1;
	private readonly pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (reason: unknown) => void;
		}
	>();
	private closed = false;

	private constructor(
		private readonly socket: WebSocketLike,
		clientId: string,
	) {
		this.clientId = clientId;
		this.socket.addEventListener("message", (event) => this.handleMessage(event));
		this.socket.addEventListener("close", () => this.handleClose());
		this.socket.addEventListener("error", (event) => this.handleSocketError(event));
	}

	static async connect(options: AhpClientOptions = {}): Promise<AhpClient> {
		const address =
			options.address ??
			(await resolveAgentHostAddress({
				codeCommand: options.codeCommand,
				autoStart: options.autoStartAgentHost ?? true,
			}));
		const socket = await openWebSocket(address, options.webSocketFactory);
		const client = new AhpClient(socket, options.clientId ?? `piper-${randomUUID()}`);
		await client.request<AhpInitializeResult>("initialize", {
			channel: AHP_ROOT_CHANNEL,
			clientId: client.clientId,
			protocolVersions: options.protocolVersions ?? [AHP_PROTOCOL_VERSION],
			initialSubscriptions: [AHP_ROOT_CHANNEL],
		});
		return client;
	}

	async request<T>(method: string, params?: unknown): Promise<T> {
		if (this.closed) {
			throw new Error("AHP connection is closed");
		}

		const id = this.nextRequestId++;
		const request: JsonRpcRequest = { jsonrpc: "2.0", id, method };
		if (params !== undefined) {
			request.params = params;
		}

		const response = new Promise<T>((resolve, reject) => {
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
			});
		});
		this.socket.send(JSON.stringify(request));
		return response;
	}

	async requestWithAuth<T>(
		method: string,
		params: unknown,
		tokenProvider: (
			resources: ProtectedResourceMetadata[],
		) => Promise<readonly AhpAuthenticationToken[]>,
	): Promise<T> {
		try {
			return await this.request<T>(method, params);
		} catch (error) {
			if (!(error instanceof AhpRpcError) || error.code !== AHP_AUTH_REQUIRED) {
				throw error;
			}

			const resources = readProtectedResources(error.data);
			if (resources.length === 0) {
				throw new Error(
					"AHP authentication required, but the server did not advertise protected resources.",
				);
			}

			const tokens = await tokenProvider(resources);
			if (tokens.length === 0) {
				throw new Error(
					`AHP authentication required for ${resources.map((resource) => resource.resource).join(", ")}, but no token was available.`,
				);
			}

			for (const { resource, token } of tokens) {
				await this.request("authenticate", {
					channel: AHP_ROOT_CHANNEL,
					resource,
					token,
				});
			}

			return this.request<T>(method, params);
		}
	}

	notify(method: string, params?: unknown): void {
		if (this.closed) {
			throw new Error("AHP connection is closed");
		}

		const notification: JsonRpcNotification = { jsonrpc: "2.0", method };
		if (params !== undefined) {
			notification.params = params;
		}
		this.socket.send(JSON.stringify(notification));
	}

	dispatchAction(channel: string, action: AhpAction): void {
		this.notify("dispatchAction", {
			channel,
			clientSeq: this.nextClientSeq++,
			action,
		});
	}

	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.socket.close();
		this.rejectPending(new Error("AHP connection closed"));
		this.notifications.close();
	}

	private handleMessage(event: unknown): void {
		const rawData = readWebSocketMessageData(event);
		if (rawData === undefined) {
			return;
		}

		const message = JSON.parse(rawData) as {
			id?: unknown;
			method?: unknown;
			params?: unknown;
			result?: unknown;
			error?: AhpJsonRpcError;
		};

		if (typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (!pending) {
				return;
			}
			this.pending.delete(message.id);
			if (message.error) {
				pending.reject(new AhpRpcError(message.error));
			} else {
				pending.resolve(message.result);
			}
			return;
		}

		if (typeof message.method === "string") {
			this.notifications.push({ method: message.method, params: message.params });
		}
	}

	private handleClose(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.rejectPending(new Error("AHP connection closed"));
		this.notifications.close();
	}

	private handleSocketError(event: unknown): void {
		const error =
			event instanceof Error ? event : new Error(`AHP WebSocket error: ${String(event)}`);
		this.rejectPending(error);
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}

export async function resolveAgentHostAddress(params: {
	address?: string;
	codeCommand?: string;
	autoStart?: boolean;
}): Promise<string> {
	if (params.address) {
		return params.address;
	}
	if (params.autoStart === false) {
		throw new Error(
			"Missing AHP address. Set COPILOT_AHP_ADDRESS or enable agent host auto-start.",
		);
	}

	const command = params.codeCommand ?? "code";
	const output = await runAgentHostCommand(command);
	const address = extractAgentHostAddress(output);
	if (!address) {
		throw new Error(
			`Unable to discover VS Code Agent Host address from \`${command} agent host\` output.`,
		);
	}
	return address.replace("ws://localhost:", "ws://127.0.0.1:");
}

export function extractAgentHostAddress(output: string): string | undefined {
	const withoutAnsi = output.replace(/\x1b\[[0-9;]*m/g, "");
	return withoutAnsi.match(
		/ws:\/\/(?:localhost|127\.0\.0\.1|\[[^\]]+\]|[^\s]+):\d+(?:\?tkn=[^\s]+)?/,
	)?.[0];
}

export function buildDefaultChatUri(sessionUri: string): string {
	const encoded = Buffer.from(sessionUri, "utf8")
		.toString("base64")
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
	return `ahp-chat://default/${encoded}`;
}

export function fileUri(filePath: string): string {
	return pathToFileURL(filePath).toString();
}

export function readProtectedResources(data: unknown): ProtectedResourceMetadata[] {
	if (Array.isArray(data)) {
		return data.filter(isProtectedResourceMetadata);
	}
	if (data && typeof data === "object") {
		const resources = (data as { resources?: unknown }).resources;
		if (Array.isArray(resources)) {
			return resources.filter(isProtectedResourceMetadata);
		}
	}
	return [];
}

export async function githubCliTokenProvider(
	resources: ProtectedResourceMetadata[],
): Promise<AhpAuthenticationToken[]> {
	const needsGithub = resources.filter((resource) =>
		(resource.authorization_servers ?? []).some((server) => server.includes("github.com")),
	);
	if (needsGithub.length === 0) {
		return [];
	}

	const token = await runCommand("gh", ["auth", "token"]);
	return needsGithub.map((resource) => ({ resource: resource.resource, token: token.trim() }));
}

async function openWebSocket(
	address: string,
	webSocketFactory?: WebSocketFactory,
): Promise<WebSocketLike> {
	const WebSocketCtor = globalThis.WebSocket;
	if (!webSocketFactory && typeof WebSocketCtor !== "function") {
		throw new Error("This Node.js runtime does not provide WebSocket. Use Node 22+.");
	}

	const socket = webSocketFactory ? webSocketFactory(address) : new WebSocketCtor(address);
	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			socket.removeEventListener("open", handleOpen);
			socket.removeEventListener("error", handleError);
		};
		const handleOpen = () => {
			cleanup();
			resolve();
		};
		const handleError = (event: unknown) => {
			cleanup();
			reject(new Error(`Failed to connect to VS Code Agent Host at ${address}: ${String(event)}`));
		};
		socket.addEventListener("open", handleOpen);
		socket.addEventListener("error", handleError);
	});
	return socket as WebSocketLike;
}

function readWebSocketMessageData(event: unknown): string | undefined {
	const data = (event as { data?: unknown }).data;
	if (typeof data === "string") {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return Buffer.from(data).toString("utf8");
	}
	if (ArrayBuffer.isView(data)) {
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
	}
	return undefined;
}

function isProtectedResourceMetadata(value: unknown): value is ProtectedResourceMetadata {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as ProtectedResourceMetadata).resource === "string"
	);
}

async function runAgentHostCommand(command: string): Promise<string> {
	return runCommand(command, ["agent", "host"]);
}

async function runCommand(command: string, args: string[]): Promise<string> {
	const child = spawn(command, args, {
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});

	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString("utf8");
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString("utf8");
	});

	return new Promise((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (exitCode) => {
			const output = `${stdout}${stderr}`;
			if (exitCode === 0) {
				resolve(output);
				return;
			}
			reject(new Error(`Command failed: ${command} ${args.join(" ")}\n${output.trim()}`));
		});
	});
}
