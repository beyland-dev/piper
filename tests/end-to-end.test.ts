import { Writable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

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
  let artifactRoot: string;
  let previousArtifactRoot: string | undefined;

  beforeAll(async () => {
    previousArtifactRoot = process.env.PIPER_ARTIFACT_ROOT;
    artifactRoot = await mkdtemp(join(tmpdir(), "piper-cli-runs-"));
    process.env.PIPER_ARTIFACT_ROOT = artifactRoot;
  });

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
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
        import { artifact, parallel, workflow, task } from "piper";

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
    expect(stdout).toContain("[task-1] mock attempt 1 started");
    expect(stdout).toContain("[summary] completed=3 failed=0");
  });

  it("can suppress verbose progress artifact with --quiet", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.piper.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", harness: "mock" });
        }
      `,
      "utf8"
    );

    let stdout = "";
    let stderr = "";
    const exitCode = await runCli([workflowPath, "--workspace", workspacePath, "--quiet"], {
      stdout: createBufferStream((chunk) => {
        stdout += chunk;
      }),
      stderr: createBufferStream((chunk) => {
        stderr += chunk;
      })
    });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("[run] task-1");
    expect(stdout).not.toContain("[task-1] mock attempt 1 started");
    expect(stdout).toContain("[summary] completed=1 failed=0");
  });

  it("registers the Copilot CLI adapter", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.piper.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan with Copilot", harness: "copilot" });
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

    const workflowPath = join(workspacePath, "demo.piper.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", harness: "mock" });
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
    expect(stdout).toContain("Task(harness=mock): Plan");
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
    expect(stdout).toContain("Usage: piper <workflow.piper.ts> [options]");
    expect(stdout).toContain("--workspace <path>");
    expect(stdout).toContain("--quiet");
    expect(stdout).toContain("--help");
    expect(stdout).toContain("Examples:");
    expect(stdout).toContain("piper examples/simple-task.piper.ts --dry-run");
    expect(stdout).toContain("pnpm run piper -- examples/simple-task.piper.ts --workspace .");
  });

  it("prints the compiled workflow module", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.piper.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "piper";

        export default function DemoWorkflow() {
          return task({ goal: "Plan", harness: "mock" });
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
