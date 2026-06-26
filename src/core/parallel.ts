import { parallel } from "./builder.js";
import type { ParallelNode, ParallelProps } from "./types.js";

export function Parallel(props: ParallelProps): ParallelNode {
	return parallel(props);
}
