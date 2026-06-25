#!/usr/bin/env node

import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

import { MockAdapter } from "../adapters/mock-adapter.js";
import { PiAdapter } from "../adapters/pi-adapter.js";
import { normalizeTree } from "../core/node-utils.js";
import type { TaskNode } from "../core/types.js";
import { WorkflowExecutor } from "../runtime/executor.js";
import { CliReporter, formatTaskTree } from "./output.js";

interface CliOptions {
  workflowPath: string;
  workspacePath: string;
  verbose: boolean;
  dryRun: boolean;
  printCompiled: boolean;
}

interface RunCliOptions {
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  cwd?: string;
}

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
  if (!workflowArg) {
    throw new Error("Usage: agent-run <workflow.agent.ts> [--workspace <path>] [--verbose] [--dry-run] [--print-compiled]");
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

    throw new Error(`Unknown argument: ${current}`);
  }

  return {
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
        name: "agent-runtime-self-alias",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^agent-runtime$/ }, () => ({
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
  const parsed = parseArguments(argv, cwd);
  const reporter = new CliReporter({
    verbose: parsed.verbose,
    stdout: options.stdout,
    stderr: options.stderr
  });

  try {
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
