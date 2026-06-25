import { parallel, sequence, task, type TaskNode } from "agent-runtime";

interface WithImplementationPlanProps {
  planningGoal: string;
  planOutput: string;
  fallback?: string;
  steps?: TaskNode | TaskNode[];
}

export function withImplementationPlan({
  planningGoal,
  planOutput,
  fallback = "Waiting for the shared implementation plan...",
  steps
}: WithImplementationPlanProps) {
  return sequence(
    task({
      goal: planningGoal,
      agent: "pi",
      context: [
        "Produce a plan detailed enough that multiple follow-up tasks can execute independently.",
        "Prefer explicit file and validation guidance over general architectural advice."
      ],
      output: planOutput
    }),
    parallel({ fallback }, steps)
  );
}
