import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHarness, PiperOrchestrator, parallel, step } from "../src/index.js";

describe("Parallel", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("runs child steps concurrently", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-parallel-"));
		directories.push(workspacePath);

		const adapter = new MockHarness({
			behaviors: {
				"Step A": { delayMs: 80 },
				"Step B": { delayMs: 80 },
			},
		});

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			stepRetryLimit: 0,
			artifactStorage: false,
		});

		const start = Date.now();
		await executor.execute(
			parallel(
				step({ goal: "Step A", harness: "mock" }),
				step({ goal: "Step B", harness: "mock" }),
			),
		);
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(150);
	});
});
