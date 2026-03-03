// State machine — pure state transitions, zero I/O

import type { Task, TaskStatus } from "./types.js";
import { TaskError, ERROR_CODES } from "./errors.js";

/**
 * Valid state transitions.
 * pending  -> active   (claimed by orchestrator)
 * active   -> review   (verification passed)
 * active   -> pending  (retry — retries remaining)
 * active   -> failed   (retry limit reached or permanent failure)
 * review   -> done     (approved by user)
 * review   -> pending  (rejected by user, re-queue)
 * review   -> failed   (rejected permanently)
 */
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["active"],
  active: ["review", "pending", "failed"],
  review: ["done", "pending", "failed"],
  done: [],
  failed: [],
};

/**
 * Returns the valid target statuses from a given status.
 */
export function getValidTransitions(status: TaskStatus): TaskStatus[] {
  return VALID_TRANSITIONS[status];
}

/**
 * Transition a task to a new status. Returns a new Task object.
 * Throws TaskError for invalid transitions.
 */
export function transitionTask(task: Task, target: TaskStatus, now?: string): Task {
  const valid = VALID_TRANSITIONS[task.status];

  if (!valid.includes(target)) {
    throw new TaskError(
      ERROR_CODES.INVALID_TRANSITION,
      `Cannot transition from '${task.status}' to '${target}'. Valid targets: ${valid.length > 0 ? valid.join(", ") : "none (terminal state)"}`
    );
  }

  const timestamp = now ?? new Date().toISOString();
  const updated = { ...task, status: target };

  // Apply transition-specific updates
  switch (`${task.status}->${target}`) {
    case "pending->active":
      updated.claimed_at = timestamp;
      break;

    case "active->pending":
      // Retry — enforce max_retries
      if (task.retry_count >= task.max_retries) {
        throw new TaskError(
          ERROR_CODES.INVALID_TRANSITION,
          `Task '${task.id}' has exhausted retries (${task.retry_count}/${task.max_retries}). Transition to 'failed' instead.`
        );
      }
      updated.retry_count = task.retry_count + 1;
      updated.claimed_at = undefined;
      break;

    case "active->review":
      // Keep claimed_at, completion metadata is set externally
      break;

    case "active->failed":
      updated.completed_at = timestamp;
      break;

    case "review->done":
      updated.completed_at = timestamp;
      break;

    case "review->pending":
      // Rejected — enforce max_retries before re-queue
      if (task.retry_count >= task.max_retries) {
        throw new TaskError(
          ERROR_CODES.INVALID_TRANSITION,
          `Task '${task.id}' has exhausted retries (${task.retry_count}/${task.max_retries}). Transition to 'failed' instead.`
        );
      }
      updated.retry_count = task.retry_count + 1;
      updated.claimed_at = undefined;
      break;

    case "review->failed":
      updated.completed_at = timestamp;
      break;
  }

  return updated;
}
