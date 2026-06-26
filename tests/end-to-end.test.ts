import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/index.js";

function createBufferStream(onChunk: (chunk: string) => void): Writable {
	return new Writable({
		write(chunk, _encoding, callback) {
			onChunk(chunk.toString());
			callback();
		},
	});
}

function createWorkflowGeneratorTemplate(
	source = 'import { task } from "@beyland/piper";\\n\\nexport default task({ goal: "Generated task", harness: "mock" });\\n',
): string {
	const script = [
		'const fs = require("node:fs");',
		'const path = require("node:path");',
		'const context = process.env.AGENT_CONTEXT ?? "";',
		"const match = context.match(/Target workflow path:\\n([^\\n]+)/);",
		'if (!match) throw new Error("missing target workflow path");',
		`const source = \`${source}\`;`,
		"fs.mkdirSync(path.dirname(match[1]), { recursive: true });",
		'fs.writeFileSync(match[1], source, "utf8");',
		'console.log("generated workflow");',
	].join(" ");
	return `node -e '${script}'`;
}

describe("CLI end-to-end", () => {
	const directories: string[] = [];
	let artifactRoot: string;
	let previousArtifactRoot: string | undefined;

	beforeAll(async () => {
		previousArtifactRoot = process.env.PIPER_ARTIFACT_ROOT;
		artifactRoot = await mkdtemp(join(tmpdir(), "piper-cli-runs-"));
		process.env.PIPER_ARTIFACT_ROOT = artifactRoot;
	});

	afterEach(async () => {
		await Promise.all(
			directories.map((directory) => rm(directory, { recursive: true, force: true })),
		);
	});

	afterAll(async () => {
		if (previousArtifactRoot === undefined) {
			delete process.env.PIPER_ARTIFACT_ROOT;
		} else {
			process.env.PIPER_ARTIFACT_ROOT = previousArtifactRoot;
		}
		await rm(artifactRoot, { recursive: true, force: true });
	});

	it("loads a workflow file and executes mock tasks", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const workflowPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			workflowPath,
			`
        import { artifact, parallel, workflow, task } from "@beyland/piper";

        export default function DemoWorkflow() {
          return workflow(
            task({ goal: "Plan", harness: "mock", artifact: "plan" }),
            parallel(
              { status: "waiting" },
              task({ goal: "Implement", harness: "mock", context: [artifact("plan").value()] }),
              task({ goal: "Test", harness: "mock", context: [artifact("plan").value()] })
            )
          );
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli([workflowPath, "--workspace", workspacePath], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
			}),
			stderr: createBufferStream((chunk) => {
				stderr += chunk;
			}),
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("[run] Plan");
		expect(stdout).toContain("      step=step-1  harness=mock  attempt=1");
		expect(stdout).toContain("\n\n      mock attempt 1 started");
		expect(stdout).toContain("mock attempt 1 completed\n\n[done] Successfully completed step-1");
		expect(stdout).not.toContain("  | mock attempt 1 started");
		expect(stdout).not.toContain("[step-1] mock attempt 1 started");
		expect(stdout).toContain("[summary] completed=3 failed=0");
	});

	it("can suppress verbose progress artifact with --quiet", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const workflowPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			workflowPath,
			`
        import { task } from "@beyland/piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", harness: "mock" });
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli([workflowPath, "--workspace", workspacePath, "--quiet"], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
			}),
			stderr: createBufferStream((chunk) => {
				stderr += chunk;
			}),
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("[run] Plan");
		expect(stdout).toContain("step=step-1");
		expect(stdout).not.toContain("      mock attempt 1 started");
		expect(stdout).toContain("[summary] completed=1 failed=0");
	});

	it("registers the Copilot CLI adapter", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const workflowPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			workflowPath,
			`
        import { task } from "@beyland/piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan with Copilot", harness: "copilot" });
        }
      `,
			"utf8",
		);

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = 'node -e "console.log(process.env.COPILOT_GOAL)"';

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli([workflowPath, "--workspace", workspacePath], {
				stdout: createBufferStream((chunk) => {
					stdout += chunk;
				}),
				stderr: createBufferStream((chunk) => {
					stderr += chunk;
				}),
			});

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(stdout).toContain("[done] Successfully completed step-1");
			expect(stdout).toContain("[summary] completed=1 failed=0");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("generates and previews a workflow", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);
		const outputPath = join(workspacePath, "workflows", "generated.piper.ts");

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = createWorkflowGeneratorTemplate();

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli(
				[
					"Create a workflow for fixing tests",
					"--workspace",
					workspacePath,
					"--output",
					outputPath,
					"--dry-run-generated",
				],
				{
					stdout: createBufferStream((chunk) => {
						stdout += chunk;
					}),
					stderr: createBufferStream((chunk) => {
						stderr += chunk;
					}),
				},
			);

			const generated = await readFile(outputPath, "utf8");

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(generated).toContain('goal: "Generated task"');
			expect(stdout).toContain(`[info] Generated workflow written to ${outputPath}`);
			expect(stdout).toContain("[info] Generated workflow dry run");
			expect(stdout).toContain("Step(harness=mock): Generated task");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("can save a generated workflow without loading or executing it", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);
		const outputPath = join(workspacePath, "generated.piper.ts");

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = createWorkflowGeneratorTemplate(
			"export default missingTask;\\n",
		);

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli(
				[
					"Create a workflow for fixing tests",
					"--workspace",
					workspacePath,
					"--output",
					outputPath,
					"--save-only",
				],
				{
					stdout: createBufferStream((chunk) => {
						stdout += chunk;
					}),
					stderr: createBufferStream((chunk) => {
						stderr += chunk;
					}),
				},
			);

			const generated = await readFile(outputPath, "utf8");

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(generated).toBe("export default missingTask;\n");
			expect(stdout).toContain(`[info] Generated workflow written to ${outputPath}`);
			expect(stdout).not.toContain("[info] Generated workflow dry run");
			expect(stdout).not.toContain("[run] Generated task");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("executes a generated workflow when requested", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);
		const outputPath = join(workspacePath, "generated.piper.ts");

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = createWorkflowGeneratorTemplate();

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli(
				[
					"Create a workflow for fixing tests",
					"--workspace",
					workspacePath,
					"--output",
					outputPath,
					"--execute",
				],
				{
					stdout: createBufferStream((chunk) => {
						stdout += chunk;
					}),
					stderr: createBufferStream((chunk) => {
						stderr += chunk;
					}),
				},
			);

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(stdout).toContain(`[info] Generated workflow written to ${outputPath}`);
			expect(stdout).toContain("[run] Generated task");
			expect(stdout).toContain("[summary] completed=1 failed=0");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("treats generate as a prompt instead of a subcommand", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);
		const outputPath = join(workspacePath, "generated.piper.ts");

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = createWorkflowGeneratorTemplate();

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli(
				["generate", "--workspace", workspacePath, "--output", outputPath, "--dry-run-generated"],
				{
					stdout: createBufferStream((chunk) => {
						stdout += chunk;
					}),
					stderr: createBufferStream((chunk) => {
						stderr += chunk;
					}),
				},
			);

			const generated = await readFile(outputPath, "utf8");

			expect(exitCode).toBe(0);
			expect(stderr).toBe("");
			expect(generated).toContain('goal: "Generated task"');
			expect(stdout).toContain(`[info] Generated workflow written to ${outputPath}`);
			expect(stdout).toContain("[info] Generated workflow dry run");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("accepts a leading argument separator before the workflow path", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const workflowPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			workflowPath,
			`
        import { task } from "@beyland/piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", harness: "mock" });
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli(["--", workflowPath, "--dry-run"], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
			}),
			stderr: createBufferStream((chunk) => {
				stderr += chunk;
			}),
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("[info] Dry run");
		expect(stdout).toContain("Step(harness=mock): Plan");
	});

	it("prints help when no workflow path is provided", async () => {
		let stdout = "";
		let stderr = "";
		const exitCode = await runCli([], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
			}),
			stderr: createBufferStream((chunk) => {
				stderr += chunk;
			}),
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("Usage: piper <prompt> [options]");
		expect(stdout).toContain("--workspace <path>");
		expect(stdout).toContain("--quiet");
		expect(stdout).toContain("--save-only");
		expect(stdout).toContain("--help");
		expect(stdout).toContain("Examples:");
		expect(stdout).toContain('piper "Fix the failing tests"');
		expect(stdout).toContain("piper examples/simple-task.piper.ts --dry-run");
		expect(stdout).toContain("pnpm exec piper examples/simple-task.piper.ts --workspace .");
	});

	it("prints the compiled workflow module", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const workflowPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			workflowPath,
			`
        import { task } from "@beyland/piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", harness: "mock" });
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli([workflowPath, "--print-compiled"], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
			}),
			stderr: createBufferStream((chunk) => {
				stderr += chunk;
			}),
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("function DemoWorkflow");
		expect(stdout).toContain('goal: "Plan"');
	});

	it("cancels an in-flight run on SIGINT", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const workflowPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			workflowPath,
			`
        import { task } from "@beyland/piper";

        export default function DemoWorkflow() {
          return task({ goal: "Long task", harness: "mock", artifact: "result" });
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		let sendInterrupt: (() => void) | undefined;
		const signalTarget = new EventEmitter();
		const started = new Promise<void>((resolve) => {
			sendInterrupt = resolve;
		});

		const run = runCli([workflowPath, "--workspace", workspacePath], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
				if (chunk.includes("[run] Long task")) {
					sendInterrupt?.();
				}
			}),
			stderr: createBufferStream((chunk) => {
				stderr += chunk;
			}),
			signalTarget,
		});

		await started;
		signalTarget.emit("SIGINT");

		await expect(run).resolves.toBe(130);
		expect(stdout).toContain("[run] Long task");
		expect(stdout).toContain("step=step-1");
		expect(stderr).toContain("[cancel] Received SIGINT; cancelling in-flight tasks...");
	});
});
