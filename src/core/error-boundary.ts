import { normalizeChildren } from "./node-utils.js";
import type { ErrorBoundaryNode, ErrorBoundaryProps } from "./types.js";

export function ErrorBoundary(props: ErrorBoundaryProps): ErrorBoundaryNode {
  return {
    kind: "error-boundary",
    props: {
      ...props,
      maxRetries: props.maxRetries ?? 3,
      children: normalizeChildren(props.children)
    }
  };
}
