import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockAdapter, Recover, Task, WorkflowExecutor } from "../src/index.js";

describe("Recover", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("runs fallback recovery work and retries the failed branch", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-recover-"));
    directories.push(workspacePath);

    // resolveBehavior tracks global starts so the second invocation of "Unstable task"
    // (triggered by Recover's retry) succeeds even though each new handle starts at attempt 1.
    let unstableStarts = 0;
    const adapter = new MockAdapter({
      resolveBehavior: ({ goal }) => {
        if (goal === "Unstable task") {
          unstableStarts += 1;
          return unstableStarts === 1
            ? { failOnAttempt: 1, output: "Recovered result" }
            : { output: "Recovered result" };
        }
        return undefined;
      },
      behaviors: {
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
      Recover({
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
