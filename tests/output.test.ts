import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MockHarness, PiperOrchestrator, artifact, input, step } from "../src/index.js";

describe("artifact", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("passes named artifact into downstream step context", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-artifact-"));
		directories.push(workspacePath);

		const adapter = new MockHarness({
			behaviors: {
				"Create plan": {
					output: "OAuth plan",
				},
				"Implement feature": {
					output: "Done",
				},
			},
		});

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			stepRetryLimit: 0,
			artifactStorage: false,
		});
		const plan = artifact("plan");

		await executor.execute([
			step({ goal: "Create plan", harness: "mock", produces: plan }),
			step({ goal: "Implement feature", harness: "mock", context: [plan.value()] }),
		]);

		const downstreamAttempt = adapter.history.find((entry) => entry.goal === "Implement feature");
		expect(downstreamAttempt?.context).toEqual(["OAuth plan"]);
	});

	it("persists artifacts to disk by default", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-artifact-"));
		const outputRoot = await mkdtemp(join(tmpdir(), "piper-artifact-runs-"));
		directories.push(workspacePath, outputRoot);

		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [
				new MockHarness({
					behaviors: {
						"Create plan": {
							output: "Persisted plan",
						},
					},
				}),
			],
			stepRetryLimit: 0,
			artifactStorage: {
				rootDir: outputRoot,
				runId: "test-run",
			},
		});

		const summary = await executor.execute(
			step({ goal: "Create plan", harness: "mock", produces: "plan" }),
		);

		expect(summary.runId).toBe("test-run");
		expect(summary.artifactPath).toBe(join(outputRoot, "test-run", "artifacts.json"));

		const persisted = JSON.parse(await readFile(summary.artifactPath as string, "utf8")) as {
			runId: string;
			artifacts: Record<string, { output: string }>;
			summary: { completedSteps: number };
		};

		expect(persisted.runId).toBe("test-run");
		expect(persisted.artifacts.plan.output).toBe("Persisted plan");
		expect(persisted.summary.completedSteps).toBe(1);
	});

	it("loads named external input into downstream step context", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-input-"));
		directories.push(workspacePath);

		const adapter = new MockHarness();
		const executor = new PiperOrchestrator({
			workspacePath,
			harnesses: [adapter],
			stepRetryLimit: 0,
			artifactStorage: false,
		});

		await executor.execute(
			step({
				goal: "Plan from external data",
				harness: "mock",
				context: [
					input(
						"customer-ticket",
						() => "Customer ticket: checkout retries fail after token refresh",
						{
							description: "customer ticket input",
							dependencies: ["support-ticket-42"],
						},
					),
				],
			}),
		);

		const attempt = adapter.history.find((entry) => entry.goal === "Plan from external data");
		expect(attempt?.context).toEqual([
			"Customer ticket: checkout retries fail after token refresh",
		]);
	});

	it("uses input metadata for runtime value descriptions and dependencies", () => {
		const supportInput = input("support-ticket", () => "Ticket summary", {
			description: "support ticket summary",
			dependencies: ["ticket-123"],
		});

		expect(supportInput.description).toBe("support ticket summary");
		expect(supportInput.dependencies).toEqual(["ticket-123"]);
	});
});
