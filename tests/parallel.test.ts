import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockAdapter, WorkflowExecutor, parallel, task } from "../src/index.js";

describe("Parallel", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("runs child tasks concurrently", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-parallel-"));
    directories.push(workspacePath);

    const adapter = new MockAdapter({
      behaviors: {
        "Task A": { delayMs: 80 },
        "Task B": { delayMs: 80 }
      }
    });

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [adapter],
      taskRetryLimit: 0
    });

    const start = Date.now();
    await executor.execute(
      parallel(
        task({ goal: "Task A", agent: "mock" }),
        task({ goal: "Task B", agent: "mock" })
      )
    );
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(150);
  });
});
