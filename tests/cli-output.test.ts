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

		reporter.stepStarted({
			id: "step-1",
			goal: "Plan",
			harness: "mock",
			attempt: 1,
		});
		reporter.stepProgress(
			{ id: "step-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ message: "agent line", attempt: 1, timestamp: 1, stream: "stdout" },
		);
		reporter.stepCompleted(
			{ id: "step-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ output: "Done", modifiedFiles: [] },
		);

		expect(stdout.read()).toBe(
			"[run] Plan\n      id=step-1  harness=mock  attempt=1\n\n      agent line\n\n[done] Successfully completed step-1\n",
		);
		expect(stderr.read()).toBe("");
	});

	it("adds ANSI color and weight when output supports color", () => {
		delete process.env.FORCE_COLOR;
		delete process.env.NO_COLOR;
		const stdout = createBufferStream({ isTTY: true });
		const reporter = new CliReporter({ verbose: true, stdout: stdout.stream });

		reporter.stepStarted({
			id: "step-1",
			goal: "Plan",
			harness: "mock",
			attempt: 1,
		});
		reporter.stepProgress(
			{ id: "step-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ message: "warning line", attempt: 1, timestamp: 1, stream: "stderr" },
		);
		reporter.stepCompleted(
			{ id: "step-1", goal: "Plan", harness: "mock", attempt: 1 },
			{ output: "Done", modifiedFiles: [] },
		);
		reporter.summary({
			completedSteps: 1,
			failedSteps: 0,
			artifacts: {},
			feedback: [],
			events: [],
			runId: null,
			artifactPath: null,
		});

		expect(stdout.read()).toContain("\u001b[36m[run]\u001b[39m");
		expect(stdout.read()).toContain("\u001b[1mPlan\u001b[22m");
		expect(stdout.read()).toContain("\u001b[1mstep-1\u001b[22m");
		expect(stdout.read()).toContain("      \u001b[2mid=step-1  harness=mock  attempt=1\u001b[22m");
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

	it("separates completed context output from harness progress", () => {
		delete process.env.FORCE_COLOR;
		delete process.env.NO_COLOR;
		const stdout = createBufferStream();
		const reporter = new CliReporter({ verbose: true, stdout: stdout.stream });
		const stepInfo = { id: "step-2", goal: "Research", harness: "copilot", attempt: 1 };

		reporter.event({
			type: "context:start",
			message: "Resolving runtime context for step-2...",
			nodeId: "step-2",
			timestamp: 1,
		});
		reporter.event({
			type: "context:complete",
			message: "Resolved runtime context for step-2; starting copilot harness...",
			nodeId: "step-2",
			timestamp: 2,
		});
		reporter.stepProgress(stepInfo, {
			message: "agent line",
			attempt: 1,
			timestamp: 3,
			stream: "stdout",
		});

		expect(stdout.read()).toBe(
			"[context] Resolving runtime context for step-2...\n[context] Resolved runtime context for step-2; starting copilot harness...\n\n      agent line\n",
		);
	});
});
