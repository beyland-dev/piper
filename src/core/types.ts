export type MaybePromise<T> = T | Promise<T>;

export interface ProgressUpdate {
	message: string;
	attempt: number;
	stream?: "stdout" | "stderr" | "system";
	timestamp: number;
}

export interface StepResult {
	output: string;
	modifiedFiles: string[];
	metadata?: Record<string, unknown>;
}

export interface StepError {
	message: string;
	logs?: string;
	modifiedFiles?: string[];
	retryable: boolean;
}

export interface StepHandle {
	readonly progress: AsyncIterable<ProgressUpdate>;
	readonly completed: Promise<StepResult>;
	readonly errored: Promise<StepError>;
}

export interface HarnessAdapter {
	name: string;
	startStep(params: {
		goal: string;
		model?: string;
		context: string[];
		constraints: string[];
		protectedFiles: string[];
		workspacePath: string;
	}): StepHandle;
	retry(stepHandle: StepHandle, failures: string[]): void;
	cancel(stepHandle: StepHandle): void;
}

export interface AgentDefinition<Name extends string = string> {
	readonly kind: "agent";
	readonly name: Name;
	readonly instructions?: string;
	readonly harness?: string;
	readonly model?: string;
	readonly capabilities: readonly string[];
	readonly constraints: readonly string[];
}

export interface HarnessDefinition<Name extends string = string> {
	readonly kind: "harness";
	readonly name: Name;
	readonly description?: string;
	readonly capabilities: readonly string[];
}

export interface RuntimeValueContext {
	workspacePath: string;
	readArtifact(name: string): Promise<string>;
	readStepResult(name: string): Promise<StepResult>;
	readState<T = unknown>(name: string): T | undefined;
	readFeedback(scope?: string): FeedbackRecord[];
}

export interface RuntimeValue<T> {
	readonly kind: "runtime-value";
	readonly description: string;
	readonly dependencies: readonly string[];
	resolve(context: RuntimeValueContext): MaybePromise<T>;
}

export interface Artifact<Name extends string = string, Type extends string = string> {
	readonly kind: "artifact";
	readonly name: Name;
	readonly type: Type;
	value(): RuntimeValue<string>;
	result(): RuntimeValue<StepResult>;
}

export type ArtifactTarget = string | Artifact;
export type ContextValue = string | RuntimeValue<string> | Artifact;
export type EvaluationValue = string | RuntimeValue<boolean> | EvaluatorFunction;

export interface FeedbackRecord {
	id: string;
	source: string;
	scope?: string;
	message: string;
	severity: "info" | "warning" | "error";
	timestamp: number;
	iteration?: number;
}

export interface RunEvent {
	type:
		| "loop:start"
		| "loop:complete"
		| "step:start"
		| "step:retry"
		| "step:complete"
		| "step:fail"
		| "evaluate:start"
		| "evaluate:pass"
		| "evaluate:fail"
		| "feedback"
		| "repeat:start"
		| "repeat:iteration"
		| "repeat:complete"
		| "parallel:start"
		| "parallel:complete"
		| "compare:complete"
		| "gate:approved"
		| "gate:rejected"
		| "policy:enter"
		| "policy:exit";
	message: string;
	timestamp: number;
	nodeId?: string;
	metadata?: Record<string, unknown>;
}

export interface EvaluationResult {
	passed: boolean;
	feedback?: string;
	metadata?: Record<string, unknown>;
}

export type EvaluatorFunction = (
	context: RuntimeValueContext,
) => MaybePromise<boolean | EvaluationResult>;

export interface LoopProps {
	id?: string;
	objective: string;
	agents?: AgentDefinition[];
	harnesses?: HarnessDefinition[];
	policies?: PolicyProps[];
	state?: Record<string, unknown>;
	stopWhen?: EvaluationValue[];
	children?: LoopTree;
}

export interface StepProps {
	id?: string;
	role?: string | AgentDefinition;
	goal: string;
	harness?: string;
	model?: string;
	context?: ContextValue[];
	instructions?: string;
	acceptanceCriteria?: string[];
	constraints?: string[];
	produces?: ArtifactTarget;
	validate?: EvaluationValue[];
	onComplete?: (result: StepResult) => void;
	onError?: (error: StepError) => void;
}

export interface EvaluateProps {
	id?: string;
	name: string;
	using: EvaluationValue;
	feedback?: string;
	scope?: string;
}

export interface RepeatProps {
	id?: string;
	maxAttempts?: number;
	onFailure?: (error: StepError, retry: () => void) => LoopTree;
	until?: EvaluationValue[];
	children?: LoopTree;
}

export interface ParallelProps {
	id?: string;
	status?: string;
	children?: LoopTree;
}

export interface CompareProps {
	id?: string;
	branches: Array<{ name: string; node: LoopNode }>;
	evaluator?: EvaluatorFunction;
	produces?: ArtifactTarget;
}

export interface GateProps {
	id?: string;
	name: string;
	approve?: boolean | EvaluatorFunction;
	message?: string;
}

export interface PolicyProps {
	id?: string;
	name?: string;
	constraints?: string[];
	protectedFiles?: string[];
	requiredGates?: string[];
	validate?: EvaluationValue[];
	children?: LoopTree;
}

export interface StateProps {
	name: string;
	value: unknown;
}

export interface FeedbackProps {
	id?: string;
	source?: string;
	scope?: string;
	message: string;
	severity?: FeedbackRecord["severity"];
}

export interface LoopNodeBase<K extends string, P> {
	kind: K;
	props: P;
}

export interface RootLoopNode extends LoopNodeBase<"loop", LoopProps & { children: LoopNode[] }> {}
export interface StepNode extends LoopNodeBase<"step", StepProps> {}
export interface EvaluateNode extends LoopNodeBase<"evaluate", EvaluateProps> {}
export interface RepeatNode extends LoopNodeBase<
	"repeat",
	RepeatProps & { children: LoopNode[] }
> {}
export interface ParallelNode extends LoopNodeBase<
	"parallel",
	ParallelProps & { children: LoopNode[] }
> {}
export interface CompareNode extends LoopNodeBase<"compare", CompareProps> {}
export interface GateNode extends LoopNodeBase<"gate", GateProps> {}
export interface PolicyNode extends LoopNodeBase<
	"policy",
	PolicyProps & { children: LoopNode[] }
> {}
export interface StateNode extends LoopNodeBase<"state", StateProps> {}
export interface FeedbackNode extends LoopNodeBase<"feedback", FeedbackProps> {}

export type ConcreteLoopNode =
	| RootLoopNode
	| StepNode
	| EvaluateNode
	| RepeatNode
	| ParallelNode
	| CompareNode
	| GateNode
	| PolicyNode
	| StateNode
	| FeedbackNode;

export type LoopNode = ConcreteLoopNode;
export type LoopTree = ConcreteLoopNode | LoopTree[] | null | undefined | false;

export interface StepAttemptInfo {
	id: string;
	goal: string;
	role?: string;
	harness: string;
	model?: string;
	attempt: number;
}

export interface ExecutionSummary {
	completedSteps: number;
	failedSteps: number;
	artifacts: Record<string, string>;
	feedback: FeedbackRecord[];
	events: RunEvent[];
	runId: string | null;
	artifactPath: string | null;
}

export interface RuntimeHooks {
	info(message: string): void;
	stepStarted(info: StepAttemptInfo): void;
	stepProgress(info: StepAttemptInfo, update: ProgressUpdate): void;
	stepRetry(info: StepAttemptInfo, failures: string[]): void;
	stepCompleted(info: StepAttemptInfo, result: StepResult): void;
	stepFailed(info: StepAttemptInfo, error: StepError): void;
	event(event: RunEvent): void;
	summary(summary: ExecutionSummary): void;
}

export interface ArtifactStorageOptions {
	rootDir?: string;
	runId?: string;
}

export interface ExecutorOptions {
	workspacePath: string;
	harnesses: HarnessAdapter[];
	hooks?: RuntimeHooks;
	stepRetryLimit?: number;
	artifactStorage?: ArtifactStorageOptions | false;
}
