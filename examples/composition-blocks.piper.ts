import {
	agent,
	artifact,
	evaluate,
	loop,
	parallel,
	policy,
	repeat,
	step,
	type ContextValue,
	type LoopTree,
} from "@beyland/piper";

function withSharedPlan({
	goal,
	output,
	children,
}: {
	goal: string;
	output: string;
	children: LoopTree;
}) {
	return loop(
		step({
			role: "planner",
			goal,
			produces: output,
		}),
		children,
	);
}

function withTestRepair({ command, children }: { command: string; children: LoopTree }) {
	return repeat(
		{ maxAttempts: 3, until: [command] },
		children,
		evaluate({
			name: "tests pass",
			using: command,
			feedback: "Use the test output to revise only the changes from this loop.",
		}),
	);
}

function withRiskReview({
	protectedFiles,
	context,
}: {
	protectedFiles: string[];
	context: ContextValue[];
}) {
	return policy(
		{
			name: "risk review boundary",
			protectedFiles,
			constraints: ["Do not modify protected files while performing the review."],
		},
		step({
			role: "reviewer",
			goal: "Review the change for rollout risk, rollback gaps, and follow-up work",
			context,
			produces: "risk-review",
		}),
	);
}

const plan = artifact("checkout-plan", "plan");
const apiChange = artifact("checkout-api-change", "implementation");
const uiChange = artifact("checkout-ui-change", "implementation");

export default loop(
	{
		objective: "Compose a checkout improvement from reusable Piper blocks",
		agents: [
			agent("planner", { harness: "copilot" }),
			agent("implementer", { harness: "copilot" }),
			agent("reviewer", { harness: "copilot" }),
		],
	},
	withSharedPlan({
		goal: "Plan a small checkout reliability improvement with API and UI slices",
		output: plan.name,
		children: withTestRepair({
			command: "pnpm test -- checkout",
			children: [
				parallel(
					{ status: "Implementing checkout slices from the shared plan..." },
					step({
						role: "implementer",
						goal: "Implement the API slice of the checkout improvement",
						context: [plan],
						produces: apiChange,
					}),
					step({
						role: "implementer",
						goal: "Implement the UI slice of the checkout improvement",
						context: [plan],
						produces: uiChange,
					}),
				),
				withRiskReview({
					protectedFiles: ["infra/production.tf", ".github/workflows/release.yml"],
					context: [
						plan,
						apiChange,
						uiChange,
						"Confirm the change is safe to roll out independently.",
					],
				}),
			],
		}),
	}),
);
