import { normalizeChildren } from "./node-utils.js";
import type { ParallelNode, ParallelProps } from "./types.js";

export function Parallel(props: ParallelProps): ParallelNode {
  return {
    kind: "parallel",
    props: {
      ...props,
      children: normalizeChildren(props.children)
    }
  };
}
