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

function createLoopGeneratorTemplate(
	source = 'import { step } from "@beyland/piper";\\n\\nexport default step({ goal: "Generated step", harness: "mock" });\\n',
): string {
	const script = [
		'const fs = require("node:fs");',
		'const path = require("node:path");',
		'const context = process.env.AGENT_CONTEXT ?? "";',
		"const match = context.match(/Target loop path:\\n([^\\n]+)/);",
		'if (!match) throw new Error("missing target loop path");',
		`const source = \`${source}\`;`,
		"fs.mkdirSync(path.dirname(match[1]), { recursive: true });",
		'fs.writeFileSync(match[1], source, "utf8");',
		'console.log("generated loop");',
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

	it("loads a loop file and executes mock steps", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const loopPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			loopPath,
			`
        import { artifact, loop, parallel, step } from "@beyland/piper";

        export default function DemoLoop() {
          return loop(
            { objective: "Run demo loop" },
            step({ goal: "Plan", harness: "mock", produces: "plan" }),
            parallel(
              { status: "waiting" },
              step({ goal: "Implement", harness: "mock", context: [artifact("plan").value()] }),
              step({ goal: "Test", harness: "mock", context: [artifact("plan").value()] })
            )
          );
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli([loopPath, "--workspace", workspacePath], {
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
		expect(stdout).toContain("      id=step-1  harness=mock  attempt=1");
		expect(stdout).toContain("\n\n      mock attempt 1 started");
		expect(stdout).toContain("mock attempt 1 completed\n\n[done] Successfully completed step-1");
		expect(stdout).not.toContain("  | mock attempt 1 started");
		expect(stdout).not.toContain("[step-1] mock attempt 1 started");
		expect(stdout).toContain("[summary] completed=3 failed=0");
	});

	it("can suppress verbose progress artifact with --quiet", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const loopPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			loopPath,
			`
        import { step } from "@beyland/piper";

        export default function DemoLoop() {
          return step({ goal: "Plan", harness: "mock" });
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli([loopPath, "--workspace", workspacePath, "--quiet"], {
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
		expect(stdout).toContain("id=step-1");
		expect(stdout).not.toContain("      mock attempt 1 started");
		expect(stdout).toContain("[summary] completed=1 failed=0");
	});

	it("registers the Copilot CLI adapter", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const loopPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			loopPath,
			`
        import { step } from "@beyland/piper";

        export default function DemoLoop() {
          return step({ goal: "Plan with Copilot", harness: "copilot" });
        }
      `,
			"utf8",
		);

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = 'node -e "console.log(process.env.COPILOT_GOAL)"';

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli([loopPath, "--workspace", workspacePath], {
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

	it("generates and previews a loop", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);
		const outputPath = join(workspacePath, "loops", "generated.piper.ts");

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = createLoopGeneratorTemplate();

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli(
				[
					"Create a loop for fixing tests",
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
			expect(generated).toContain('goal: "Generated step"');
			expect(stdout).toContain(`[info] Generated loop written to ${outputPath}`);
			expect(stdout).toContain("[info] Generated loop dry run");
			expect(stdout).toContain("Step(harness=mock): Generated step");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("can save a generated loop without loading or executing it", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);
		const outputPath = join(workspacePath, "generated.piper.ts");

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = createLoopGeneratorTemplate(
			"export default missingStep;\\n",
		);

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli(
				[
					"Create a loop for fixing tests",
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
			expect(generated).toBe("export default missingStep;\n");
			expect(stdout).toContain(`[info] Generated loop written to ${outputPath}`);
			expect(stdout).not.toContain("[info] Generated loop dry run");
			expect(stdout).not.toContain("[run] Generated step");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("executes a generated loop when requested", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);
		const outputPath = join(workspacePath, "generated.piper.ts");

		const previousTemplate = process.env.COPILOT_COMMAND_TEMPLATE;
		process.env.COPILOT_COMMAND_TEMPLATE = createLoopGeneratorTemplate();

		try {
			let stdout = "";
			let stderr = "";
			const exitCode = await runCli(
				[
					"Create a loop for fixing tests",
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
			expect(stdout).toContain(`[info] Generated loop written to ${outputPath}`);
			expect(stdout).toContain("[run] Generated step");
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
		process.env.COPILOT_COMMAND_TEMPLATE = createLoopGeneratorTemplate();

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
			expect(generated).toContain('goal: "Generated step"');
			expect(stdout).toContain(`[info] Generated loop written to ${outputPath}`);
			expect(stdout).toContain("[info] Generated loop dry run");
		} finally {
			if (previousTemplate === undefined) {
				delete process.env.COPILOT_COMMAND_TEMPLATE;
			} else {
				process.env.COPILOT_COMMAND_TEMPLATE = previousTemplate;
			}
		}
	});

	it("accepts a leading argument separator before the loop path", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const loopPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			loopPath,
			`
        import { step } from "@beyland/piper";

        export default function DemoLoop() {
          return step({ goal: "Plan", harness: "mock" });
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli(["--", loopPath, "--dry-run"], {
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

	it("prints help when no loop path is provided", async () => {
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
		expect(stdout).toContain("piper examples/simple-loop.piper.ts --dry-run");
		expect(stdout).toContain("pnpm exec piper examples/simple-loop.piper.ts --workspace .");
	});

	it("prints the compiled loop module", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const loopPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			loopPath,
			`
        import { step } from "@beyland/piper";

        export default function DemoLoop() {
          return step({ goal: "Plan", harness: "mock" });
        }
      `,
			"utf8",
		);

		let stdout = "";
		let stderr = "";
		const exitCode = await runCli([loopPath, "--print-compiled"], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
			}),
			stderr: createBufferStream((chunk) => {
				stderr += chunk;
			}),
		});

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("function DemoLoop");
		expect(stdout).toContain('goal: "Plan"');
	});

	it("cancels an in-flight run on SIGINT", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
		directories.push(workspacePath);

		const loopPath = join(workspacePath, "demo.piper.ts");
		await writeFile(
			loopPath,
			`
        import { step } from "@beyland/piper";

        export default function DemoLoop() {
          return step({ goal: "Long step", harness: "mock", produces: "result" });
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

		const run = runCli([loopPath, "--workspace", workspacePath], {
			stdout: createBufferStream((chunk) => {
				stdout += chunk;
				if (chunk.includes("[run] Long step")) {
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
		expect(stdout).toContain("[run] Long step");
		expect(stdout).toContain("id=step-1");
		expect(stderr).toContain("[cancel] Received SIGINT; cancelling in-flight steps...");
	});
});
