import { Task, type TaskNode } from "agent-runtime";

interface WithTestsProps {
  testCommand?: string;
  children?: TaskNode | TaskNode[];
}

export function WithTests({ testCommand = "pnpm test", children }: WithTestsProps) {
  return (
    <>
      {children}
      <Task
        goal={`Run \"${testCommand}\" and fix regressions introduced by the recent changes`}
        agent="pi"
        context={[
          "Only fix tests that are failing because of this workflow's changes.",
          "Do not rewrite unrelated assertions or test fixtures just to make the suite green."
        ]}
        validate={[testCommand]}
      />
    </>
  );
}