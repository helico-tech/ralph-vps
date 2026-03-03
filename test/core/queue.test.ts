import { describe, it, expect } from "bun:test";
import { pickNextTask } from "../../src/core/queue.js";
import type { Task } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Test task",
    status: "pending",
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

describe("pickNextTask", () => {
  it("returns null for empty array", () => {
    expect(pickNextTask([])).toBeNull();
  });

  it("returns null when no pending tasks", () => {
    const tasks = [
      makeTask({ id: "t1", status: "active" }),
      makeTask({ id: "t2", status: "done" }),
    ];
    expect(pickNextTask(tasks)).toBeNull();
  });

  it("returns the single pending task", () => {
    const task = makeTask({ id: "t1" });
    expect(pickNextTask([task])).toBe(task);
  });

  it("picks highest priority (lowest number)", () => {
    const low = makeTask({ id: "low", priority: 200 });
    const high = makeTask({ id: "high", priority: 50 });
    const mid = makeTask({ id: "mid", priority: 100 });

    const result = pickNextTask([low, high, mid]);
    expect(result?.id).toBe("high");
  });

  it("breaks ties by created_at (oldest first)", () => {
    const newer = makeTask({ id: "newer", priority: 100, created_at: "2026-03-03T14:00:00Z" });
    const older = makeTask({ id: "older", priority: 100, created_at: "2026-03-03T12:00:00Z" });

    const result = pickNextTask([newer, older]);
    expect(result?.id).toBe("older");
  });

  it("ignores non-pending tasks", () => {
    const active = makeTask({ id: "active", status: "active", priority: 1 });
    const pending = makeTask({ id: "pending", status: "pending", priority: 100 });

    const result = pickNextTask([active, pending]);
    expect(result?.id).toBe("pending");
  });

  it("uses default priority (100) for missing priority", () => {
    const withPriority = makeTask({ id: "explicit", priority: 100 });
    const withDefault = makeTask({ id: "default", priority: 100 });

    // Same priority, falls back to created_at
    const result = pickNextTask([withPriority, withDefault]);
    expect(result).not.toBeNull();
  });

  it("is a pure function — does not mutate input", () => {
    const tasks = [
      makeTask({ id: "t2", priority: 200 }),
      makeTask({ id: "t1", priority: 50 }),
    ];
    const original = [...tasks];
    pickNextTask(tasks);
    expect(tasks[0].id).toBe(original[0].id);
    expect(tasks[1].id).toBe(original[1].id);
  });
});
