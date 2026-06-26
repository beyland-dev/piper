import type { ConcreteLoopNode, LoopTree, RootLoopNode } from "./types.js";

export function createLoop(
	children: ConcreteLoopNode[],
	objective = "Run Piper loop",
): RootLoopNode {
	return {
		kind: "loop",
		props: {
			objective,
			children,
		},
	};
}

export function normalizeChildren(input: unknown): ConcreteLoopNode[] {
	if (input == null || input === false) {
		return [];
	}

	if (Array.isArray(input)) {
		return input.flatMap((child) => normalizeChildren(child));
	}

	if (typeof input === "string") {
		return [];
	}

	return [input as ConcreteLoopNode];
}

export function normalizeTree(tree: LoopTree): ConcreteLoopNode {
	if (Array.isArray(tree)) {
		return createLoop(normalizeChildren(tree));
	}

	if (!tree) {
		return createLoop([]);
	}

	return tree;
}
