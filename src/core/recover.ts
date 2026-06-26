import { repeat } from "./builder.js";
import type { RepeatNode, RepeatProps } from "./types.js";

export function Repeat(props: RepeatProps): RepeatNode {
	return repeat(props);
}

export const Recover = Repeat;
