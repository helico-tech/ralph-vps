import { describe, it, expect } from "bun:test";
import { transitionTask, getValidTransitions } from "../../src/core/state-machine.js";
import { TaskError } from "../../src/core/errors.js";
import type { Task, TaskStatus } from "../../src/core/types.js";

const NOW = "2026-03-03T14:00:00Z";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Test task",
    status: "pending",
    type: "bugfix",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "Arjan",
    description: "A test task",
    max_retries: 2,
    retry_count: 0,
    ...overrides,
  };
}

describe("getValidTransitions", () => {
  it("returns valid targets for each status", () => {
    expect(getValidTransitions("pending")).toEqual(["active"]);
    expect(getValidTransitions("active")).toEqual(["review", "pending", "failed"]);
    expect(getValidTransitions("review")).toEqual(["done", "pending", "failed"]);
    expect(getValidTransitions("done")).toEqual([]);
    expect(getValidTransitions("failed")).toEqual([]);
  });
});

describe("transitionTask — valid transitions", () => {
  it("pending -> active (claim)", () => {
    const task = makeTask({ status: "pending" });
    const result = transitionTask(task, "active", NOW);
    expect(result.status).toBe("active");
    expect(result.claimed_at).toBe(NOW);
  });

  it("active -> review (verification passed)", () => {
    const task = makeTask({ status: "active", claimed_at: "2026-03-03T13:00:00Z" });
    const result = transitionTask(task, "review", NOW);
    expect(result.status).toBe("review");
    expect(result.claimed_at).toBe("2026-03-03T13:00:00Z");
  });

  it("active -> pending (retry)", () => {
    const task = makeTask({ status: "active", retry_count: 0, claimed_at: NOW });
    const result = transitionTask(task, "pending", NOW);
    expect(result.status).toBe("pending");
    expect(result.retry_count).toBe(1);
    expect(result.claimed_at).toBeUndefined();
  });

  it("active -> failed (permanent failure)", () => {
    const task = makeTask({ status: "active", retry_count: 2 });
    const result = transitionTask(task, "failed", NOW);
    expect(result.status).toBe("failed");
    expect(result.completed_at).toBe(NOW);
  });

  it("review -> done (approved)", () => {
    const task = makeTask({ status: "review" });
    const result = transitionTask(task, "done", NOW);
    expect(result.status).toBe("done");
    expect(result.completed_at).toBe(NOW);
  });

  it("review -> pending (rejected, re-queue)", () => {
    const task = makeTask({ status: "review", retry_count: 0 });
    const result = transitionTask(task, "pending", NOW);
    expect(result.status).toBe("pending");
    expect(result.retry_count).toBe(1);
    expect(result.claimed_at).toBeUndefined();
  });

  it("review -> failed (rejected permanently)", () => {
    const task = makeTask({ status: "review" });
    const result = transitionTask(task, "failed", NOW);
    expect(result.status).toBe("failed");
    expect(result.completed_at).toBe(NOW);
  });
});

describe("transitionTask — invalid transitions", () => {
  const invalidTransitions: [TaskStatus, TaskStatus][] = [
    ["pending", "review"],
    ["pending", "done"],
    ["pending", "failed"],
    ["pending", "pending"],
    ["active", "active"],
    ["review", "active"],
    ["review", "review"],
    ["done", "pending"],
    ["done", "active"],
    ["done", "review"],
    ["done", "failed"],
    ["done", "done"],
    ["failed", "pending"],
    ["failed", "active"],
    ["failed", "review"],
    ["failed", "done"],
    ["failed", "failed"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`throws on ${from} -> ${to}`, () => {
      const task = makeTask({ status: from });
      expect(() => transitionTask(task, to, NOW)).toThrow(TaskError);
    });
  }
});

describe("transitionTask — max_retries enforcement", () => {
  it("throws on active -> pending when retries exhausted", () => {
    const task = makeTask({ status: "active", retry_count: 2, max_retries: 2 });
    expect(() => transitionTask(task, "pending", NOW)).toThrow(TaskError);
    expect(() => transitionTask(task, "pending", NOW)).toThrow("exhausted retries");
  });

  it("throws on review -> pending when retries exhausted", () => {
    const task = makeTask({ status: "review", retry_count: 2, max_retries: 2 });
    expect(() => transitionTask(task, "pending", NOW)).toThrow(TaskError);
    expect(() => transitionTask(task, "pending", NOW)).toThrow("exhausted retries");
  });

  it("allows active -> pending when retries remain", () => {
    const task = makeTask({ status: "active", retry_count: 1, max_retries: 2 });
    const result = transitionTask(task, "pending", NOW);
    expect(result.status).toBe("pending");
    expect(result.retry_count).toBe(2);
  });

  it("allows review -> pending when retries remain", () => {
    const task = makeTask({ status: "review", retry_count: 0, max_retries: 2 });
    const result = transitionTask(task, "pending", NOW);
    expect(result.status).toBe("pending");
    expect(result.retry_count).toBe(1);
  });

  it("still allows active -> failed even when retries exhausted", () => {
    const task = makeTask({ status: "active", retry_count: 2, max_retries: 2 });
    const result = transitionTask(task, "failed", NOW);
    expect(result.status).toBe("failed");
  });
});

describe("transitionTask — immutability", () => {
  it("returns a new object, does not mutate the original", () => {
    const task = makeTask({ status: "pending" });
    const result = transitionTask(task, "active", NOW);
    expect(task.status).toBe("pending");
    expect(result.status).toBe("active");
    expect(task).not.toBe(result);
  });
});
