#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants as fsConstants, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

import { MockAdapter } from "../adapters/mock-adapter.js";
import { CopilotCliAdapter } from "../adapters/copilot-cli-adapter.js";
import { PiAdapter } from "../adapters/pi-adapter.js";
import { normalizeTree } from "../core/node-utils.js";
import type { TaskNode } from "../core/types.js";
import { WorkflowExecutor } from "../runtime/executor.js";
import { CliReporter, formatTaskTree } from "./output.js";

interface RunOptions {
  workflowPath: string;
  workspacePath: string;
  verbose: boolean;
  dryRun: boolean;
  printCompiled: boolean;
}

type CliOptions =
  | {
      kind: "help";
    }
  | ({
      kind: "run";
    } & RunOptions);

interface RunCliOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  cwd?: string;
}

const HELP_TEXT = `Usage: piper <workflow.agent.ts> [options]

Compile and run a Piper workflow.

Arguments:
  workflow.agent.ts       Path to the workflow module.

Options:
  --workspace <path>      Workspace directory for task execution. Defaults to the current directory.
  --verbose               Print verbose runtime output.
  --dry-run               Print the task tree without executing it.
  --print-compiled        Print the bundled workflow module without executing it.
  -h, --help              Show this help information.

Examples:
  piper examples/simple-task.agent.ts
      Run a workflow using the current directory as the workspace.

  piper examples/simple-task.agent.ts --workspace .
      Run a workflow with an explicit workspace directory.

  piper examples/simple-task.agent.ts --dry-run
      Preview the task tree without executing tasks.

  piper examples/simple-task.agent.ts --verbose
      Include verbose runtime output while tasks execute.

  piper examples/simple-task.agent.ts --print-compiled
      Inspect the bundled workflow module without executing it.

  pnpm run piper -- examples/simple-task.agent.ts --workspace .
      Forward arguments through a package manager script.`;

async function resolveRuntimeEntry(relativeBase: string): Promise<string> {
  const sourceCandidate = new URL(`../${relativeBase}.ts`, import.meta.url);
  try {
    await access(sourceCandidate, fsConstants.F_OK);
    return fileURLToPath(sourceCandidate);
  } catch {
    return fileURLToPath(new URL(`../${relativeBase}.js`, import.meta.url));
  }
}

function parseArguments(argv: string[], cwd: string): CliOptions {
  const values = [...argv];

  // Package managers may forward a literal `--` separator to the script.
  while (values[0] === "--") {
    values.shift();
  }

  const workflowArg = values.shift();
  if (!workflowArg || workflowArg === "-h" || workflowArg === "--help") {
    return { kind: "help" };
  }

  let workspacePath = cwd;
  let verbose = false;
  let dryRun = false;
  let printCompiled = false;

  while (values.length > 0) {
    const current = values.shift();
    if (current === "--workspace") {
      const workspaceArg = values.shift();
      if (!workspaceArg) {
        throw new Error("Missing value for --workspace");
      }
      workspacePath = resolve(cwd, workspaceArg);
      continue;
    }

    if (current === "--verbose") {
      verbose = true;
      continue;
    }

    if (current === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (current === "--print-compiled") {
      printCompiled = true;
      continue;
    }

    if (current === "-h" || current === "--help") {
      return { kind: "help" };
    }

    throw new Error(`Unknown argument: ${current}`);
  }

  return {
    kind: "run",
    workflowPath: resolve(cwd, workflowArg),
    workspacePath,
    verbose,
    dryRun,
    printCompiled
  };
}

async function compileWorkflow(workflowPath: string): Promise<string> {
  const runtimeEntry = await resolveRuntimeEntry("index");

  const buildResult = await build({
    entryPoints: [workflowPath],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "piper-self-alias",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^(agent-runtime|piper)$/ }, () => ({
            path: runtimeEntry
          }));
        }
      }
    ]
  });

  const contents = buildResult.outputFiles[0]?.text;
  if (!contents) {
    throw new Error(`Failed to compile workflow: ${workflowPath}`);
  }

  return contents;
}

async function loadWorkflow(workflowPath: string): Promise<TaskNode> {
  const contents = await compileWorkflow(workflowPath);

  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(contents)}`;
  const module = await import(moduleUrl);
  const exported = module.default;

  if (!exported) {
    throw new Error("Workflow module must export a default task tree or default function.");
  }

  const tree = typeof exported === "function" ? exported() : exported;
  return normalizeTree(tree);
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();

  try {
    const parsed = parseArguments(argv, cwd);

    if (parsed.kind === "help") {
      (options.stdout ?? process.stdout).write(`${HELP_TEXT}\n`);
      return 0;
    }

    const reporter = new CliReporter({
      verbose: parsed.verbose,
      stdout: options.stdout,
      stderr: options.stderr
    });

    if (parsed.printCompiled) {
      (options.stdout ?? process.stdout).write(`${await compileWorkflow(parsed.workflowPath)}\n`);
      return 0;
    }

    const taskTree = await loadWorkflow(parsed.workflowPath);

    if (parsed.dryRun) {
      reporter.info("Dry run");
      reporter.info(formatTaskTree(taskTree));
      return 0;
    }

    const executor = new WorkflowExecutor({
      workspacePath: parsed.workspacePath,
      taskRetryLimit: 3,
      reporter,
      adapters: [
        new PiAdapter({
          command: process.env.PI_COMMAND ?? "pi",
          commandTemplate: process.env.PI_COMMAND_TEMPLATE
        }),
        new CopilotCliAdapter({
          command: process.env.COPILOT_COMMAND ?? "copilot",
          commandTemplate: process.env.COPILOT_COMMAND_TEMPLATE
        }),
        new MockAdapter()
      ]
    });

    await executor.execute(taskTree);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (options.stderr ?? process.stderr).write(`${message}\n`);
    return 1;
  }
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
}

if (isCliEntrypoint()) {
  void main();
}
