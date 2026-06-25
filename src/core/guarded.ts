import { normalizeChildren } from "./node-utils.js";
import type { GuardedNode, GuardedProps } from "./types.js";

export function Guarded(props: GuardedProps): GuardedNode {
  return {
    kind: "guarded",
    props: {
      ...props,
      children: normalizeChildren(props.children)
    }
  };
}
