import { Writable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli/index.js";

function createBufferStream(onChunk: (chunk: string) => void): Writable {
  return new Writable({
    write(chunk, _encoding, callback) {
      onChunk(chunk.toString());
      callback();
    }
  });
}

describe("CLI end-to-end", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("loads a workflow file and executes mock tasks", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.agent.ts");
    await writeFile(
      workflowPath,
      `
        import { output, parallel, sequence, task } from "piper";

        export default function DemoWorkflow() {
          return sequence(
            task({ goal: "Plan", agent: "mock", output: "plan" }),
            parallel(
              { fallback: "waiting" },
              task({ goal: "Implement", agent: "mock", context: [output("plan")] }),
              task({ goal: "Test", agent: "mock", context: [output("plan")] })
            )
          );
        }
      `,
      "utf8"
    );

    let stdout = "";
    let stderr = "";
    const exitCode = await runCli([workflowPath, "--workspace", workspacePath], {
      stdout: createBufferStream((chunk) => {
        stdout += chunk;
      }),
      stderr: createBufferStream((chunk) => {
        stderr += chunk;
      })
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("[summary] completed=3 failed=0");
  });

  it("registers the Copilot CLI adapter", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.agent.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan with Copilot", agent: "copilot" });
        }
      `,
      "utf8"
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
        })
      });

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toContain("[done] task-1 Plan with Copilot");
      expect(stdout).toContain("[summary] completed=1 failed=0");
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

    const workflowPath = join(workspacePath, "demo.agent.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", agent: "mock" });
        }
      `,
      "utf8"
    );

    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(["--", workflowPath, "--dry-run"], {
      stdout: createBufferStream((chunk) => {
        stdout += chunk;
      }),
      stderr: createBufferStream((chunk) => {
        stderr += chunk;
      })
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("[info] Dry run");
    expect(stdout).toContain("Task(agent=mock): Plan");
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
      })
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Usage: piper <workflow.agent.ts> [options]");
    expect(stdout).toContain("--workspace <path>");
    expect(stdout).toContain("--help");
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("piper examples/simple-task.agent.ts --dry-run");
    expect(stdout).toContain("pnpm run piper -- examples/simple-task.agent.ts --workspace .");
  });

  it("prints the compiled workflow module", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.agent.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", agent: "mock" });
        }
      `,
      "utf8"
    );

    let stdout = "";
    let stderr = "";
    const exitCode = await runCli([workflowPath, "--print-compiled"], {
      stdout: createBufferStream((chunk) => {
        stdout += chunk;
      }),
      stderr: createBufferStream((chunk) => {
        stderr += chunk;
      })
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("function DemoWorkflow");
    expect(stdout).toContain('goal: "Plan"');
  });
});
