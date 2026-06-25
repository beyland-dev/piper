import { workflow, task, type TaskNode } from "piper";

interface WithTestsProps {
  testCommand?: string;
  steps?: TaskNode | TaskNode[];
}

export function withTests({ testCommand = "pnpm test", steps }: WithTestsProps) {
  return workflow(
    steps,
    task({
      goal: `Run \"${testCommand}\" and fix regressions introduced by the recent changes`,
      harness: "pi",
      context: [
        "Only fix tests that are failing because of this workflow's changes.",
        "Do not rewrite unrelated assertions or test fixtures just to make the suite green."
      ],
      validate: [testCommand]
    })
  );
}
