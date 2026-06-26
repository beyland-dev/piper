import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	PiperCancellationError,
	PiperOrchestrator,
	loop,
	step,
	type HarnessAdapter,
	type ProgressUpdate,
	type StepError,
	type StepHandle,
	type StepResult,
} from "../src/index.js";

async function* emptyProgress(): AsyncGenerator<ProgressUpdate> {}

async function* neverProgress(): AsyncGenerator<ProgressUpdate> {
	await new Promise<void>(() => undefined);
}

function completedHandle(output: string): StepHandle {
	return {
		progress: emptyProgress(),
		completed: Promise.resolve({
			output,
			modifiedFiles: [],
		}),
		errored: new Promise<StepError>(() => undefined),
	};
}

function neverHandle(): StepHandle {
	return {
		progress: neverProgress(),
		completed: new Promise<StepResult>(() => undefined),
		errored: new Promise<StepError>(() => undefined),
	};
}

class CancellationHarness implements HarnessAdapter {
	name = "cancel-test";
	cancelCount = 0;
	readonly startedGoals: string[] = [];

	private readonly startedWaiters = new Map<string, () => void>();

	startStep(params: {
		goal: string;
		model?: string;
		context: string[];
		constraints: string[];
		protectedFiles: string[];
		workspacePath: string;
	}): StepHandle {
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

	it("cancels active step handles and persists completed artifacts", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cancel-"));
		const outputRoot = await mkdtemp(join(tmpdir(), "piper-cancel-runs-"));
		directories.push(workspacePath, outputRoot);

		const harness = new CancellationHarness();
		const orchestrator = new PiperOrchestrator({
			workspacePath,
			harnesses: [harness],
			stepRetryLimit: 0,
			artifactStorage: {
				rootDir: outputRoot,
				runId: "cancelled-run",
			},
		});

		const execution = orchestrator.execute(
			loop(
				{ objective: "Cancel active steps" },
				step({ goal: "Prepare", harness: "cancel-test", produces: "prepared" }),
				step({ goal: "Hang", harness: "cancel-test", produces: "pending" }),
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
			summary: { completedSteps: number; failedSteps: number };
		};

		expect(persisted.artifacts.prepared.output).toBe("Prepared artifact");
		expect(persisted.artifacts.pending).toBeUndefined();
		expect(persisted.summary).toMatchObject({
			completedSteps: 1,
			failedSteps: 0,
		});
	});
});
