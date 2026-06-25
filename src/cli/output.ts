import type { ExecutionSummary, ProgressUpdate, RuntimeReporter, TaskAttemptInfo, TaskNode, TaskResult } from "../core/types.js";

function clip(value: string, limit = 100): string {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit - 1)}…`;
}

export class CliReporter implements RuntimeReporter {
  private readonly verbose: boolean;
  private readonly writer: NodeJS.WritableStream;
  private readonly errorWriter: NodeJS.WritableStream;

  constructor(options: {
    verbose?: boolean;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
  } = {}) {
    this.verbose = options.verbose ?? false;
    this.writer = options.stdout ?? process.stdout;
    this.errorWriter = options.stderr ?? process.stderr;
  }

  info(message: string): void {
    this.writer.write(`[info] ${message}\n`);
  }

  taskStarted(info: TaskAttemptInfo): void {
    this.writer.write(`[run] ${info.id} (${info.agent}, attempt ${info.attempt}) ${info.goal}\n`);
  }

  taskProgress(info: TaskAttemptInfo, update: ProgressUpdate): void {
    if (!this.verbose) {
      return;
    }

    this.writer.write(`  [${info.id}] ${update.message}\n`);
  }

  taskRetry(info: TaskAttemptInfo, failures: string[]): void {
    this.writer.write(`[retry] ${info.id} ${clip(failures.join(" | "))}\n`);
  }

  taskCompleted(info: TaskAttemptInfo, result: TaskResult): void {
    this.writer.write(`[done] ${info.id} ${clip(result.output || info.goal)}\n`);
  }

  taskFailed(info: TaskAttemptInfo, error: { message: string }): void {
    this.errorWriter.write(`[fail] ${info.id} ${error.message}\n`);
  }

  summary(summary: ExecutionSummary): void {
    this.writer.write(
      `[summary] completed=${summary.completedTasks} failed=${summary.failedTasks} outputs=${Object.keys(summary.outputs).length}\n`
    );
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
        `${prefix}Task(agent=${node.props.agent}${node.props.output ? `, output=${node.props.output}` : ""}): ${node.props.goal}`
      ];
    case "sequence":
      return node.props.children.flatMap((child) => describeNode(child, depth));
    case "parallel":
      return [
        `${prefix}Parallel${typeof node.props.fallback === "string" ? ` fallback="${node.props.fallback}"` : ""}`,
        ...node.props.children.flatMap((child) => describeNode(child, depth + 1))
      ];
    case "recover":
      return [
        `${prefix}Recover(maxRetries=${node.props.maxRetries ?? 3})`,
        ...node.props.children.flatMap((child) => describeNode(child, depth + 1))
      ];
    case "protect":
      return [
        `${prefix}Protect(protected=${node.props.protectedFiles.join(", ")})`,
        ...node.props.children.flatMap((child) => describeNode(child, depth + 1))
      ];
    default:
      return [`${prefix}Unknown`];
  }
}

export function formatTaskTree(node: TaskNode): string {
  return describeNode(node, 0).join("\n");
}
