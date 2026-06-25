import { normalizeChildren } from "./node-utils.js";
import type { SuspenseNode, SuspenseProps } from "./types.js";

export function Suspense(props: SuspenseProps): SuspenseNode {
  return {
    kind: "suspense",
    props: {
      ...props,
      children: normalizeChildren(props.children)
    }
  };
}
