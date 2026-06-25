import { createSequence, normalizeChildren } from "./core/node-utils.js";
import type { TaskNode } from "./core/types.js";

export const Fragment = Symbol.for("agent-runtime.fragment");

export function jsx(type: unknown, props: Record<string, unknown> | null): TaskNode {
  const finalProps = { ...(props ?? {}) };

  if (type === Fragment) {
    return createSequence(normalizeChildren(finalProps.children));
  }

  if (typeof type === "function") {
    return (type as (incoming: Record<string, unknown>) => TaskNode)(finalProps);
  }

  throw new Error(`Unsupported JSX element type: ${String(type)}`);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export namespace JSX {
  export type Element = TaskNode;
  export interface ElementChildrenAttribute {
    children: {};
  }
  export interface IntrinsicElements {
    [name: string]: never;
  }
}
