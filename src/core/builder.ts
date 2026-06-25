import { createSequence, normalizeChildren } from "./node-utils.js";
import { Parallel } from "./parallel.js";
import { Protect } from "./protect.js";
import { Recover } from "./recover.js";
import { Task } from "./task.js";
import type {
  ParallelNode,
  ParallelProps,
  ProtectNode,
  ProtectProps,
  RecoverNode,
  RecoverProps,
  SequenceNode,
  TaskElement,
  TaskNode,
  TaskProps,
  TaskTree
} from "./types.js";

export type ParallelOptions = Omit<ParallelProps, "children">;
export type ProtectOptions = Omit<ProtectProps, "children">;
export type RecoverOptions = Omit<RecoverProps, "children">;

function isTaskNode(value: unknown): value is TaskNode {
  return (
    value == null ||
    value === false ||
    (typeof value === "object" && value !== null && "kind" in value)
  );
}

function splitOptions<TOptions extends object>(
  first: TaskTree | TOptions | undefined,
  rest: TaskTree[]
): { options: TOptions; children: TaskTree[] } {
  if (isTaskNode(first) || Array.isArray(first)) {
    return { options: {} as TOptions, children: first === undefined ? rest : [first, ...rest] };
  }

  return { options: (first ?? {}) as TOptions, children: rest };
}

export function workflow(...children: TaskTree[]): SequenceNode {
  return sequence(...children);
}

export function sequence(...children: TaskTree[]): SequenceNode {
  return createSequence(normalizeChildren(children));
}

export function task(props: TaskProps): TaskElement {
  return Task(props);
}

export function parallel(...children: TaskTree[]): ParallelNode;
export function parallel(options: ParallelOptions, ...children: TaskTree[]): ParallelNode;
export function parallel(first?: TaskTree | ParallelOptions, ...rest: TaskTree[]): ParallelNode {
  const { options, children } = splitOptions<ParallelOptions>(first, rest);
  return Parallel({ ...options, children });
}

export function protect(options: ProtectOptions, ...children: TaskTree[]): ProtectNode {
  return Protect({ ...options, children });
}

export function recover(options: RecoverOptions, ...children: TaskTree[]): RecoverNode {
  return Recover({ ...options, children });
}
