import type { TaskElement, TaskProps } from "./types.js";

export function Task(props: TaskProps): TaskElement {
  return {
    kind: "task",
    props
  };
}
