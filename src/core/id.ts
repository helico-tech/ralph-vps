// ID generation — pure function, zero I/O

import type { Task } from "./types.js";

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
