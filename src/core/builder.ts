import { normalizeChildren } from "./node-utils.js";
import { artifact, getArtifactName } from "./output.js";
import type {
	AgentDefinition,
	ArtifactTarget,
	CompareNode,
	CompareProps,
	ConcreteLoopNode,
	ContextValue,
	EvaluateNode,
	EvaluationValue,
	EvaluateProps,
	FeedbackNode,
	FeedbackProps,
	GateNode,
	GateProps,
	HarnessDefinition,
	LoopProps,
	LoopTree,
	ParallelNode,
	ParallelProps,
	PolicyNode,
	PolicyProps,
	RepeatNode,
	RepeatProps,
	RootLoopNode,
	StateNode,
	StateProps,
	StepNode,
	StepProps,
} from "./types.js";

type ChildrenOptions<TOptions extends object> = TOptions & { children?: LoopTree };

export interface FanOutSliceContext {
	name: string;
	artifact: ArtifactTarget;
	from: ArtifactTarget;
	index: number;
}

export type FanOutSlice =
	| ArtifactTarget
	| (Omit<StepProps, "goal" | "context" | "produces" | "artifact"> & {
			name?: string;
			artifact?: ArtifactTarget;
			produces?: ArtifactTarget;
			goal?: string;
			context?: ContextValue[];
		});

export interface FanOutProps {
	id?: string;
	status?: string;
	from: ArtifactTarget;
	into: readonly FanOutSlice[];
	using: string | ((slice: FanOutSliceContext) => LoopTree);
	role?: StepProps["role"];
	harness?: string;
	model?: string;
	instructions?: string;
	acceptanceCriteria?: string[];
	constraints?: string[];
	context?: ContextValue[];
	validate?: EvaluationValue[];
}

function splitOptions<TOptions extends object>(
	first: LoopTree | ChildrenOptions<TOptions> | undefined,
	rest: LoopTree[],
): { options: TOptions; children: ConcreteLoopNode[] } {
	const looksLikeNode =
		first == null ||
		first === false ||
		Array.isArray(first) ||
		(typeof first === "object" && "kind" in first);

	if (looksLikeNode) {
		return {
			options: {} as TOptions,
			children: normalizeChildren(first === undefined ? rest : [first, ...rest]),
		};
	}

	const options = (first ?? {}) as ChildrenOptions<TOptions>;
	return {
		options,
		children: normalizeChildren(
			options.children === undefined ? rest : [options.children, ...rest],
		),
	};
}

function isFanOutSliceOptions(
	slice: FanOutSlice,
): slice is Exclude<FanOutSlice, ArtifactTarget> {
	return typeof slice === "object" && slice !== null && !("kind" in slice);
}

function fanOutSliceArtifact(slice: FanOutSlice): ArtifactTarget {
	if (!isFanOutSliceOptions(slice)) {
		return slice;
	}

	const target = slice.produces ?? slice.artifact ?? slice.name;
	if (!target) {
		throw new Error("fanOut slices must include a name, artifact, or produces target.");
	}

	return target;
}

function fanOutSliceName(slice: FanOutSlice): string {
	return getArtifactName(fanOutSliceArtifact(slice));
}

function fanOutSourceContext(source: ArtifactTarget): ContextValue {
	return typeof source === "string" ? artifact(source) : source;
}

export function agent<Name extends string>(
	name: Name,
	options: Partial<Omit<AgentDefinition<Name>, "kind" | "name">> = {},
): AgentDefinition<Name> {
	return {
		kind: "agent",
		name,
		capabilities: options.capabilities ?? [],
		constraints: options.constraints ?? [],
		instructions: options.instructions,
		harness: options.harness,
		model: options.model,
	};
}

export function harness<Name extends string>(
	name: Name,
	options: Partial<Omit<HarnessDefinition<Name>, "kind" | "name">> = {},
): HarnessDefinition<Name> {
	return {
		kind: "harness",
		name,
		description: options.description,
		capabilities: options.capabilities ?? [],
	};
}

export function loop(...children: LoopTree[]): RootLoopNode;
export function loop(options: LoopProps, ...children: LoopTree[]): RootLoopNode;
export function loop(first?: LoopTree | LoopProps, ...rest: LoopTree[]): RootLoopNode {
	const { options, children } = splitOptions<LoopProps>(first, rest);
	return {
		kind: "loop",
		props: {
			...options,
			objective: options.objective ?? "Run Piper loop",
			children,
		},
	};
}

export function step(props: StepProps): StepNode {
	return {
		kind: "step",
		props,
	};
}

export function evaluate(props: EvaluateProps): EvaluateNode {
	return {
		kind: "evaluate",
		props,
	};
}

export function feedback(props: FeedbackProps): FeedbackNode {
	return {
		kind: "feedback",
		props,
	};
}

export function repeat(options: RepeatProps, ...children: LoopTree[]): RepeatNode {
	return {
		kind: "repeat",
		props: {
			...options,
			children: normalizeChildren(
				options.children === undefined ? children : [options.children, ...children],
			),
		},
	};
}

export const until = repeat;

export function parallel(...children: LoopTree[]): ParallelNode;
export function parallel(options: ParallelProps, ...children: LoopTree[]): ParallelNode;
export function parallel(first?: LoopTree | ParallelProps, ...rest: LoopTree[]): ParallelNode {
	const { options, children } = splitOptions<ParallelProps>(first, rest);
	return {
		kind: "parallel",
		props: {
			...options,
			children,
		},
	};
}

export function fanOut(options: FanOutProps): ParallelNode {
	const fromContext = fanOutSourceContext(options.from);
	const children = options.into.flatMap((slice, index) => {
		const target = fanOutSliceArtifact(slice);
		const name = fanOutSliceName(slice);
		const sliceContext = { name, artifact: target, from: options.from, index };

		if (typeof options.using === "function") {
			return normalizeChildren(options.using(sliceContext));
		}

		const sliceOptions = isFanOutSliceOptions(slice) ? slice : {};
		return [
			step({
				role: sliceOptions.role ?? options.role,
				harness: sliceOptions.harness ?? options.harness,
				model: sliceOptions.model ?? options.model,
				goal: sliceOptions.goal ?? `${options.using}: ${name}`,
				context: [
					fromContext,
					...(options.context ?? []),
					...(sliceOptions.context ?? []),
				],
				instructions: sliceOptions.instructions ?? options.instructions,
				acceptanceCriteria:
					sliceOptions.acceptanceCriteria ?? options.acceptanceCriteria,
				constraints: sliceOptions.constraints ?? options.constraints,
				produces: target,
				validate: sliceOptions.validate ?? options.validate,
			}),
		];
	});

	return parallel({ id: options.id, status: options.status }, children);
}

export const branch = fanOut;

export function compare(props: CompareProps): CompareNode {
	return {
		kind: "compare",
		props,
	};
}

export function gate(props: GateProps): GateNode {
	return {
		kind: "gate",
		props,
	};
}

export function policy(options: PolicyProps, ...children: LoopTree[]): PolicyNode {
	return {
		kind: "policy",
		props: {
			...options,
			children: normalizeChildren(
				options.children === undefined ? children : [options.children, ...children],
			),
		},
	};
}

export function state(props: StateProps): StateNode {
	return {
		kind: "state",
		props,
	};
}

export const workflow = loop;
export const task = step;
export const protect = policy;
export const recover = repeat;

export type ParallelOptions = Omit<ParallelProps, "children">;
export type PolicyOptions = Omit<PolicyProps, "children">;
export type ProtectOptions = PolicyOptions;
export type RepeatOptions = Omit<RepeatProps, "children">;
export type RecoverOptions = RepeatOptions;
