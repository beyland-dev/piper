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
    const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.agent.ts");
    await writeFile(
      workflowPath,
      `
        import { output, parallel, sequence, task } from "agent-runtime";

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

  it("accepts a leading argument separator before the workflow path", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.agent.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "agent-runtime";

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
    expect(stdout).toContain("task(agent=mock): Plan");
  });

  it("prints the compiled workflow module", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-cli-"));
    directories.push(workspacePath);

    const workflowPath = join(workspacePath, "demo.agent.ts");
    await writeFile(
      workflowPath,
      `
        import { task } from "agent-runtime";

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
