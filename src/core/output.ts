import type { MaybePromise, Signal, SignalRuntimeContext } from "./types.js";

const SIGNAL_MARKER = Symbol.for("piper.signal");

type InternalSignal<T> = Signal<T> & {
  readonly [SIGNAL_MARKER]: true;
};

function createSignal<T>(
  description: string,
  resolver: (context: SignalRuntimeContext) => MaybePromise<T>
): Signal<T> {
  return {
    kind: "signal",
    description,
    resolve: resolver,
    [SIGNAL_MARKER]: true
  } as InternalSignal<T>;
}

export function isSignal(value: unknown): value is Signal<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<InternalSignal<unknown>>).kind === "signal" &&
    typeof (value as Partial<InternalSignal<unknown>>).resolve === "function"
  );
}

export function output(name: string): Signal<string> {
  return createSignal(`output(${name})`, (context) => context.readOutput(name));
}

export function derive<T>(
  resolver: (context: SignalRuntimeContext) => MaybePromise<T>,
  description = "derive"
): Signal<T> {
  return createSignal(description, resolver);
}
