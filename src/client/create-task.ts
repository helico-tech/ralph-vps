// Create task — generate sequential ID, write to pending/, commit + push

import { join } from "path";
import type { Task, TaskType } from "../core/types.js";
import { GitError, ERROR_CODES } from "../core/errors.js";
import type { ClientDeps } from "./types.js";

export interface CreateTaskOptions {
  title: string;
  type?: TaskType;
  priority?: number;
  description?: string;
  author?: string;
  acceptance_criteria?: string[];
  files?: string[];
  constraints?: string[];
}

/**
 * Generate the next sequential task ID (TASK-001, TASK-002, ...).
 * Scans existing tasks for the TASK-NNN pattern, finds the max, increments.
 */
export function generateNextId(tasks: Task[]): string {
  const pattern = /^TASK-(\d+)$/;
  let max = 0;
  for (const task of tasks) {
    const match = task.id.match(pattern);
    if (match) {
      max = Math.max(max, parseInt(match[1], 10));
    }
  }
  return `TASK-${String(max + 1).padStart(3, "0")}`;
}

export async function createTask(deps: ClientDeps, options: CreateTaskOptions): Promise<Task> {
  const tasks = await deps.repo.listAll();
  const id = generateNextId(tasks);
  const now = new Date().toISOString();

  const task: Task = {
    id,
    title: options.title,
    status: "pending",
    type: options.type ?? "feature",
    priority: options.priority ?? 100,
    created_at: now,
    author: options.author ?? "",
    description: options.description ?? "",
    max_retries: deps.config.task_defaults.max_retries,
    retry_count: 0,
  };

  if (options.acceptance_criteria) task.acceptance_criteria = options.acceptance_criteria;
  if (options.files) task.files = options.files;
  if (options.constraints) task.constraints = options.constraints;

  await deps.repo.create(task);

  // Stage the new file and commit
  await deps.git.stageFiles([join(deps.tasksDir, "pending", `${id}.md`)]);
  await deps.git.commit(`ralph(${id}): created`);

  const pushed = await deps.git.push();
  if (!pushed) {
    throw new GitError(ERROR_CODES.GIT_PUSH_FAILED, `Failed to push after creating '${id}'`);
  }

  return task;
}
