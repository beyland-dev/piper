import { isRuntimeValue } from "../core/output.js";
import type { EvaluationValue, RuntimeValueContext } from "../core/types.js";
import { runCommand } from "../utils/process.js";

export async function runEvaluations(
	evaluations: EvaluationValue[] | undefined,
	context: RuntimeValueContext,
): Promise<string[]> {
	const failures: string[] = [];

	for (const evaluation of evaluations ?? []) {
		if (typeof evaluation === "string") {
			const result = await runCommand(evaluation, {
				cwd: context.workspacePath,
			});

			if (result.exitCode !== 0) {
				failures.push(
					[`Evaluation command failed: ${evaluation}`, result.stdout, result.stderr]
						.filter(Boolean)
						.join("\n"),
				);
			}

			continue;
		}

		if (isRuntimeValue(evaluation)) {
			const passed = await evaluation.resolve(context);
			if (passed !== true) {
				failures.push(`Runtime value evaluation failed: ${evaluation.description}`);
			}
			continue;
		}

		const result = await evaluation(context);
		const passed = typeof result === "boolean" ? result : result.passed;
		if (passed !== true) {
			failures.push(
				typeof result === "boolean"
					? "Function evaluation failed."
					: (result.feedback ?? "Function evaluation failed."),
			);
		}
	}

	return failures;
}

export { runEvaluations as runValidations };
