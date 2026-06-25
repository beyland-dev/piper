import { getArtifactName } from "../core/output.js";
import type {
	ExecutionSummary,
	ProgressUpdate,
	RuntimeHooks,
	TaskAttemptInfo,
	TaskNode,
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

	taskStarted(info: TaskAttemptInfo): void {
		const metadata = [`task=${info.id}`, `harness=${info.harness}`, `attempt=${info.attempt}`];
		if (info.model) {
			metadata.push(`model=${info.model}`);
		}

		this.progressBlocks.delete(this.progressKey(info));
		this.writer.write(`${this.status("run", "cyan")} ${this.format(info.goal, "bold")}\n`);
		this.writer.write(`      ${this.format(metadata.join("  "), "dim")}\n\n`);
	}

	taskProgress(info: TaskAttemptInfo, update: ProgressUpdate): void {
		if (!this.verbose) {
			return;
		}

		this.progressBlocks.add(this.progressKey(info));
		const message =
			update.stream === "stderr" ? this.format(update.message, "yellow") : update.message;
		this.writer.write(`      ${message}\n`);
	}

	taskRetry(info: TaskAttemptInfo, failures: string[]): void {
		this.closeProgressBlock(info);
		this.writer.write(
			`${this.status("retry", "yellow")} ${this.format(info.id, "bold")} ${clip(failures.join(" | "))}\n`,
		);
	}

	taskCompleted(info: TaskAttemptInfo, _result: TaskResult): void {
		this.closeProgressBlock(info);
		this.writer.write(
			`${this.status("done", "green")} Successfully completed ${this.format(info.id, "bold")}\n`,
		);
	}

	taskFailed(info: TaskAttemptInfo, error: { message: string }): void {
		this.closeProgressBlock(info);
		this.errorWriter.write(
			`${this.status("fail", "red", true)} ${this.format(info.id, "bold", true)} ${error.message}\n`,
		);
	}

	summary(summary: ExecutionSummary): void {
		const labelStyle = summary.failedTasks > 0 ? "red" : "green";
		this.writer.write(
			`${this.status("summary", labelStyle)} completed=${summary.completedTasks} failed=${summary.failedTasks} artifacts=${Object.keys(summary.artifacts).length}\n`,
		);
	}

	private status(label: string, style: StyleName, error = false): string {
		return this.format(`[${label}]`, style, error);
	}

	private closeProgressBlock(info: TaskAttemptInfo): void {
		if (this.progressBlocks.delete(this.progressKey(info))) {
			this.writer.write("\n");
		}
	}

	private progressKey(info: TaskAttemptInfo): string {
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

function describeNode(node: TaskNode, depth: number): string[] {
	if (!node) {
		return [];
	}

	const prefix = `${"  ".repeat(depth)}- `;

	switch (node.kind) {
		case "task":
			return [
				`${prefix}Task(harness=${node.props.harness}${node.props.model ? `, model=${node.props.model}` : ""}${node.props.artifact ? `, artifact=${getArtifactName(node.props.artifact)}` : ""}): ${node.props.goal}`,
			];
		case "workflow":
			return node.props.children.flatMap((child) => describeNode(child, depth));
		case "parallel":
			return [
				`${prefix}Parallel${typeof node.props.status === "string" ? ` status="${node.props.status}"` : ""}`,
				...node.props.children.flatMap((child) => describeNode(child, depth + 1)),
			];
		case "recover":
			return [
				`${prefix}Recover(maxRetries=${node.props.maxRetries ?? 3})`,
				...node.props.children.flatMap((child) => describeNode(child, depth + 1)),
			];
		case "protect":
			return [
				`${prefix}Protect(protected=${node.props.protectedFiles.join(", ")})`,
				...node.props.children.flatMap((child) => describeNode(child, depth + 1)),
			];
		default:
			return [`${prefix}Unknown`];
	}
}

export function formatTaskTree(node: TaskNode): string {
	return describeNode(node, 0).join("\n");
}
