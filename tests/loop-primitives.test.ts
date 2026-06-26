import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	MockHarness,
	PiperOrchestrator,
	agent,
	artifact,
	evaluate,
	feedback,
	loop,
	parallel,
	repeat,
	runtimeValue,
	step,
} from "../src/index.js";

describe("loop primitives", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("runs role-bound steps and persists typed artifacts", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-loop-"));
		directories.push(workspacePath);
		const plan = artifact("plan", "plan");
		const adapter = new MockHarness({
			behaviors: {
				"Create plan": { output: "Plan artifact" },
				"Implement plan": { output: "Implementation summary" },
			},
		});
		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			artifactStorage: false,
		});

		const summary = await executor.execute(
			loop(
				{
					objective: "Plan and implement",
					agents: [
						agent("planner", { harness: "mock" }),
						agent("implementer", { harness: "mock" }),
					],
				},
				step({ role: "planner", goal: "Create plan", produces: plan }),
				step({ role: "implementer", goal: "Implement plan", context: [plan] }),
			),
		);

		expect(summary.completedSteps).toBe(2);
		expect(summary.artifacts.plan).toBe("Plan artifact");
		expect(adapter.history[1]?.context).toContain("Plan artifact");
	});

	it("turns evaluator failures into feedback for the next repeat iteration", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-loop-"));
		directories.push(workspacePath);
		let checks = 0;
		const adapter = new MockHarness();
		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			taskRetryLimit: 0,
			artifactStorage: false,
		});

		const summary = await executor.execute(
			loop(
				{ objective: "Revise until approved" },
				repeat(
					{ maxAttempts: 2 },
					step({ goal: "Revise draft", harness: "mock" }),
					evaluate({
						name: "approve draft",
						using: runtimeValue(() => {
							checks += 1;
							return checks > 1;
						}, "approval check"),
						feedback: "Draft needs another revision.",
					}),
				),
			),
		);

		expect(summary.completedSteps).toBe(2);
		expect(summary.feedback.map((entry) => entry.message)).toContain(
			"Draft needs another revision.",
		);
		expect(adapter.history[1]?.context.join("\n")).toContain("Draft needs another revision.");
	});

	it("supports explicit feedback and parallel investigation branches", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-loop-"));
		directories.push(workspacePath);
		const adapter = new MockHarness();
		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			artifactStorage: false,
		});

		const summary = await executor.execute(
			loop(
				{ objective: "Investigate options" },
				feedback({ message: "Prefer the lowest-risk option.", severity: "info" }),
				parallel(
					step({ goal: "Investigate option A", harness: "mock", produces: "option-a" }),
					step({ goal: "Investigate option B", harness: "mock", produces: "option-b" }),
				),
			),
		);

		expect(summary.artifacts["option-a"]).toContain("Investigate option A");
		expect(summary.artifacts["option-b"]).toContain("Investigate option B");
		expect(summary.feedback[0]?.message).toBe("Prefer the lowest-risk option.");
	});
});
