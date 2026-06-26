import { agent, artifact, fanOut, input, loop, step } from "@beyland/piper";

type FeatureSlice = {
	name: string;
	owner: string;
	risk: string;
};

function loadPrioritizedSlices(): FeatureSlice[] {
	return [
		{ name: "api", owner: "checkout platform", risk: "token refresh retry behavior" },
		{ name: "ui", owner: "checkout web", risk: "clear customer recovery messaging" },
		{ name: "telemetry", owner: "observability", risk: "retry budget alert coverage" },
	];
}

function formatSlices(slices: FeatureSlice[]): string {
	return [
		"Source: prioritized feature slice inventory",
		...slices.map((slice) => `- ${slice.name}: ${slice.owner}; risk: ${slice.risk}`),
	].join("\n");
}

const slices = loadPrioritizedSlices();
const sliceInventory = input("prioritized-slices", () => formatSlices(slices), {
	description: "prioritized feature slice inventory",
});
const plan = artifact("slice-plan", "plan");

export default loop(
	{
		objective: "Fan out implementation work from a data-driven slice inventory",
		agents: [
			agent("planner", { harness: "copilot" }),
			agent("implementer", { harness: "copilot" }),
		],
	},
	step({
		role: "planner",
		goal: "Create a shared implementation plan from the prioritized slice inventory.",
		context: [sliceInventory],
		produces: plan,
	}),
	fanOut({
		from: plan,
		into: slices.map((slice) => ({
			name: `${slice.name}-change`,
			goal: `Implement the ${slice.name} slice owned by ${slice.owner}`,
			context: [`Slice risk to address: ${slice.risk}`],
		})),
		using: "Implement data-driven slice",
		role: "implementer",
		status: "Implementing prioritized slices from external data...",
	}),
);
