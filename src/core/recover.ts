import { normalizeChildren } from "./node-utils.js";
import type { RecoverNode, RecoverProps } from "./types.js";

export function Recover(props: RecoverProps): RecoverNode {
	return {
		kind: "recover",
		props: {
			...props,
			maxRetries: props.maxRetries ?? 3,
			children: normalizeChildren(props.children),
		},
	};
}
