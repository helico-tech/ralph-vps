import { describe, it, expect } from "bun:test";
import { calculateCosts, canClaimTask } from "../../src/core/budget.js";
import type { Task, CostSummary, BudgetLimits } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Test task",
    status: "done",
    type: "feature",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "Arjan",
    description: "",
    max_retries: 2,
    retry_count: 0,
    ...overrides,
  };
}

describe("calculateCosts", () => {
  it("sums costs from done and failed tasks", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done", cost_usd: 1.5, completed_at: "2026-03-03T12:00:00Z" }),
      makeTask({ id: "t2", status: "failed", cost_usd: 0.5, completed_at: "2026-03-03T13:00:00Z" }),
      makeTask({ id: "t3", status: "done", cost_usd: 2.0, completed_at: "2026-03-03T14:00:00Z" }),
    ];
    const result = calculateCosts(tasks, "2026-03-03T15:00:00Z");
    expect(result.total_usd).toBe(4.0);
    expect(result.today_usd).toBe(4.0);
    expect(result.task_count).toBe(3);
  });

  it("only counts today's costs for daily total", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done", cost_usd: 1.0, completed_at: "2026-03-02T12:00:00Z" }),
      makeTask({ id: "t2", status: "done", cost_usd: 2.0, completed_at: "2026-03-03T12:00:00Z" }),
    ];
    const result = calculateCosts(tasks, "2026-03-03T15:00:00Z");
    expect(result.total_usd).toBe(3.0);
    expect(result.today_usd).toBe(2.0);
  });

  it("ignores non-terminal tasks", () => {
    const tasks = [
      makeTask({ id: "t1", status: "pending", cost_usd: 10.0 }),
      makeTask({ id: "t2", status: "active", cost_usd: 10.0 }),
      makeTask({ id: "t3", status: "review", cost_usd: 10.0 }),
      makeTask({ id: "t4", status: "done", cost_usd: 1.0, completed_at: "2026-03-03T12:00:00Z" }),
    ];
    const result = calculateCosts(tasks, "2026-03-03T15:00:00Z");
    expect(result.total_usd).toBe(1.0);
    expect(result.task_count).toBe(1);
  });

  it("treats missing cost_usd as 0", () => {
    const tasks = [makeTask({ id: "t1", status: "done", completed_at: "2026-03-03T12:00:00Z" })];
    const result = calculateCosts(tasks, "2026-03-03T15:00:00Z");
    expect(result.total_usd).toBe(0);
  });

  it("returns zeros for empty array", () => {
    const result = calculateCosts([], "2026-03-03T15:00:00Z");
    expect(result.total_usd).toBe(0);
    expect(result.today_usd).toBe(0);
    expect(result.task_count).toBe(0);
  });
});

describe("canClaimTask", () => {
  it("returns true when costs are within limits", () => {
    const costs: CostSummary = { today_usd: 1.0, total_usd: 5.0, task_count: 3 };
    const limits: BudgetLimits = { daily_usd: 10.0, per_task_usd: 5.0 };
    expect(canClaimTask(costs, limits, 2.0)).toBe(true);
  });

  it("returns false when daily budget would be exceeded", () => {
    const costs: CostSummary = { today_usd: 8.0, total_usd: 20.0, task_count: 5 };
    const limits: BudgetLimits = { daily_usd: 10.0, per_task_usd: 5.0 };
    expect(canClaimTask(costs, limits, 5.0)).toBe(false);
  });

  it("returns false when per-task budget would be exceeded", () => {
    const costs: CostSummary = { today_usd: 1.0, total_usd: 5.0, task_count: 3 };
    const limits: BudgetLimits = { daily_usd: 100.0, per_task_usd: 3.0 };
    expect(canClaimTask(costs, limits, 5.0)).toBe(false);
  });

  it("returns false when costs exactly at daily limit", () => {
    const costs: CostSummary = { today_usd: 5.0, total_usd: 5.0, task_count: 1 };
    const limits: BudgetLimits = { daily_usd: 10.0, per_task_usd: 10.0 };
    expect(canClaimTask(costs, limits, 5.01)).toBe(false);
  });

  it("returns true when costs slightly under limit", () => {
    const costs: CostSummary = { today_usd: 4.99, total_usd: 4.99, task_count: 1 };
    const limits: BudgetLimits = { daily_usd: 10.0, per_task_usd: 10.0 };
    expect(canClaimTask(costs, limits, 5.0)).toBe(true);
  });

  it("returns true when zero costs and positive limits", () => {
    const costs: CostSummary = { today_usd: 0, total_usd: 0, task_count: 0 };
    const limits: BudgetLimits = { daily_usd: 10.0, per_task_usd: 5.0 };
    expect(canClaimTask(costs, limits, 2.0)).toBe(true);
  });

  it("returns true when limit is 0 (unlimited)", () => {
    const costs: CostSummary = { today_usd: 100.0, total_usd: 500.0, task_count: 50 };
    const limits: BudgetLimits = { daily_usd: 0, per_task_usd: 0 };
    expect(canClaimTask(costs, limits, 50.0)).toBe(true);
  });
});
