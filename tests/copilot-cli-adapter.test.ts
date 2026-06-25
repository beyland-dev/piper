import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CopilotCliAdapter } from "../src/index.js";

describe("CopilotCliAdapter", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("runs a configured Copilot CLI command with task environment", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-"));
    directories.push(workspacePath);

    const adapter = new CopilotCliAdapter({
      commandTemplate:
        'node -e "console.log(process.env.COPILOT_GOAL); console.log(process.env.COPILOT_CONTEXT); console.log(process.env.AGENT_WORKSPACE)"'
    });

    const handle = adapter.startTask({
      goal: "Create a plan",
      context: ["Use tests"],
      workspacePath
    });

    await expect(handle.completed).resolves.toMatchObject({
      output: `Create a plan\nUse tests\n${workspacePath}`
    });
  });

  it("passes retry feedback to subsequent attempts", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-copilot-"));
    directories.push(workspacePath);

    const adapter = new CopilotCliAdapter({
      commandTemplate:
        'node -e "if (process.env.AGENT_ATTEMPT === \'1\') { console.error(\'needs retry\'); process.exit(1); } console.log(process.env.COPILOT_RETRY_REASON)"'
    });

    const handle = adapter.startTask({
      goal: "Create a plan",
      context: [],
      workspacePath
    });

    await expect(handle.errored).resolves.toMatchObject({
      message: "copilot exited with code 1",
      retryable: true
    });

    adapter.retry(handle, ["Retry with more detail"]);

    await expect(handle.completed).resolves.toMatchObject({
      output: "Retry with more detail"
    });
  });
});
