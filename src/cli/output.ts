import { getArtifactName } from "../core/output.js";
import type {
	ConcreteLoopNode,
	ExecutionSummary,
	ProgressUpdate,
	RuntimeHooks,
	RunEvent,
	StepAttemptInfo,
	TaskResult,
} from "../core/types.js";

function clip(value: string, limit = 100): string {
	if (value.length <= limit) {
		return value;
	}

	return `${value.slice(0, limit - 1)}…`;
}

type StyleName = "bold" | "dim" | "cyan" | "green" | "red" | "yellow";

const styles: Record<StyleName, [open: string, close: string]> = {
	bold: ["\u001b[1m", "\u001b[22m"],
	dim: ["\u001b[2m", "\u001b[22m"],
	cyan: ["\u001b[36m", "\u001b[39m"],
	green: ["\u001b[32m", "\u001b[39m"],
	red: ["\u001b[31m", "\u001b[39m"],
	yellow: ["\u001b[33m", "\u001b[39m"],
};

function supportsColor(stream: NodeJS.WritableStream): boolean {
	if (process.env.NO_COLOR !== undefined) {
		return false;
	}

	if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") {
		return true;
	}

	return Boolean((stream as NodeJS.WritableStream & { isTTY?: boolean }).isTTY);
}

export class CliReporter implements RuntimeHooks {
	private readonly verbose: boolean;
	private readonly writer: NodeJS.WritableStream;
	private readonly errorWriter: NodeJS.WritableStream;
	private readonly color: boolean;
	private readonly errorColor: boolean;
	private readonly progressBlocks = new Set<string>();

	constructor(
		options: {
			verbose?: boolean;
			stdout?: NodeJS.WritableStream;
			stderr?: NodeJS.WritableStream;
		} = {},
	) {
		this.verbose = options.verbose ?? false;
		this.writer = options.stdout ?? process.stdout;
		this.errorWriter = options.stderr ?? process.stderr;
		this.color = supportsColor(this.writer);
		this.errorColor = supportsColor(this.errorWriter);
	}

	info(message: string): void {
		this.writer.write(`${this.status("info", "cyan")} ${message}\n`);
	}

	stepStarted(info: StepAttemptInfo): void {
		const metadata = [`step=${info.id}`, `harness=${info.harness}`, `attempt=${info.attempt}`];
		if (info.role) {
			metadata.push(`role=${info.role}`);
		}
		if (info.model) {
			metadata.push(`model=${info.model}`);
		}

		this.progressBlocks.delete(this.progressKey(info));
		this.writer.write(`${this.status("run", "cyan")} ${this.format(info.goal, "bold")}\n`);
		this.writer.write(`      ${this.format(metadata.join("  "), "dim")}\n\n`);
	}

	stepProgress(info: StepAttemptInfo, update: ProgressUpdate): void {
		if (!this.verbose) {
			return;
		}

		this.progressBlocks.add(this.progressKey(info));
		const message =
			update.stream === "stderr" ? this.format(update.message, "yellow") : update.message;
		this.writer.write(`      ${message}\n`);
	}

	stepRetry(info: StepAttemptInfo, failures: string[]): void {
		this.closeProgressBlock(info);
		this.writer.write(
			`${this.status("retry", "yellow")} ${this.format(info.id, "bold")} ${clip(failures.join(" | "))}\n`,
		);
	}

	stepCompleted(info: StepAttemptInfo, _result: TaskResult): void {
		this.closeProgressBlock(info);
		this.writer.write(
			`${this.status("done", "green")} Successfully completed ${this.format(info.id, "bold")}\n`,
		);
	}

	stepFailed(info: StepAttemptInfo, error: { message: string }): void {
		this.closeProgressBlock(info);
		this.errorWriter.write(
			`${this.status("fail", "red", true)} ${this.format(info.id, "bold", true)} ${error.message}\n`,
		);
	}

	taskStarted(info: StepAttemptInfo): void {
		this.stepStarted(info);
	}

	taskProgress(info: StepAttemptInfo, update: ProgressUpdate): void {
		this.stepProgress(info, update);
	}

	taskRetry(info: StepAttemptInfo, failures: string[]): void {
		this.stepRetry(info, failures);
	}

	taskCompleted(info: StepAttemptInfo, result: TaskResult): void {
		this.stepCompleted(info, result);
	}

	taskFailed(info: StepAttemptInfo, error: { message: string }): void {
		this.stepFailed(info, error);
	}

	event(event: RunEvent): void {
		if (!this.verbose || !event.type.startsWith("feedback")) {
			return;
		}

		this.writer.write(`${this.status("feedback", "yellow")} ${clip(event.message)}\n`);
	}

	summary(summary: ExecutionSummary): void {
		const labelStyle = summary.failedSteps > 0 ? "red" : "green";
		this.writer.write(
			`${this.status("summary", labelStyle)} completed=${summary.completedSteps} failed=${summary.failedSteps} artifacts=${Object.keys(summary.artifacts).length} feedback=${summary.feedback.length}\n`,
		);
	}

	private status(label: string, style: StyleName, error = false): string {
		return this.format(`[${label}]`, style, error);
	}

	private closeProgressBlock(info: StepAttemptInfo): void {
		if (this.progressBlocks.delete(this.progressKey(info))) {
			this.writer.write("\n");
		}
	}

	private progressKey(info: StepAttemptInfo): string {
		return `${info.id}:${info.attempt}`;
	}

	private format(value: string, style: StyleName, error = false): string {
		const enabled = error ? this.errorColor : this.color;
		if (!enabled) {
			return value;
		}

		const [open, close] = styles[style];
		return `${open}${value}${close}`;
	}
}

function describeNode(node: ConcreteLoopNode, depth: number): string[] {
	const prefix = `${"  ".repeat(depth)}- `;

	switch (node.kind) {
		case "loop":
			return [
				`${prefix}Loop: ${node.props.objective}`,
				...node.props.children.flatMap((child) => describeNode(child, depth + 1)),
			];
		case "step":
			return [
				`${prefix}Step(${[
					node.props.role
						? `role=${typeof node.props.role === "string" ? node.props.role : node.props.role.name}`
						: undefined,
					node.props.harness ? `harness=${node.props.harness}` : undefined,
					(node.props.produces ?? node.props.artifact)
						? `artifact=${getArtifactName((node.props.produces ?? node.props.artifact)!)}`
						: undefined,
				]
					.filter(Boolean)
					.join(", ")}): ${node.props.goal}`,
			];
		case "evaluate":
			return [`${prefix}Evaluate: ${node.props.name}`];
		case "feedback":
			return [`${prefix}Feedback: ${clip(node.props.message)}`];
		case "repeat":
			return [
				`${prefix}Repeat(maxAttempts=${node.props.maxAttempts ?? 3})`,
				...node.props.children.flatMap((child) => describeNode(child, depth + 1)),
			];
		case "parallel":
			return [
				`${prefix}Parallel${typeof node.props.status === "string" ? ` status="${node.props.status}"` : ""}`,
				...node.props.children.flatMap((child) => describeNode(child, depth + 1)),
			];
		case "compare":
			return [
				`${prefix}Compare`,
				...node.props.branches.flatMap((branch) => [
					`${"  ".repeat(depth + 1)}- Branch: ${branch.name}`,
					...describeNode(branch.node, depth + 2),
				]),
			];
		case "gate":
			return [`${prefix}Gate: ${node.props.name}`];
		case "policy":
			return [
				`${prefix}Policy${node.props.name ? `: ${node.props.name}` : ""}`,
				...node.props.children.flatMap((child) => describeNode(child, depth + 1)),
			];
		case "state":
			return [`${prefix}State: ${node.props.name}`];
	}
}

export function formatTaskTree(node: ConcreteLoopNode): string {
	return describeNode(node, 0).join("\n");
}
