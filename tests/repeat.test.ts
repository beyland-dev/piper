import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHarness, PiperOrchestrator, repeat, step } from "../src/index.js";

describe("repeat", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("runs fallback work and retries the failed branch", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-repeat-"));
		directories.push(workspacePath);

		// resolveBehavior tracks global starts so the second invocation of "Unstable step"
		// succeeds even though each new handle starts at attempt 1.
		let unstableStarts = 0;
		const adapter = new MockHarness({
			resolveBehavior: ({ goal }) => {
				if (goal === "Unstable step") {
					unstableStarts += 1;
					return unstableStarts === 1
						? { failOnAttempt: 1, output: "Recovered result" }
						: { output: "Recovered result" };
				}
				return undefined;
			},
			behaviors: {
				"Recovery step": {
					output: "Recovery complete",
				},
			},
		});

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			stepRetryLimit: 0,
			artifactStorage: false,
		});

		const summary = await executor.execute(
			repeat(
				{
					maxAttempts: 2,
					onFailure: (_error, retry) =>
						step({
							goal: "Recovery step",
							harness: "mock",
							onComplete: () => retry(),
						}),
				},
				step({ goal: "Unstable step", harness: "mock", produces: "result" }),
			),
		);

		expect(summary.artifacts.result).toBe("Recovered result");
		expect(adapter.history.filter((entry) => entry.goal === "Unstable step")).toHaveLength(2);
	});
});
