import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockAdapter, WorkflowExecutor, output, parallel, task } from "../src/index.js";

function withTimeout<T>(promise: Promise<T>, timeoutMs = 200): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

describe("output dependencies", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("fails fast when output references an undeclared output", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-output-deps-"));
    directories.push(workspacePath);

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [new MockAdapter()],
      taskRetryLimit: 0
    });

    await expect(
      withTimeout(
        executor.execute(task({ goal: "Implement feature", agent: "mock", context: [output("missing")] })),
        150
      )
    ).rejects.toThrow('Unknown output "missing". No task declares output="missing".');
  });

  it("includes a fix hint for unknown outputs", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-output-deps-"));
    directories.push(workspacePath);

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [new MockAdapter()],
      taskRetryLimit: 0
    });

    await expect(
      withTimeout(
        executor.execute(task({ goal: "Implement feature", agent: "mock", context: [output("missing")] })),
        150
      )
    ).rejects.toThrow('Add or fix output="missing" on an upstream task.');
  });

  it("rejects waiting output consumers when the producer task fails", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-output-deps-"));
    directories.push(workspacePath);

    const adapter = new MockAdapter({
      resolveBehavior: ({ goal }) => {
        if (goal === "Create plan") {
          return {
            failOnAttempt: 1,
            retryable: false,
            errorMessage: "Plan task failed"
          };
        }

        if (goal === "Implement feature") {
          return {
            output: "Done"
          };
        }

        return undefined;
      }
    });

    const executor = new WorkflowExecutor({
      workspacePath,
      adapters: [adapter],
      taskRetryLimit: 0
    });

    await expect(
      withTimeout(
        executor.execute(
          parallel(
            task({ goal: "Create plan", agent: "mock", output: "plan" }),
            task({ goal: "Implement feature", agent: "mock", context: [output("plan")] })
          )
        ),
        200
      )
    ).rejects.toThrow("Plan task failed");

    const outputs = (executor as unknown as {
      outputs: { waitForOutput(name: string): Promise<string> };
    }).outputs;

    await expect(withTimeout(outputs.waitForOutput("plan"), 100)).rejects.toThrow(
      'Output "plan" was not produced because its task failed.'
    );
  });
});
