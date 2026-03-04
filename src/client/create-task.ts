// Create task — write to pending/, commit + push

import { join } from "path";
import type { Task, TaskType } from "../core/types.js";
import { GitError, ERROR_CODES } from "../core/errors.js";
import { generateNextId } from "../core/id.js";
import type { ClientDeps } from "./types.js";

// Re-export for backward compatibility
export { generateNextId } from "../core/id.js";

export interface CreateTaskOptions {
  type?: TaskType;
  priority?: number;
  description?: string;
}

export async function createTask(deps: ClientDeps, options: CreateTaskOptions): Promise<Task> {
  const tasks = await deps.repo.listAll();
  const id = generateNextId(tasks);

  const task: Task = {
    id,
    status: "pending",
    type: options.type ?? "feature",
    priority: options.priority ?? 100,
    description: options.description ?? "",
  };

  await deps.repo.create(task);

  await deps.git.stageFiles([join(deps.tasksDir, "pending", `${id}.md`)]);
  await deps.git.commit(`ralph(${id}): created`);

  const pushed = await deps.git.push();
  if (!pushed) {
    throw new GitError(ERROR_CODES.GIT_PUSH_FAILED, `Failed to push after creating '${id}'`);
  }

  return task;
}
