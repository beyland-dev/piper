import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockAdapter, WorkflowExecutor, protect, task } from "../src/index.js";

async function createGitWorkspace(): Promise<string> {
  const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-protect-"));
  execFileSync("git", ["init"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspacePath });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: workspacePath });
  await writeFile(join(workspacePath, "auth_legacy.ts"), "export const legacy = true;\n", "utf8");
  execFileSync("git", ["add", "auth_legacy.ts"], { cwd: workspacePath });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: workspacePath });
  return workspacePath;
}

describe("Protect", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("retries when a protected file is modified and restores the protected file", async () => {
    const workspacePath = await createGitWorkspace();
    directories.push(workspacePath);

    const adapter = new MockAdapter({
      resolveBehavior: ({ attempt }) => {
        if (attempt === 1) {
          return {
            modifiedFiles: [
              {
                path: "auth_legacy.ts",
                content: "export const legacy = false;\n"
              }
            ]
          };
        }

        return {
          modifiedFiles: [
            {
              path: "safe-review.txt",
              content: "reviewed\n"
            }
          ],
          output: "Review completed safely"
        };
      }
    });

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [adapter],
      taskRetryLimit: 1
    });

    await executor.execute(
      protect(
        { protectedFiles: ["auth_legacy.ts"] },
        task({ goal: "Review task", agent: "mock" })
      )
    );

    const protectedFile = await readFile(join(workspacePath, "auth_legacy.ts"), "utf8");
    expect(protectedFile).toBe("export const legacy = true;\n");
    expect(adapter.history).toHaveLength(2);
  });
});
