import { describe, expect, test } from "bun:test";
import type { Task } from "../task";
import { getEligibleTasks, selectNextTask, isTaskCompleted } from "../task-selection";

const makeTask = (overrides: Partial<Task>): Task => ({
  id: "test",
  title: "Test",
  status: "pending",
  type: "feature-dev",
  priority: 2,
  order: 0,
  depends_on: [],
  created: "2026-03-02T00:00:00.000Z",
  body: "",
  filePath: "test.md",
  ...overrides,
});

describe("getEligibleTasks", () => {
  test("returns pending tasks with met dependencies", () => {
    const tasks = [
      makeTask({ id: "a", status: "pending" }),
      makeTask({ id: "b", status: "completed" }),
      makeTask({ id: "c", status: "in_progress" }),
    ];
    const eligible = getEligibleTasks(tasks);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe("a");
  });

  test("excludes tasks with unmet dependencies", () => {
    const tasks = [
      makeTask({ id: "a", status: "pending" }),
      makeTask({ id: "b", status: "pending", depends_on: ["a"] }),
    ];
    const eligible = getEligibleTasks(tasks);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe("a");
  });

  test("returns empty for all completed", () => {
    const tasks = [
      makeTask({ id: "a", status: "completed" }),
      makeTask({ id: "b", status: "completed" }),
    ];
    expect(getEligibleTasks(tasks)).toHaveLength(0);
  });
});

describe("selectNextTask", () => {
  test("returns null for empty list", () => {
    expect(selectNextTask([])).toBeNull();
  });

  test("returns null when all completed", () => {
    const tasks = [makeTask({ id: "a", status: "completed" })];
    expect(selectNextTask(tasks)).toBeNull();
  });

  test("selects highest priority first (lower number = higher priority)", () => {
    const tasks = [
      makeTask({ id: "low", priority: 3 }),
      makeTask({ id: "high", priority: 1 }),
      makeTask({ id: "med", priority: 2 }),
    ];
    expect(selectNextTask(tasks)?.id).toBe("high");
  });

  test("breaks priority tie with order", () => {
    const tasks = [
      makeTask({ id: "second", priority: 1, order: 2 }),
      makeTask({ id: "first", priority: 1, order: 1 }),
    ];
    expect(selectNextTask(tasks)?.id).toBe("first");
  });

  test("breaks order tie with created date", () => {
    const tasks = [
      makeTask({ id: "newer", priority: 1, order: 0, created: "2026-03-02T01:00:00.000Z" }),
      makeTask({ id: "older", priority: 1, order: 0, created: "2026-03-01T00:00:00.000Z" }),
    ];
    expect(selectNextTask(tasks)?.id).toBe("older");
  });

  test("skips tasks with unmet dependencies", () => {
    const tasks = [
      makeTask({ id: "blocked", priority: 1, depends_on: ["dep"] }),
      makeTask({ id: "dep", priority: 2, status: "pending" }),
    ];
    expect(selectNextTask(tasks)?.id).toBe("dep");
  });

  test("deterministic — same input always same output", () => {
    const tasks = [
      makeTask({ id: "b", priority: 2 }),
      makeTask({ id: "a", priority: 2, created: "2026-03-01T00:00:00.000Z" }),
    ];
    const first = selectNextTask(tasks);
    const second = selectNextTask(tasks);
    expect(first?.id).toBe(second?.id);
  });
});

describe("isTaskCompleted", () => {
  test("returns true for completed task", () => {
    const tasks = [makeTask({ id: "a", status: "completed" })];
    expect(isTaskCompleted("a", tasks)).toBe(true);
  });

  test("returns false for pending task", () => {
    const tasks = [makeTask({ id: "a", status: "pending" })];
    expect(isTaskCompleted("a", tasks)).toBe(false);
  });

  test("returns false for nonexistent task", () => {
    expect(isTaskCompleted("nonexistent", [])).toBe(false);
  });
});
