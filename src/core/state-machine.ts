// State machine — pure state transitions, zero I/O

import type { Task, TaskStatus } from "./types.js";
import { TaskError, ERROR_CODES } from "./errors.js";

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["active"],
  active: ["done", "failed"],
  done: [],
  failed: [],
};

export function getValidTransitions(status: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[status];
}

export function transitionTask(task: Task, target: TaskStatus): Task {
  const valid = VALID_TRANSITIONS[task.status];

  if (!valid.includes(target)) {
    throw new TaskError(
      ERROR_CODES.INVALID_TRANSITION,
      `Cannot transition '${task.id}' from '${task.status}' to '${target}'. Valid: ${valid.length > 0 ? valid.join(", ") : "none (terminal state)"}`,
    );
  }

  return { ...task, status: target };
}
