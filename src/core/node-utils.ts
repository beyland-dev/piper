import type { SequenceNode, TaskNode, TaskTree } from "./types.js";

export function createSequence(children: TaskNode[]): SequenceNode {
  return {
    kind: "sequence",
    props: {
      children
    }
  };
}

export function normalizeChildren(input: unknown): TaskNode[] {
  if (input == null || input === false) {
    return [];
  }

  if (Array.isArray(input)) {
    return input.flatMap((child) => normalizeChildren(child));
  }

  if (typeof input === "string") {
    return input.trim() === "" ? [] : [];
  }

  return [input as TaskNode];
}

export function normalizeTree(tree: TaskTree): TaskNode {
  if (Array.isArray(tree)) {
    return createSequence(normalizeChildren(tree));
  }

  return tree;
}
