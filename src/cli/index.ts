#!/usr/bin/env node

import { constants as fsConstants, existsSync, realpathSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { CopilotAhpHarness } from "../adapters/copilot-ahp-adapter.js";
import { CopilotCliHarness } from "../adapters/copilot-cli-adapter.js";
import { MockHarness } from "../adapters/mock-adapter.js";
import { PiHarness } from "../adapters/pi-adapter.js";
import { task } from "../core/builder.js";
import { normalizeTree } from "../core/node-utils.js";
import type { HarnessAdapter, RuntimeHooks } from "../core/types.js";
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

interface GenerateOptions {
	prompt: string;
	workspacePath: string;
	harness: string;
	outputPath: string;
	verbose: boolean;
	execute: boolean;
	dryRunGenerated: boolean;
	saveOnly: boolean;
}

type CliOptions =
	| {
			kind: "help";
	  }
	| ({
			kind: "run";
	  } & RunOptions)
	| ({
			kind: "generate";
	  } & GenerateOptions);

interface RunCliOptions {
	stdout?: NodeJS.WritableStream;
	stderr?: NodeJS.WritableStream;
	cwd?: string;
	signalTarget?: SignalTarget;
}

const HELP_TEXT = `Usage: piper <prompt> [options]
       piper <workflow.piper.ts> [options]

Generate a Piper workflow from an initial prompt, or compile and run a workflow file.

Arguments:
  workflow.piper.ts       Path to the workflow module.
  prompt                  Initial prompt for generated workflow authoring.

Options:
  --workspace <path>      Workspace directory for task execution. Defaults to the current directory.
  --quiet                 Print only high-level runtime artifact.
  --verbose               Print verbose runtime artifact. This is the default.
  --dry-run               Print the task tree without executing it.
  --print-compiled        Print the bundled workflow module without executing it.
  --harness <name>        Harness to use for workflow generation. Defaults to copilot.
  --output <path>         Generated workflow path. Defaults to generated.piper.ts.
  --save-only             Save the generated workflow without validating or executing it.
  --execute               Execute the generated workflow after validation.
  --dry-run-generated     Print the generated task tree after validation without executing it.
  -h, --help              Show this help information.

Examples:
  piper "Fix the failing tests" --workspace . --output workflows/generated.piper.ts
      Ask a harness to write a workflow file, then validate it.

  piper "Prepare a migration plan" --dry-run-generated
      Generate and preview the task tree without executing the generated workflow.

  piper examples/simple-task.piper.ts --dry-run
      Preview the task tree without executing tasks.

  piper examples/simple-task.piper.ts --quiet
      Suppress verbose progress artifact while tasks execute.

  piper examples/simple-task.piper.ts --print-compiled
      Inspect the bundled workflow module without executing it.

  pnpm exec piper examples/simple-task.piper.ts --workspace .
      Run an installed Piper CLI through a package manager.`;

function isWorkflowPathArgument(value: string, cwd: string): boolean {
	const resolved = resolve(cwd, value);
	return existsSync(resolved) || /\.(?:piper\.)?(?:[cm]?ts|[cm]?js)$/.test(value);
}

function parseGenerateArguments(prompt: string, values: string[], cwd: string): CliOptions {
	let workspacePath = cwd;
	let harness = "copilot";
	let outputPath = resolve(cwd, "generated.piper.ts");
	let verbose = true;
	let execute = false;
	let dryRunGenerated = false;
	let saveOnly = false;

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

		if (current === "--harness") {
			const harnessArg = values.shift();
			if (!harnessArg) {
				throw new Error("Missing value for --harness");
			}
			harness = harnessArg;
			continue;
		}

		if (current === "--output") {
			const outputArg = values.shift();
			if (!outputArg) {
				throw new Error("Missing value for --output");
			}
			outputPath = resolve(cwd, outputArg);
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

		if (current === "--execute") {
			execute = true;
			continue;
		}

		if (current === "--save-only") {
			saveOnly = true;
			continue;
		}

		if (current === "--dry-run-generated") {
			dryRunGenerated = true;
			continue;
		}

		if (current === "-h" || current === "--help") {
			return { kind: "help" };
		}

		throw new Error(`Unknown argument: ${current}`);
	}

	if (execute && dryRunGenerated) {
		throw new Error("--execute and --dry-run-generated cannot be used together");
	}

	if (saveOnly && (execute || dryRunGenerated)) {
		throw new Error("--save-only cannot be used with --execute or --dry-run-generated");
	}

	return {
		kind: "generate",
		prompt,
		workspacePath,
		harness,
		outputPath,
		verbose,
		execute,
		dryRunGenerated,
		saveOnly,
	};
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

	const firstArg = values.shift();
	if (!firstArg || firstArg === "-h" || firstArg === "--help") {
		return { kind: "help" };
	}

	if (!isWorkflowPathArgument(firstArg, cwd)) {
		return parseGenerateArguments(firstArg, values, cwd);
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
		workflowPath: resolve(cwd, firstArg),
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
			throw new Error('PIPER_COPILOT_HARNESS must be either "cli" or "ahp"');
	}
}

function createDefaultHarnesses(): HarnessAdapter[] {
	return [
		new PiHarness({
			command: process.env.PI_COMMAND ?? "pi",
			commandTemplate: process.env.PI_COMMAND_TEMPLATE,
		}),
		createCopilotHarness(),
		new MockHarness(),
	];
}

function buildGenerationGoal(options: GenerateOptions): string {
	return [
		"Generate a Piper workflow file from the user's prompt.",
		`User prompt:\n${options.prompt}`,
		`Write the generated workflow to:\n${options.outputPath}`,
	].join("\n\n");
}

function buildGenerationContext(options: GenerateOptions): string[] {
	return [
		`Target workflow path:\n${options.outputPath}`,
		`Workspace path:\n${options.workspacePath}`,
		[
			"Authoring requirements:",
			"- Write a TypeScript .piper.ts workflow file at the target path.",
			'- Import workflow builders from "@beyland/piper".',
			"- Export a default task tree or a default function returning a task tree.",
			"- Use the current builder API: workflow, task, parallel, protect, recover, artifact, and runtimeValue.",
			"- Do not use a hidden autonomous loop or dynamically mutate Piper's runtime task tree.",
			"- Prefer explicit, inspectable tasks that can be reviewed before execution.",
			"- Use harness names that Piper can run, such as copilot, pi, or mock.",
		].join("\n"),
		[
			"Example workflow:",
			'import { artifact, task, workflow } from "@beyland/piper";',
			"",
			'const plan = artifact("plan");',
			"",
			"export default workflow(",
			'\ttask({ goal: "Create a plan", harness: "copilot", artifact: plan }),',
			'\ttask({ goal: "Implement the plan", harness: "copilot", context: [plan.value()] }),',
			");",
		].join("\n"),
		"Additional examples live in the repository's examples/ directory when available.",
	];
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

async function executeTaskTree(params: {
	taskTree: TaskNode;
	workspacePath: string;
	hooks: RuntimeHooks;
	cliOptions: RunCliOptions;
}): Promise<void> {
	const orchestrator = new PiperOrchestrator({
		workspacePath: params.workspacePath,
		taskRetryLimit: 3,
		hooks: params.hooks,
		artifactStorage: process.env.PIPER_ARTIFACT_ROOT
			? { rootDir: process.env.PIPER_ARTIFACT_ROOT }
			: undefined,
		harnesses: createDefaultHarnesses(),
	});

	const signalCancellation = installCancellationHandlers({
		orchestrator,
		stderr: params.cliOptions.stderr ?? process.stderr,
		signalTarget: params.cliOptions.signalTarget ?? process,
	});

	try {
		await orchestrator.execute(params.taskTree);
		await signalCancellation.settle();
	} catch (error) {
		await signalCancellation.settle();
		if (isPiperCancellationError(error)) {
			throw error;
		}
		throw error;
	} finally {
		signalCancellation.dispose();
	}
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

		if (parsed.kind === "generate") {
			await mkdir(dirname(parsed.outputPath), { recursive: true });
			await executeTaskTree({
				taskTree: task({
					goal: buildGenerationGoal(parsed),
					harness: parsed.harness,
					context: buildGenerationContext(parsed),
				}),
				workspacePath: parsed.workspacePath,
				hooks,
				cliOptions: options,
			});

			if (parsed.saveOnly) {
				await access(parsed.outputPath, fsConstants.F_OK);
				hooks.info(`Generated workflow written to ${parsed.outputPath}`);
				return 0;
			}

			const generatedTaskTree = await loadWorkflow(parsed.outputPath);
			hooks.info(`Generated workflow written to ${parsed.outputPath}`);

			if (parsed.dryRunGenerated) {
				hooks.info("Generated workflow dry run");
				hooks.info(formatTaskTree(generatedTaskTree));
				return 0;
			}

			if (parsed.execute) {
				await executeTaskTree({
					taskTree: generatedTaskTree,
					workspacePath: parsed.workspacePath,
					hooks,
					cliOptions: options,
				});
			}

			return 0;
		}

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

		await executeTaskTree({
			taskTree,
			workspacePath: parsed.workspacePath,
			hooks,
			cliOptions: options,
		});

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
