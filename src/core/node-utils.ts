import type { TaskNode, TaskTree, WorkflowNode } from "./types.js";

export function createWorkflow(children: TaskNode[]): WorkflowNode {
  return {
    kind: "workflow",
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
    return createWorkflow(normalizeChildren(tree));
  }

  return tree;
}
