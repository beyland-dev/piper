import { normalizeChildren } from "./node-utils.js";
import type { ProtectNode, ProtectProps } from "./types.js";

export function Protect(props: ProtectProps): ProtectNode {
	return {
		kind: "protect",
		props: {
			...props,
			children: normalizeChildren(props.children),
		},
	};
}
