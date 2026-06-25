import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockAdapter, WorkflowExecutor, task } from "../src/index.js";

describe("Task", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("runs a single task and captures its named output", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-task-"));
    directories.push(workspacePath);

    const adapter = new MockAdapter({
      behaviors: {
        "Create a plan": {
          output: "Plan output"
        }
      }
    });

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [adapter],
      taskRetryLimit: 0
    });

    const summary = await executor.execute(
      task({
        goal: "Create a plan",
        agent: "mock",
        output: "plan"
      })
    );

    expect(summary.completedTasks).toBe(1);
    expect(summary.outputs.plan).toBe("Plan output");
  });
});
