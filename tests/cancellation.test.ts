import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	PiperCancellationError,
	PiperOrchestrator,
	task,
	workflow,
	type HarnessAdapter,
	type ProgressUpdate,
	type TaskError,
	type TaskHandle,
	type TaskResult,
} from "../src/index.js";

async function* emptyProgress(): AsyncGenerator<ProgressUpdate> {}

async function* neverProgress(): AsyncGenerator<ProgressUpdate> {
	await new Promise<void>(() => undefined);
}

function completedHandle(output: string): TaskHandle {
	return {
		progress: emptyProgress(),
		completed: Promise.resolve({
			output,
			modifiedFiles: [],
		}),
		errored: new Promise<TaskError>(() => undefined),
	};
}

function neverHandle(): TaskHandle {
	return {
		progress: neverProgress(),
		completed: new Promise<TaskResult>(() => undefined),
		errored: new Promise<TaskError>(() => undefined),
	};
}

class CancellationHarness implements HarnessAdapter {
	name = "cancel-test";
	cancelCount = 0;
	readonly startedGoals: string[] = [];

	private readonly startedWaiters = new Map<string, () => void>();

	startTask(params: {
		goal: string;
		model?: string;
		context: string[];
		constraints: string[];
		protectedFiles: string[];
		workspacePath: string;
	}): TaskHandle {
		this.startedGoals.push(params.goal);
		this.startedWaiters.get(params.goal)?.();

		if (params.goal === "Prepare") {
			return completedHandle("Prepared artifact");
		}

		return neverHandle();
	}

	retry(): void {}

	cancel(): void {
		this.cancelCount += 1;
	}

	waitForStart(goal: string): Promise<void> {
		if (this.startedGoals.includes(goal)) {
			return Promise.resolve();
		}

		return new Promise((resolve) => {
			this.startedWaiters.set(goal, resolve);
		});
	}
}

describe("cancellation", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("cancels active task handles and persists completed artifacts", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cancel-"));
		const outputRoot = await mkdtemp(join(tmpdir(), "piper-cancel-runs-"));
		directories.push(workspacePath, outputRoot);

		const harness = new CancellationHarness();
		const orchestrator = new PiperOrchestrator({
			workspacePath,
			harnesses: [harness],
			taskRetryLimit: 0,
			artifactStorage: {
				rootDir: outputRoot,
				runId: "cancelled-run",
			},
		});

		const execution = orchestrator.execute(
			workflow(
				task({ goal: "Prepare", harness: "cancel-test", artifact: "prepared" }),
				task({ goal: "Hang", harness: "cancel-test", artifact: "pending" }),
			),
		);

		await harness.waitForStart("Hang");
		const executionFailure = expect(execution).rejects.toBeInstanceOf(PiperCancellationError);
		await orchestrator.cancel("Test cancellation", "SIGINT");

		await executionFailure;
		expect(harness.cancelCount).toBe(1);

		const persisted = JSON.parse(
			await readFile(join(outputRoot, "cancelled-run", "artifacts.json"), "utf8"),
		) as {
			artifacts: Record<string, { output: string }>;
			summary: { completedTasks: number; failedTasks: number };
		};

		expect(persisted.artifacts.prepared.output).toBe("Prepared artifact");
		expect(persisted.artifacts.pending).toBeUndefined();
		expect(persisted.summary).toMatchObject({
			completedTasks: 1,
			failedTasks: 0,
		});
	});
});
