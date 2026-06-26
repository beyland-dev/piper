import { agent, evaluate, gate, loop, parallel, policy, repeat, step } from "../core/builder.js";
import { artifact } from "../core/output.js";
import type { EvaluationValue, RootLoopNode } from "../core/types.js";

export interface RecipeOptions {
	objective: string;
	harness?: string;
	model?: string;
	validate?: EvaluationValue[];
	maxAttempts?: number;
}

function defaultHarness(harness?: string): string {
	return harness ?? "copilot";
}

export function planThenImplement(options: RecipeOptions): RootLoopNode {
	const plan = artifact("plan", "plan");
	const summary = artifact("summary", "summary");
	const harnessName = defaultHarness(options.harness);

	return loop(
		{
			objective: options.objective,
			agents: [
				agent("planner", { harness: harnessName, model: options.model }),
				agent("implementer", { harness: harnessName, model: options.model }),
				agent("evaluator", { harness: harnessName, model: options.model }),
			],
		},
		step({
			role: "planner",
			goal: `Create an implementation plan for: ${options.objective}`,
			produces: plan,
		}),
		step({
			role: "implementer",
			goal: `Implement the plan for: ${options.objective}`,
			context: [plan],
		}),
		...(options.validate ?? []).map((using, index) =>
			evaluate({ name: `implementation validation ${index + 1}`, using }),
		),
		step({
			role: "evaluator",
			goal: `Summarize the completed implementation for: ${options.objective}`,
			context: [plan],
			produces: summary,
		}),
	);
}

export function implementUntilTestsPass(
	options: RecipeOptions & { testCommand: string },
): RootLoopNode {
	const testReport = artifact("test-report", "test-report");
	const harnessName = defaultHarness(options.harness);

	return loop(
		{
			objective: options.objective,
			agents: [agent("implementer", { harness: harnessName, model: options.model })],
		},
		repeat(
			{
				maxAttempts: options.maxAttempts ?? 3,
				until: [options.testCommand, ...(options.validate ?? [])],
			},
			step({
				role: "implementer",
				goal: `Implement or revise until tests pass: ${options.objective}`,
				produces: testReport,
			}),
		),
	);
}

export function researchThenSynthesize(
	options: RecipeOptions & { topics: string[] },
): RootLoopNode {
	const harnessName = defaultHarness(options.harness);
	const researchBranches = options.topics.map((topic) => ({
		topic,
		output: artifact(`research-${topic}`, "research"),
	}));
	const synthesis = artifact("synthesis", "summary");

	return loop(
		{
			objective: options.objective,
			agents: [
				agent("researcher", { harness: harnessName, model: options.model }),
				agent("synthesizer", { harness: harnessName, model: options.model }),
			],
		},
		parallel(
			{ status: "Running parallel research branches..." },
			...researchBranches.map(({ topic, output }) =>
				step({
					role: "researcher",
					goal: `Research ${topic} for: ${options.objective}`,
					produces: output,
				}),
			),
		),
		step({
			role: "synthesizer",
			goal: `Synthesize research for: ${options.objective}`,
			context: researchBranches.map((branch) => branch.output),
			produces: synthesis,
			validate: options.validate,
		}),
	);
}

export function criticLoop(options: RecipeOptions): RootLoopNode {
	const draft = artifact("draft", "artifact");
	const critique = artifact("critique", "review");
	const harnessName = defaultHarness(options.harness);

	return loop(
		{
			objective: options.objective,
			agents: [
				agent("creator", { harness: harnessName, model: options.model }),
				agent("critic", { harness: harnessName, model: options.model }),
			],
		},
		repeat(
			{ maxAttempts: options.maxAttempts ?? 3, until: options.validate },
			step({
				role: "creator",
				goal: `Create or revise output for: ${options.objective}`,
				produces: draft,
			}),
			step({
				role: "critic",
				goal: `Critique the draft for: ${options.objective}`,
				context: [draft],
				produces: critique,
			}),
		),
	);
}

export function parallelInvestigateThenDecide(
	options: RecipeOptions & { options: string[] },
): RootLoopNode {
	const harnessName = defaultHarness(options.harness);
	const investigations = options.options.map((name) => ({
		name,
		output: artifact(`investigation-${name}`, "research"),
	}));
	const decision = artifact("decision", "decision");

	return loop(
		{
			objective: options.objective,
			agents: [
				agent("investigator", { harness: harnessName, model: options.model }),
				agent("decider", { harness: harnessName, model: options.model }),
			],
		},
		parallel(
			...investigations.map(({ name, output }) =>
				step({
					role: "investigator",
					goal: `Investigate option ${name} for: ${options.objective}`,
					produces: output,
				}),
			),
		),
		step({
			role: "decider",
			goal: `Compare investigations and choose a path for: ${options.objective}`,
			context: investigations.map((investigation) => investigation.output),
			produces: decision,
			validate: options.validate,
		}),
	);
}

export function safeRefactor(
	options: RecipeOptions & { protectedFiles?: string[]; testCommand?: string },
): RootLoopNode {
	return loop(
		{ objective: options.objective },
		policy(
			{
				name: "safe refactor guardrails",
				protectedFiles: options.protectedFiles ?? [],
			},
			planThenImplement(options),
			...(options.testCommand
				? [evaluate({ name: "refactor tests", using: options.testCommand })]
				: []),
			gate({ name: "review refactor before risky follow-up" }),
		),
	);
}

export function migrationPlaybook(options: RecipeOptions): RootLoopNode {
	const inventory = artifact("inventory", "migration-map");
	const risks = artifact("risk-assessment", "risk-assessment");
	const playbook = artifact("migration-playbook", "plan");
	const harnessName = defaultHarness(options.harness);

	return loop(
		{
			objective: options.objective,
			agents: [
				agent("migration strategist", { harness: harnessName, model: options.model }),
				agent("risk reviewer", { harness: harnessName, model: options.model }),
			],
		},
		step({
			role: "migration strategist",
			goal: "Inventory migration surface",
			produces: inventory,
		}),
		step({
			role: "risk reviewer",
			goal: "Assess migration risk and rollback needs",
			context: [inventory],
			produces: risks,
		}),
		step({
			role: "migration strategist",
			goal: "Create phased migration playbook",
			context: [inventory, risks],
			produces: playbook,
			validate: options.validate,
		}),
		gate({ name: "approve migration playbook" }),
	);
}

export function releaseTrain(options: RecipeOptions): RootLoopNode {
	const notes = artifact("release-notes", "release-notes");
	const validation = artifact("release-validation", "test-report");
	const harnessName = defaultHarness(options.harness);

	return loop(
		{
			objective: options.objective,
			agents: [
				agent("release manager", { harness: harnessName, model: options.model }),
				agent("tester", { harness: harnessName, model: options.model }),
			],
		},
		step({ role: "release manager", goal: "Collect release changes", produces: notes }),
		step({
			role: "tester",
			goal: "Validate release readiness",
			context: [notes],
			produces: validation,
			validate: options.validate,
		}),
		gate({ name: "approve release train" }),
	);
}
