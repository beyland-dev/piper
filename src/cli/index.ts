#!/usr/bin/env node

import { constants as fsConstants, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { CopilotAhpHarness } from "../adapters/copilot-ahp-adapter.js";
import { CopilotCliHarness } from "../adapters/copilot-cli-adapter.js";
import { MockHarness } from "../adapters/mock-adapter.js";
import { PiHarness } from "../adapters/pi-adapter.js";
import type { HarnessAdapter } from "../core/types.js";
import { normalizeTree } from "../core/node-utils.js";
import type { TaskNode } from "../core/types.js";
import { isPiperCancellationError, PiperOrchestrator } from "../runtime/executor.js";
import { CliReporter, formatTaskTree } from "./output.js";

const CANCELLATION_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type CancellationSignal = (typeof CANCELLATION_SIGNALS)[number];

interface SignalTarget {
	on(event: CancellationSignal, listener: () => void): unknown;
	off(event: CancellationSignal, listener: () => void): unknown;
}

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
	signalTarget?: SignalTarget;
}

const HELP_TEXT = `Usage: piper <workflow.piper.ts> [options]

Compile and run a Piper workflow.

Arguments:
  workflow.piper.ts       Path to the workflow module.

Options:
  --workspace <path>      Workspace directory for task execution. Defaults to the current directory.
  --quiet                 Print only high-level runtime artifact.
  --verbose               Print verbose runtime artifact. This is the default.
  --dry-run               Print the task tree without executing it.
  --print-compiled        Print the bundled workflow module without executing it.
  -h, --help              Show this help information.

Examples:
  piper examples/simple-task.piper.ts
      Run a workflow using the current directory as the workspace.

  piper examples/simple-task.piper.ts --workspace .
      Run a workflow with an explicit workspace directory.

  piper examples/simple-task.piper.ts --dry-run
      Preview the task tree without executing tasks.

  piper examples/simple-task.piper.ts --quiet
      Suppress verbose progress artifact while tasks execute.

  piper examples/simple-task.piper.ts --print-compiled
      Inspect the bundled workflow module without executing it.

  pnpm exec piper examples/simple-task.piper.ts --workspace .
      Run an installed Piper CLI through a package manager.`;

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
	let verbose = true;
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

		if (current === "--quiet") {
			verbose = false;
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
		printCompiled,
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
					pluginBuild.onResolve({ filter: /^@beyland\/piper$/ }, () => ({
						path: runtimeEntry,
					}));
				},
			},
		],
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

function exitCodeForSignal(signal: NodeJS.Signals | undefined): number {
	if (signal === "SIGINT") {
		return 130;
	}

	if (signal === "SIGTERM") {
		return 143;
	}

	return 1;
}

function readBooleanEnv(name: string): boolean | undefined {
	const value = process.env[name];
	if (value === undefined) {
		return undefined;
	}

	if (value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes") {
		return true;
	}

	if (value === "0" || value.toLowerCase() === "false" || value.toLowerCase() === "no") {
		return false;
	}

	throw new Error(`${name} must be one of: 1, 0, true, false, yes, no`);
}

function createCopilotHarness(): HarnessAdapter {
	const harness = process.env.PIPER_COPILOT_HARNESS ?? "cli";
	switch (harness) {
		case "cli":
			return new CopilotCliHarness({
				command: process.env.COPILOT_COMMAND ?? "copilot",
				commandTemplate: process.env.COPILOT_COMMAND_TEMPLATE,
			});
		case "ahp":
			return new CopilotAhpHarness({
				address: process.env.COPILOT_AHP_ADDRESS,
				codeCommand: process.env.COPILOT_AHP_CODE_COMMAND,
				autoStartAgentHost: readBooleanEnv("COPILOT_AHP_AUTO_START"),
			});
		default:
			throw new Error("PIPER_COPILOT_HARNESS must be either \"cli\" or \"ahp\"");
	}
}

function installCancellationHandlers(params: {
	orchestrator: PiperOrchestrator;
	stderr: NodeJS.WritableStream;
	signalTarget: SignalTarget;
}): {
	dispose: () => void;
	settle: () => Promise<void>;
} {
	const handlers = new Map<CancellationSignal, () => void>();
	let cancellationPromise: Promise<void> | null = null;
	let cancellationError: unknown;

	const requestCancellation = (signal: CancellationSignal) => {
		if (cancellationPromise) {
			return;
		}

		params.stderr.write(`[cancel] Received ${signal}; cancelling in-flight tasks...\n`);
		cancellationPromise = params.orchestrator
			.cancel(`Received ${signal}; cancelling Piper run.`, signal)
			.catch((error: unknown) => {
				cancellationError = error;
			});
	};

	for (const signal of CANCELLATION_SIGNALS) {
		const handler = () => requestCancellation(signal);
		handlers.set(signal, handler);
		params.signalTarget.on(signal, handler);
	}

	return {
		dispose: () => {
			for (const [signal, handler] of handlers) {
				params.signalTarget.off(signal, handler);
			}
		},
		settle: async () => {
			await cancellationPromise;
			if (cancellationError) {
				throw cancellationError;
			}
		},
	};
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
	const cwd = options.cwd ?? process.cwd();

	try {
		const parsed = parseArguments(argv, cwd);

		if (parsed.kind === "help") {
			(options.stdout ?? process.stdout).write(`${HELP_TEXT}\n`);
			return 0;
		}

		const hooks = new CliReporter({
			verbose: parsed.verbose,
			stdout: options.stdout,
			stderr: options.stderr,
		});

		if (parsed.printCompiled) {
			(options.stdout ?? process.stdout).write(`${await compileWorkflow(parsed.workflowPath)}\n`);
			return 0;
		}

		const taskTree = await loadWorkflow(parsed.workflowPath);

		if (parsed.dryRun) {
			hooks.info("Dry run");
			hooks.info(formatTaskTree(taskTree));
			return 0;
		}

		const orchestrator = new PiperOrchestrator({
			workspacePath: parsed.workspacePath,
			taskRetryLimit: 3,
			hooks,
			artifactStorage: process.env.PIPER_ARTIFACT_ROOT
				? { rootDir: process.env.PIPER_ARTIFACT_ROOT }
				: undefined,
			harnesses: [
				new PiHarness({
					command: process.env.PI_COMMAND ?? "pi",
					commandTemplate: process.env.PI_COMMAND_TEMPLATE,
				}),
				createCopilotHarness(),
				new MockHarness(),
			],
		});

		const signalCancellation = installCancellationHandlers({
			orchestrator,
			stderr: options.stderr ?? process.stderr,
			signalTarget: options.signalTarget ?? process,
		});

		try {
			await orchestrator.execute(taskTree);
			await signalCancellation.settle();
		} catch (error) {
			await signalCancellation.settle();
			if (isPiperCancellationError(error)) {
				return exitCodeForSignal(error.signal);
			}
			throw error;
		} finally {
			signalCancellation.dispose();
		}

		return 0;
	} catch (error) {
		if (isPiperCancellationError(error)) {
			return exitCodeForSignal(error.signal);
		}

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
