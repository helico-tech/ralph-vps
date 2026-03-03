// Task queue — pure deterministic task selection, zero I/O

import type { Task } from "./types.js";

/**
 * Pick the next task to execute from a list.
 * Filters to pending-only, sorts by priority (lower = higher priority),
 * then by created_at (oldest first). Returns null if no pending tasks.
 */
export function pickNextTask(tasks: Task[]): Task | null {
  const pending = tasks.filter((t) => t.status === "pending");

  if (pending.length === 0) return null;

  pending.sort((a, b) => {
    // Lower priority number = higher priority
    if (a.priority !== b.priority) return a.priority - b.priority;
    // Older tasks first
    return a.created_at.localeCompare(b.created_at);
  });

  return pending[0];
}
