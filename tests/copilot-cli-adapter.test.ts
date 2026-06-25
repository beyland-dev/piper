import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CopilotCliHarness } from "../src/index.js";

describe("CopilotCliHarness", () => {
	const directories: string[] = [];

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	it("runs a configured Copilot CLI command with task environment", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-"));
		directories.push(workspacePath);

		const adapter = new CopilotCliHarness({
			commandTemplate:
				'node -e "console.log(process.env.COPILOT_GOAL); console.log(process.env.COPILOT_CONTEXT); console.log(process.env.AGENT_WORKSPACE)"',
		});

		const handle = adapter.startTask({
			goal: "Create a plan",
			context: ["Use tests"],
			workspacePath,
		});

		await expect(handle.completed).resolves.toMatchObject({
			output: `Create a plan\nUse tests\n${workspacePath}`,
		});
	});

	it("passes the prompt with Copilot's non-interactive flag by default", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-"));
		directories.push(workspacePath);
		const commandPath = join(workspacePath, "fake-copilot");
		await writeFile(
			commandPath,
			"#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n",
		);
		await chmod(commandPath, 0o755);

		const adapter = new CopilotCliHarness({
			command: commandPath,
		});

		const handle = adapter.startTask({
			goal: "Create a plan",
			context: ["Use tests"],
			workspacePath,
		});

		await expect(handle.completed).resolves.toMatchObject({
			output: JSON.stringify(["-p", "Goal:\nCreate a plan\n\nContext:\nUse tests"]),
		});
	});

	it("passes model selection through templates and task environment", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-"));
		directories.push(workspacePath);

		const adapter = new CopilotCliHarness({
			commandTemplate:
				'node -e "console.log(process.env.COPILOT_MODEL); console.log(process.env.AGENT_MODEL); console.log({model})"',
		});

		const handle = adapter.startTask({
			goal: "Create a plan",
			model: "gpt-5.4",
			context: [],
			workspacePath,
		});

		await expect(handle.completed).resolves.toMatchObject({
			output: "gpt-5.4\ngpt-5.4\ngpt-5.4",
		});
	});

	it("passes retry feedback to subsequent attempts", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-"));
		directories.push(workspacePath);

		const adapter = new CopilotCliHarness({
			commandTemplate:
				"node -e \"if (process.env.AGENT_ATTEMPT === '1') { console.error('needs retry'); process.exit(1); } console.log(process.env.COPILOT_RETRY_REASON)\"",
		});

		const handle = adapter.startTask({
			goal: "Create a plan",
			context: [],
			workspacePath,
		});

		await expect(handle.errored).resolves.toMatchObject({
			message: "copilot exited with code 1",
			retryable: true,
		});

		adapter.retry(handle, ["Retry with more detail"]);

		await expect(handle.completed).resolves.toMatchObject({
			output: "Retry with more detail",
		});
	});

	it("passes constraints and protected files through templates and task environment", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-"));
		directories.push(workspacePath);

		const adapter = new CopilotCliHarness({
			commandTemplate:
				'node -e "console.log(process.env.COPILOT_CONSTRAINTS); console.log(process.env.COPILOT_PROTECTED_FILES); console.log(process.env.AGENT_CONSTRAINTS); console.log(process.env.AGENT_PROTECTED_FILES); console.log({constraints}); console.log({protectedFiles})"',
		});

		const handle = adapter.startTask({
			goal: "Create a plan",
			context: [],
			constraints: ["do not modify secret.ts"],
			protectedFiles: ["secret.ts"],
			workspacePath,
		});

		await expect(handle.completed).resolves.toMatchObject({
			output:
				"do not modify secret.ts\nsecret.ts\ndo not modify secret.ts\nsecret.ts\ndo not modify secret.ts\nsecret.ts",
		});
	});
});
