// Budget enforcement — pure predicates, zero I/O

import type { Task, CostSummary, BudgetLimits } from "./types.js";

/**
 * Calculate cost summary from completed/failed tasks.
 * Takes an explicit date for "today" to remain pure.
 */
export function calculateCosts(tasks: Task[], today: string): CostSummary {
  const todayDate = today.slice(0, 10); // "2026-03-03"
  let total_usd = 0;
  let today_usd = 0;
  let task_count = 0;

  for (const task of tasks) {
    if (task.status !== "done" && task.status !== "failed") continue;
    const cost = task.cost_usd ?? 0;
    total_usd += cost;
    task_count++;

    const taskDate = (task.completed_at ?? task.created_at).slice(0, 10);
    if (taskDate === todayDate) {
      today_usd += cost;
    }
  }

  return { today_usd, total_usd, task_count };
}

/**
 * Check if a new task can be claimed given current costs and limits.
 * Returns true if all limits have headroom.
 * A limit of 0 means unlimited.
 */
export function canClaimTask(
  costs: CostSummary,
  limits: BudgetLimits,
  taskBudget: number,
): boolean {
  // Check daily budget (0 = unlimited)
  if (limits.daily_usd > 0 && costs.today_usd + taskBudget > limits.daily_usd) {
    return false;
  }

  // Check per-task budget (0 = unlimited)
  if (limits.per_task_usd > 0 && taskBudget > limits.per_task_usd) {
    return false;
  }

  return true;
}
