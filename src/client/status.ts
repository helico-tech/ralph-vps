// Status report — aggregate task counts, active task, last commit

import type { TaskStatus } from "../core/types.js";
import type { TaskRepository } from "../ports/task-repository.js";
import type { SourceControl } from "../ports/source-control.js";
import type { StatusReport } from "./types.js";

export async function getStatus(
  repo: TaskRepository,
  git: SourceControl,
): Promise<StatusReport> {
  const tasks = await repo.listAll();
  const lastCommit = await git.lastCommit();

  const counts: Record<TaskStatus, number> = {
    pending: 0,
    active: 0,
    review: 0,
    done: 0,
    failed: 0,
  };

  let activeTask: StatusReport["active_task"] = null;

  for (const task of tasks) {
    counts[task.status]++;
    if (task.status === "active" && task.claimed_at) {
      activeTask = { id: task.id, title: task.title, claimed_at: task.claimed_at };
    }
  }

  return {
    counts,
    total: tasks.length,
    active_task: activeTask,
    last_commit: lastCommit,
  };
}
