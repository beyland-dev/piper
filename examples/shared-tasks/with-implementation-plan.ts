import { parallel, workflow, task, type TaskNode } from "piper";

interface WithImplementationPlanProps {
  planningGoal: string;
  planOutput: string;
  status?: string;
  steps?: TaskNode | TaskNode[];
}

export function withImplementationPlan({
  planningGoal,
  planOutput,
  status = "Waiting for the shared implementation plan...",
  steps
}: WithImplementationPlanProps) {
  return workflow(
    task({
      goal: planningGoal,
      harness: "pi",
      context: [
        "Produce a plan detailed enough that multiple follow-up tasks can execute independently.",
        "Prefer explicit file and validation guidance over general architectural advice."
      ],
      artifact: planOutput
    }),
    parallel({ status }, steps)
  );
}
