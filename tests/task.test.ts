import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHarness, PiperOrchestrator, task } from "../src/index.js";

describe("Task", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("runs a single task and captures its named artifact", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-task-"));
		directories.push(workspacePath);

		const adapter = new MockHarness({
			behaviors: {
				"Create a plan": {
					output: "Plan artifact",
				},
			},
		});

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			taskRetryLimit: 0,
			artifactStorage: false,
		});

		const summary = await executor.execute(
			task({
				goal: "Create a plan",
				harness: "mock",
				artifact: "plan",
			}),
		);

		expect(summary.completedTasks).toBe(1);
		expect(summary.artifacts.plan).toBe("Plan artifact");
	});

	it("passes model selection to the adapter", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-task-"));
		directories.push(workspacePath);

		const adapter = new MockHarness();

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			taskRetryLimit: 0,
			artifactStorage: false,
		});

		await executor.execute(
			task({
				goal: "Create a plan",
				harness: "mock",
				model: "claude-sonnet-4.6",
			}),
		);

		expect(adapter.history[0]).toMatchObject({
			goal: "Create a plan",
			model: "claude-sonnet-4.6",
		});
	});
});
