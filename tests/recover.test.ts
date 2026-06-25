import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockHarness, PiperOrchestrator, recover, task } from "../src/index.js";

describe("Recover", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("runs fallback recovery work and retries the failed branch", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-recover-"));
    directories.push(workspacePath);

    // resolveBehavior tracks global starts so the second invocation of "Unstable task"
    // (triggered by Recover's retry) succeeds even though each new handle starts at attempt 1.
    let unstableStarts = 0;
    const adapter = new MockHarness({
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

    const executor = new PiperOrchestrator({
      workspacePath,
      harnesses: [adapter],
      taskRetryLimit: 0,
      artifactStorage: false
    });

    const summary = await executor.execute(
      recover(
        {
          maxRetries: 1,
          onFailure: (_error, retry) =>
            task({
              goal: "Recovery task",
              harness: "mock",
              "on:complete": () => retry()
            })
        },
        task({ goal: "Unstable task", harness: "mock", artifact: "result" })
      )
    );

    expect(summary.artifacts.result).toBe("Recovered result");
    expect(adapter.history.filter((entry) => entry.goal === "Unstable task")).toHaveLength(2);
  });
});
