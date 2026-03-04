// List and sort tasks

import type { Task, TaskStatus } from "../core/types.js";
import type { TaskRepository } from "../ports/task-repository.js";

export interface ListTasksOptions {
  status?: TaskStatus;
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  active: 0,
  pending: 1,
  done: 2,
  failed: 3,
};

/**
 * Sort tasks by status group (active > pending > done > failed),
 * then by priority (lower = higher).
 */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return a.priority - b.priority;
  });
}

export async function listTasks(repo: TaskRepository, options?: ListTasksOptions): Promise<Task[]> {
  let tasks = await repo.listAll();
  if (options?.status) {
    tasks = tasks.filter((t) => t.status === options.status);
  }
  return sortTasks(tasks);
}
