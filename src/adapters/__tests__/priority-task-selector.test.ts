import { describe, expect, test } from "bun:test";
import { PriorityTaskSelector } from "../priority-task-selector";
import type { Task } from "../../domain/task";

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

describe("PriorityTaskSelector", () => {
  const selector = new PriorityTaskSelector();

  test("implements TaskSelector interface", () => {
    expect(typeof selector.selectNext).toBe("function");
  });

  test("delegates to domain selectNextTask", () => {
    const tasks = [
      makeTask({ id: "low", priority: 3 }),
      makeTask({ id: "high", priority: 1 }),
    ];
    const next = selector.selectNext(tasks);
    expect(next?.id).toBe("high");
  });

  test("returns null for empty list", () => {
    expect(selector.selectNext([])).toBeNull();
  });
});
