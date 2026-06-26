import { policy } from "./builder.js";
import type { PolicyNode, PolicyProps } from "./types.js";

export function Policy(props: PolicyProps): PolicyNode {
	return policy(props);
}

export const Protect = Policy;
