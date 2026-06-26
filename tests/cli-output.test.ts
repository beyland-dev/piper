import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { CliReporter } from "../src/cli/output.js";

function createBufferStream(options: { isTTY?: boolean } = {}): {
	stream: Writable & { isTTY?: boolean };
	read: () => string;
} {
	let output = "";
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			output += chunk.toString();
			callback();
		},
	}) as Writable & { isTTY?: boolean };
	stream.isTTY = options.isTTY;

	return {
		stream,
		read: () => output,
	};
}

describe("CliReporter", () => {
	const originalForceColor = process.env.FORCE_COLOR;
	const originalNoColor = process.env.NO_COLOR;

	afterEach(() => {
		if (originalForceColor === undefined) {
			delete process.env.FORCE_COLOR;
		} else {
			process.env.FORCE_COLOR = originalForceColor;
		}

		if (originalNoColor === undefined) {
			delete process.env.NO_COLOR;
		} else {
			process.env.NO_COLOR = originalNoColor;
		}
	});

	it("prints plain hierarchical output for non-TTY streams", () => {
		delete process.env.FORCE_COLOR;
		delete process.env.NO_COLOR;
		const stdout = createBufferStream();
		const stderr = createBufferStream();
		const reporter = new CliReporter({
			verbose: true,
			stdout: stdout.stream,
			stderr: stderr.stream,
		});

		reporter.taskStarted({
			id: "task-1",
			goal: "Plan",
			harness: "mock",
			attempt: 1,
		});
		reporter.taskProgress(
			{ id: "task-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ message: "agent line", attempt: 1, timestamp: 1, stream: "stdout" },
		);
		reporter.taskCompleted(
			{ id: "task-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ output: "Done", modifiedFiles: [] },
		);

		expect(stdout.read()).toBe(
			"[run] Plan\n      step=task-1  harness=mock  attempt=1\n\n      agent line\n\n[done] Successfully completed task-1\n",
		);
		expect(stderr.read()).toBe("");
	});

	it("adds ANSI color and weight when output supports color", () => {
		delete process.env.FORCE_COLOR;
		delete process.env.NO_COLOR;
		const stdout = createBufferStream({ isTTY: true });
		const reporter = new CliReporter({ verbose: true, stdout: stdout.stream });

		reporter.taskStarted({
			id: "task-1",
			goal: "Plan",
			harness: "mock",
			attempt: 1,
		});
		reporter.taskProgress(
			{ id: "task-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ message: "warning line", attempt: 1, timestamp: 1, stream: "stderr" },
		);
		reporter.taskCompleted(
			{ id: "task-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ output: "Done", modifiedFiles: [] },
		);
		reporter.summary({
			completedSteps: 1,
			failedSteps: 0,
			completedTasks: 1,
			failedTasks: 0,
			artifacts: {},
			feedback: [],
			events: [],
			runId: null,
			artifactPath: null,
		});

		expect(stdout.read()).toContain("\u001b[36m[run]\u001b[39m");
		expect(stdout.read()).toContain("\u001b[1mPlan\u001b[22m");
		expect(stdout.read()).toContain("\u001b[1mtask-1\u001b[22m");
		expect(stdout.read()).toContain(
			"      \u001b[2mstep=task-1  harness=mock  attempt=1\u001b[22m",
		);
		expect(stdout.read()).toContain("\u001b[33mwarning line\u001b[39m");
		expect(stdout.read()).toContain("\u001b[32m[summary]\u001b[39m");
	});

	it("honors NO_COLOR over TTY color support", () => {
		delete process.env.FORCE_COLOR;
		process.env.NO_COLOR = "1";
		const stdout = createBufferStream({ isTTY: true });
		const reporter = new CliReporter({ stdout: stdout.stream });

		reporter.info("Dry run");

		expect(stdout.read()).toBe("[info] Dry run\n");
	});
});
