import { Suspense, Task, type TaskNode } from "agent-runtime";

interface WithImplementationPlanProps {
  planningGoal: string;
  planOutput: string;
  fallback?: string;
  children?: TaskNode | TaskNode[];
}

export function WithImplementationPlan({
  planningGoal,
  planOutput,
  fallback = "Waiting for the shared implementation plan...",
  children
}: WithImplementationPlanProps) {
  return (
    <>
      <Task
        goal={planningGoal}
        agent="pi"
        context={[
          "Produce a plan detailed enough that multiple follow-up tasks can execute independently.",
          "Prefer explicit file and validation guidance over general architectural advice."
        ]}
        output={planOutput}
      />

      <Suspense fallback={fallback}>{children}</Suspense>
    </>
  );
}