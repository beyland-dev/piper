import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MockAdapter } from "../src/index.js";

describe("MockAdapter", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("supports retrying a failed attempt and writing files", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "piper-mock-"));
    directories.push(workspacePath);

    const adapter = new MockAdapter({
      behaviors: {
        "Write file": {
          failOnAttempt: 1,
          modifiedFiles: [
            {
              path: "result.txt",
              content: "written\n"
            }
          ],
          output: "Done"
        }
      }
    });

    const handle = adapter.startTask({
      goal: "Write file",
      context: [],
      workspacePath
    });

    await expect(handle.errored).resolves.toMatchObject({
      retryable: true
    });

    adapter.retry(handle, ["retry"]);
    await expect(handle.completed).resolves.toMatchObject({
      output: "Done"
    });

    const contents = await readFile(join(workspacePath, "result.txt"), "utf8");
    expect(contents).toBe("written\n");
  });
});
