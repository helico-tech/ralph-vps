import type { Task } from "../domain/task";
import type { TaskSelector } from "../ports/task-selector";
import { selectNextTask } from "../domain/task-selection";

export class PriorityTaskSelector implements TaskSelector {
  selectNext(tasks: Task[]): Task | null {
    return selectNextTask(tasks);
  }
}
