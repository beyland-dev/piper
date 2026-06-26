import { isRuntimeValue } from "../core/output.js";
import type { EvaluationValue, RuntimeValueContext } from "../core/types.js";
import { runCommand } from "../utils/process.js";

export async function runValidations(
	validations: EvaluationValue[] | undefined,
	context: RuntimeValueContext,
): Promise<string[]> {
	const failures: string[] = [];

	for (const validation of validations ?? []) {
		if (typeof validation === "string") {
			const result = await runCommand(validation, {
				cwd: context.workspacePath,
			});

			if (result.exitCode !== 0) {
				failures.push(
					[`Validation command failed: ${validation}`, result.stdout, result.stderr]
						.filter(Boolean)
						.join("\n"),
				);
			}

			continue;
		}

		if (isRuntimeValue(validation)) {
			const passed = await validation.resolve(context);
			if (passed !== true) {
				failures.push(`Runtime value validation failed: ${validation.description}`);
			}
			continue;
		}

		const result = await validation(context);
		const passed = typeof result === "boolean" ? result : result.passed;
		if (passed !== true) {
			failures.push(
				typeof result === "boolean"
					? "Function validation failed."
					: (result.feedback ?? "Function validation failed."),
			);
		}
	}

	return failures;
}
