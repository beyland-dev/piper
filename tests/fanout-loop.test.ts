import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHarness, PiperOrchestrator, artifact, fanOut, loop, step } from "../src/index.js";

describe("fanOut and loop", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("maps one artifact into parallel downstream slice steps", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-fanout-"));
		directories.push(workspacePath);
		const apiChange = artifact("api-change", "implementation");
		const adapter = new MockHarness({
			behaviors: {
				"Create shared plan": { output: "Plan artifact" },
				"Implement slice: api-change": { output: "API implementation" },
				"Implement slice: ui-change": { output: "UI implementation" },
			},
		});
		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			stepRetryLimit: 0,
			artifactStorage: false,
		});

		const summary = await executor.execute(
			loop(
				{ objective: "Implement slices from shared plan" },
				step({ goal: "Create shared plan", harness: "mock", produces: "plan" }),
				fanOut({
					from: "plan",
					into: [apiChange, "ui-change"],
					using: "Implement slice",
					harness: "mock",
					status: "Implementing slices from plan...",
				}),
			),
		);

		expect(summary.artifacts["api-change"]).toBe("API implementation");
		expect(summary.artifacts["ui-change"]).toBe("UI implementation");
		expect(adapter.history).toHaveLength(3);
		expect(
			adapter.history.find((entry) => entry.goal === "Implement slice: api-change")?.context,
		).toContain("Plan artifact");
		expect(
			adapter.history.find((entry) => entry.goal === "Implement slice: ui-change")?.context,
		).toContain("Plan artifact");
	});

	it("keeps loop as ordered grouping for step trees", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-loop-"));
		directories.push(workspacePath);
		const adapter = new MockHarness();
		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			stepRetryLimit: 0,
			artifactStorage: false,
		});

		const summary = await executor.execute(
			loop(
				{ objective: "Run ordered steps" },
				step({ goal: "First step", harness: "mock" }),
				step({ goal: "Second step", harness: "mock" }),
			),
		);

		expect(summary.completedSteps).toBe(2);
		expect(adapter.history.map((entry) => entry.goal)).toEqual(["First step", "Second step"]);
	});
});
