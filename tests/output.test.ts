import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockAdapter, WorkflowExecutor, output, task } from "../src/index.js";

describe("output", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("passes named output into downstream task context", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "agent-runtime-output-"));
    directories.push(workspacePath);

    const adapter = new MockAdapter({
      behaviors: {
        "Create plan": {
          output: "OAuth plan"
        },
        "Implement feature": {
          output: "Done"
        }
      }
    });

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [adapter],
      taskRetryLimit: 0
    });

    await executor.execute([
      task({ goal: "Create plan", agent: "mock", output: "plan" }),
      task({ goal: "Implement feature", agent: "mock", context: [output("plan")] })
    ]);

    const downstreamAttempt = adapter.history.find((entry) => entry.goal === "Implement feature");
    expect(downstreamAttempt?.context).toEqual(["OAuth plan"]);
  });
});
