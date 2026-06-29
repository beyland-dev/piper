import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CliReporter } from "../src/cli/output.js";
import {
	PiperCancellationError,
	PiperOrchestrator,
	loop,
	runtimeValue,
	step,
	type HarnessAdapter,
	type ProgressUpdate,
	type RunEvent,
	type RuntimeHooks,
	type StepAttemptInfo,
	type StepError,
	type StepHandle,
} from "../src/index.js";

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve;
		reject = promiseReject;
	});

	return { promise, resolve, reject };
}

async function* emptyProgress(): AsyncGenerator<ProgressUpdate> {}

function completedHandle(output: string): StepHandle {
	return {
		progress: emptyProgress(),
		completed: Promise.resolve({ output, modifiedFiles: [] }),
		errored: new Promise<StepError>(() => undefined),
	};
}

function createBufferStream(): {
	stream: Writable & { isTTY?: boolean };
	read: () => string;
} {
	let output = "";
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			output += chunk.toString();
			callback();
		},
	}) as Writable & { isTTY?: boolean };
	stream.isTTY = false;

	return {
		stream,
		read: () => output,
	};
}

class RecordingHarness implements HarnessAdapter {
	name = "recording";
	startCount = 0;
	cancelCount = 0;

	constructor(private readonly records: string[] = []) {}

	startStep(params: {
		goal: string;
		model?: string;
		context: string[];
		constraints: string[];
		protectedFiles: string[];
		workspacePath: string;
	}): StepHandle {
		this.startCount += 1;
		this.records.push("harness:start");
		return completedHandle(params.context.join("\n") || `Completed ${params.goal}`);
	}

	retry(): void {}

	cancel(): void {
		this.cancelCount += 1;
	}
}

function createRecordingHooks(records: string[]): RuntimeHooks {
	return {
		info: () => undefined,
		stepStarted: (info: StepAttemptInfo) => {
			records.push(`hook:stepStarted:${info.id}`);
		},
		stepProgress: () => undefined,
		stepRetry: () => undefined,
		stepCompleted: () => undefined,
		stepFailed: () => undefined,
		event: (event: RunEvent) => {
			records.push(`event:${event.type}`);
		},
		summary: () => undefined,
	};
}

describe("context resolution lifecycle", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("orders step start, context resolution, and harness start explicitly", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-context-"));
		directories.push(workspacePath);
		const records: string[] = [];
		const harness = new RecordingHarness(records);
		const orchestrator = new PiperOrchestrator({
			workspacePath,
			harnesses: [harness],
			hooks: createRecordingHooks(records),
			artifactStorage: false,
		});

		await orchestrator.execute(
			loop(
				{ objective: "Resolve context before harness" },
				step({
					id: "step-2",
					goal: "Research cached codebase",
					harness: "recording",
					context: [
						runtimeValue(() => {
							records.push("runtimeValue:resolve");
							return "cached checkout";
						}, "cached codebase checkout for https://github.com/microsoft/vscode.git"),
					],
				}),
			),
		);

		expect(records.indexOf("event:step:start")).toBeLessThan(
			records.indexOf("hook:stepStarted:step-2"),
		);
		expect(records.indexOf("hook:stepStarted:step-2")).toBeLessThan(
			records.indexOf("event:context:start"),
		);
		expect(records.indexOf("event:context:start")).toBeLessThan(
			records.indexOf("event:context:value"),
		);
		expect(records.indexOf("event:context:value")).toBeLessThan(
			records.indexOf("runtimeValue:resolve"),
		);
		expect(records.indexOf("runtimeValue:resolve")).toBeLessThan(
			records.indexOf("event:context:complete"),
		);
		expect(records.indexOf("event:context:complete")).toBeLessThan(
			records.indexOf("harness:start"),
		);
	});

	it("reports pending runtime context before the harness starts", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-context-"));
		directories.push(workspacePath);
		const stdout = createBufferStream();
		const stderr = createBufferStream();
		const harness = new RecordingHarness();
		const runtimeStarted = createDeferred<void>();
		const releaseRuntime = createDeferred<string>();
		const orchestrator = new PiperOrchestrator({
			workspacePath,
			harnesses: [harness],
			hooks: new CliReporter({ stdout: stdout.stream, stderr: stderr.stream }),
			artifactStorage: false,
		});

		const execution = orchestrator.execute(
			loop(
				{ objective: "Visible preparation" },
				step({
					id: "step-2",
					goal: "Research cached codebase",
					harness: "recording",
					context: [
						runtimeValue(async () => {
							runtimeStarted.resolve();
							return releaseRuntime.promise;
						}, "cached codebase checkout for https://github.com/microsoft/vscode.git"),
					],
				}),
			),
		);

		await runtimeStarted.promise;

		expect(harness.startCount).toBe(0);
		expect(stdout.read()).toContain("[run] Research cached codebase");
		expect(stdout.read()).toContain("[context] Resolving runtime context for step-2...");
		expect(stdout.read()).toContain(
			"[context] Resolving runtime value: cached codebase checkout for https://github.com/microsoft/vscode.git",
		);
		expect(stdout.read()).not.toContain("[done] Successfully completed step-2");

		releaseRuntime.resolve("checked out microsoft/vscode");
		await execution;

		expect(harness.startCount).toBe(1);
		expect(stdout.read()).toContain(
			"[context] Resolved runtime context for step-2; starting recording harness...",
		);
		expect(stderr.read()).toBe("");
	});

	it("cancels cleanly during context resolution without starting the harness", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-context-"));
		directories.push(workspacePath);
		const records: string[] = [];
		const harness = new RecordingHarness(records);
		const runtimeStarted = createDeferred<void>();
		const orchestrator = new PiperOrchestrator({
			workspacePath,
			harnesses: [harness],
			hooks: createRecordingHooks(records),
			artifactStorage: false,
		});

		const execution = orchestrator.execute(
			loop(
				{ objective: "Cancel context resolution" },
				step({
					id: "step-2",
					goal: "Research cached codebase",
					harness: "recording",
					context: [
						runtimeValue(async () => {
							runtimeStarted.resolve();
							return new Promise<string>(() => undefined);
						}, "slow runtime context"),
					],
				}),
			),
		);

		await runtimeStarted.promise;
		const executionFailure = expect(execution).rejects.toBeInstanceOf(PiperCancellationError);
		await orchestrator.cancel("Stop while resolving context");
		await executionFailure;

		expect(harness.startCount).toBe(0);
		expect(harness.cancelCount).toBe(0);
		expect(records).toContain("event:context:start");
		expect(records).toContain("event:context:value");
		expect(records).toContain("event:context:cancel");
		expect(records).not.toContain("event:context:complete");
		expect(records).not.toContain("harness:start");
	});
});
