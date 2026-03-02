import type { Task } from "../domain/task";

export interface TaskSelector {
  selectNext(tasks: Task[]): Task | null;
}
