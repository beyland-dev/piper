import type {
	Artifact,
	MaybePromise,
	RuntimeValue,
	RuntimeValueContext,
	StepResult,
} from "./types.js";

const RUNTIME_VALUE_MARKER = Symbol.for("piper.runtime-value");
const ARTIFACT_MARKER = Symbol.for("piper.artifact");

type InternalRuntimeValue<T> = RuntimeValue<T> & {
	readonly [RUNTIME_VALUE_MARKER]: true;
};

type InternalArtifact<Name extends string = string, Type extends string = string> = Artifact<
	Name,
	Type
> & {
	readonly [ARTIFACT_MARKER]: true;
};

function createRuntimeValue<T>(
	description: string,
	resolver: (context: RuntimeValueContext) => MaybePromise<T>,
	dependencies: readonly string[] = [],
): RuntimeValue<T> {
	return {
		kind: "runtime-value",
		description,
		dependencies,
		resolve: resolver,
		[RUNTIME_VALUE_MARKER]: true,
	} as InternalRuntimeValue<T>;
}

export function isRuntimeValue(value: unknown): value is RuntimeValue<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Partial<InternalRuntimeValue<unknown>>).kind === "runtime-value" &&
		typeof (value as Partial<InternalRuntimeValue<unknown>>).resolve === "function"
	);
}

export function isArtifact(value: unknown): value is Artifact {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Partial<InternalArtifact>).kind === "artifact" &&
		typeof (value as Partial<InternalArtifact>).name === "string"
	);
}

export function getArtifactName(artifact: string | Artifact): string {
	return typeof artifact === "string" ? artifact : artifact.name;
}

export function artifact<Name extends string>(name: Name): Artifact<Name, "artifact">;
export function artifact<Name extends string, Type extends string>(
	name: Name,
	type: Type,
): Artifact<Name, Type>;
export function artifact<Name extends string, Type extends string>(
	name: Name,
	type?: Type,
): Artifact<Name, Type | "artifact"> {
	const artifactType = type ?? "artifact";
	const value = createRuntimeValue(
		`artifact value(${name})`,
		(context) => context.readArtifact(name),
		[name],
	);
	const result = createRuntimeValue<StepResult>(
		`artifact result(${name})`,
		(context) => context.readStepResult(name),
		[name],
	);

	return {
		kind: "artifact",
		name,
		type: artifactType,
		value: () => value,
		result: () => result,
		[ARTIFACT_MARKER]: true,
	} as InternalArtifact<Name, Type | "artifact">;
}

export function runtimeValue<T>(
	resolver: (context: RuntimeValueContext) => MaybePromise<T>,
	description = "runtimeValue",
	dependencies: readonly string[] = [],
): RuntimeValue<T> {
	return createRuntimeValue(description, resolver, dependencies);
}
