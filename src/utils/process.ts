import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AsyncQueue } from "./async-queue.js";

export interface CommandResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

export interface StreamingCommand {
	progress: AsyncQueue<{ message: string; stream: "stdout" | "stderr" }>;
	completed: Promise<CommandResult>;
	cancel: () => void;
}

export function spawnStreamingCommand(
	command: string,
	options: {
		cwd: string;
		env?: NodeJS.ProcessEnv;
	},
): StreamingCommand {
	const progress = new AsyncQueue<{ message: string; stream: "stdout" | "stderr" }>();
	const child = spawn(command, {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		shell: true,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stdout = "";
	let stderr = "";

	const stdoutReader = createInterface({ input: child.stdout! });
	stdoutReader.on("line", (line) => {
		stdout += `${line}\n`;
		progress.push({ message: line, stream: "stdout" });
	});

	const stderrReader = createInterface({ input: child.stderr! });
	stderrReader.on("line", (line) => {
		stderr += `${line}\n`;
		progress.push({ message: line, stream: "stderr" });
	});

	const completed = new Promise<CommandResult>((resolve) => {
		child.on("close", (exitCode, signal) => {
			stdoutReader.close();
			stderrReader.close();
			progress.close();
			resolve({
				exitCode,
				signal,
				stdout: stdout.trimEnd(),
				stderr: stderr.trimEnd(),
			});
		});
	});

	return {
		progress,
		completed,
		cancel: () => {
			if (!child.killed) {
				child.kill("SIGTERM");
			}
		},
	};
}

export async function runCommand(
	command: string,
	options: {
		cwd: string;
		env?: NodeJS.ProcessEnv;
	},
): Promise<CommandResult> {
	const commandRun = spawnStreamingCommand(command, options);
	return commandRun.completed;
}
