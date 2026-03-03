// Consistency checks — pure logic over task data, zero I/O

import type { Task, TaskStatus, ConsistencyReport, ConsistencyIssue } from "./types.js";

const SCANNED_STATUSES: TaskStatus[] = ["pending", "active", "review"];

/**
 * Check consistency of tasks. Only scans pending, active, and review.
 * Terminal states (done, failed) are skipped.
 *
 * Takes a list of tasks and a list of existing branches.
 * Returns a report with all found issues.
 */
export function checkConsistency(
  tasks: Task[],
  existingBranches: string[],
  branchPrefix: string,
): ConsistencyReport {
  const issues: ConsistencyIssue[] = [];
  const nonTerminal = tasks.filter((t) => SCANNED_STATUSES.includes(t.status));
  const branchSet = new Set(existingBranches);

  // Check for duplicate IDs across non-terminal statuses
  const idCounts = new Map<string, number>();
  for (const task of nonTerminal) {
    idCounts.set(task.id, (idCounts.get(task.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      issues.push({
        type: "duplicate_id",
        task_id: id,
        message: `Task ID '${id}' appears ${count} times across non-terminal statuses`,
      });
    }
  }

  // Check for active tasks without matching branches
  const activeTasks = nonTerminal.filter((t) => t.status === "active");
  for (const task of activeTasks) {
    const expectedBranch = `${branchPrefix}${task.id}`;
    if (!branchSet.has(expectedBranch)) {
      issues.push({
        type: "missing_branch",
        task_id: task.id,
        message: `Task '${task.id}' is active but branch '${expectedBranch}' does not exist`,
      });
    }
  }

  return {
    issues,
    scanned_statuses: SCANNED_STATUSES,
    clean: issues.length === 0,
  };
}
