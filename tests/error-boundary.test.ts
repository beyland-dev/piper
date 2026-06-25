import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ErrorBoundary, MockAdapter, Task, WorkflowExecutor } from "../src/index.js";

describe("ErrorBoundary", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("runs fallback recovery work and retries the failed branch", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-boundary-"));
    directories.push(workspacePath);

    const adapter = new MockAdapter({
      behaviors: {
        "Unstable task": {
          failOnAttempt: 1,
          output: "Recovered result"
        },
        "Recovery task": {
          output: "Recovery complete"
        }
      }
    });

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [adapter],
      taskRetryLimit: 0
    });

    const summary = await executor.execute(
      ErrorBoundary({
        maxRetries: 1,
        fallback: (_error, retry) =>
          Task({
            goal: "Recovery task",
            agent: "mock",
            "on:complete": () => retry()
          }),
        children: [Task({ goal: "Unstable task", agent: "mock", output: "result" })]
      })
    );

    expect(summary.outputs.result).toBe("Recovered result");
    expect(adapter.history.filter((entry) => entry.goal === "Unstable task")).toHaveLength(2);
  });
});
