import {
	criticLoop,
	implementUntilTestsPass,
	loop,
	planThenImplement,
	researchThenSynthesize,
} from "@beyland/piper";

export default function recipeGalleryLoop() {
	return loop(
		{ objective: "Demonstrate composing high-level Piper recipes" },
		planThenImplement({
			objective: "Add a small user-facing improvement with a clear implementation plan",
			harness: "copilot",
			validate: ["pnpm typecheck"],
		}),
		implementUntilTestsPass({
			objective: "Fix regressions discovered after the improvement",
			harness: "copilot",
			testCommand: "pnpm test",
			maxAttempts: 2,
		}),
		researchThenSynthesize({
			objective: "Research follow-up improvements for the same area",
			harness: "copilot",
			topics: ["user experience", "test coverage", "documentation"],
		}),
		criticLoop({
			objective: "Critique the final change summary before handoff",
			harness: "copilot",
			maxAttempts: 2,
		}),
	);
}
