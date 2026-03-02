import type { Task } from "./task";
import { areDependenciesMet } from "./task";

export function getEligibleTasks(tasks: Task[]): Task[] {
  return tasks.filter(
    (t) => t.status === "pending" && areDependenciesMet(t, tasks)
  );
}

export function selectNextTask(tasks: Task[]): Task | null {
  const eligible = getEligibleTasks(tasks);
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    // Priority ASC (1 = highest priority)
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Order ASC
    if (a.order !== b.order) return a.order - b.order;
    // Created ASC (oldest first)
    return a.created.localeCompare(b.created);
  });

  return eligible[0];
}

export function isTaskCompleted(taskId: string, tasks: Task[]): boolean {
  const task = tasks.find((t) => t.id === taskId);
  return task?.status === "completed";
}
