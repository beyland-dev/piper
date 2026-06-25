import { isRuntimeValue } from "../core/output.js";
import type { RuntimeValueContext, ValidationValue } from "../core/types.js";
import { runCommand } from "../utils/process.js";

export async function runValidations(
	validations: ValidationValue[] | undefined,
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

		if (!isRuntimeValue(validation)) {
			failures.push("Encountered an invalid validation runtime value.");
			continue;
		}

		const passed = await validation.resolve(context);
		if (passed !== true) {
			failures.push(`Runtime value validation failed: ${validation.description}`);
		}
	}

	return failures;
}
