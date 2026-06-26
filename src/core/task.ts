import { step } from "./builder.js";
import type { StepNode, StepProps } from "./types.js";

export function Step(props: StepProps): StepNode {
	return step(props);
}

export const Task = Step;
