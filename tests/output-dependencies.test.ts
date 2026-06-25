import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHarness, PiperOrchestrator, artifact, parallel, task } from "../src/index.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs = 200): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
		}),
	]);
}

describe("artifact dependencies", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("fails fast when artifact references an undeclared artifact", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-artifact-deps-"));
		directories.push(workspacePath);

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [new MockHarness()],
			taskRetryLimit: 0,
			artifactStorage: false,
		});

		await expect(
			withTimeout(
				executor.execute(
					task({
						goal: "Implement feature",
						harness: "mock",
						context: [artifact("missing").value()],
					}),
				),
				150,
			),
		).rejects.toThrow(
			'Invalid workflow:\n- Artifact "missing" is referenced by task "Implement feature" runtime value "artifact value(missing)" but no task declares it.',
		);
	});

	it("includes a fix hint for unknown artifacts", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-artifact-deps-"));
		directories.push(workspacePath);

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [new MockHarness()],
			taskRetryLimit: 0,
			artifactStorage: false,
		});

		await expect(
			withTimeout(
				executor.execute(
					task({
						goal: "Implement feature",
						harness: "mock",
						context: [artifact("missing").value()],
					}),
				),
				150,
			),
		).rejects.toThrow(
			'Artifact "missing" is referenced by task "Implement feature" runtime value "artifact value(missing)" but no task declares it.',
		);
	});

	it("fails before execution when an artifact has multiple producers", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-artifact-deps-"));
		directories.push(workspacePath);

		const adapter = new MockHarness();
		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			taskRetryLimit: 0,
			artifactStorage: false,
		});

		await expect(
			executor.execute([
				task({ goal: "Create first plan", harness: "mock", artifact: "plan" }),
				task({ goal: "Create second plan", harness: "mock", artifact: "plan" }),
			]),
		).rejects.toThrow('Artifact "plan" is declared 2 times.');

		expect(adapter.history).toHaveLength(0);
	});

	it("rejects waiting artifact consumers when the producer task fails", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-artifact-deps-"));
		directories.push(workspacePath);

		const adapter = new MockHarness({
			resolveBehavior: ({ goal }) => {
				if (goal === "Create plan") {
					return {
						failOnAttempt: 1,
						retryable: false,
						errorMessage: "Plan task failed",
					};
				}

				if (goal === "Implement feature") {
					return {
						output: "Done",
					};
				}

				return undefined;
			},
		});

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			taskRetryLimit: 0,
			artifactStorage: false,
		});

		await expect(
			withTimeout(
				executor.execute(
					parallel(
						task({ goal: "Create plan", harness: "mock", artifact: "plan" }),
						task({
							goal: "Implement feature",
							harness: "mock",
							context: [artifact("plan").value()],
						}),
					),
				),
				200,
			),
		).rejects.toThrow("Plan task failed");

		const artifacts = (
			executor as unknown as {
				artifacts: { waitForOutput(name: string): Promise<string> };
			}
		).artifacts;

		await expect(withTimeout(artifacts.waitForOutput("plan"), 100)).rejects.toThrow(
			'Artifact "plan" was not produced because its task failed.',
		);
	});
});
