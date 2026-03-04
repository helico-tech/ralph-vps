import { describe, it, expect } from "bun:test";
import { transitionTask, getValidTransitions } from "../../src/core/state-machine.js";
import { TaskError } from "../../src/core/errors.js";
import type { Task, TaskStatus } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    status: "pending",
    type: "bugfix",
    priority: 100,
    description: "A test task",
    ...overrides,
  };
}

describe("getValidTransitions", () => {
  it("returns valid targets for each status", () => {
    expect(getValidTransitions("pending")).toEqual(["active"]);
    expect(getValidTransitions("active")).toEqual(["done", "failed"]);
    expect(getValidTransitions("done")).toEqual([]);
    expect(getValidTransitions("failed")).toEqual([]);
  });
});

describe("transitionTask — valid transitions", () => {
  it("pending -> active (claim)", () => {
    const task = makeTask({ status: "pending" });
    const result = transitionTask(task, "active");
    expect(result.status).toBe("active");
  });

  it("active -> done (verification passed)", () => {
    const task = makeTask({ status: "active" });
    const result = transitionTask(task, "done");
    expect(result.status).toBe("done");
  });

  it("active -> failed (permanent failure)", () => {
    const task = makeTask({ status: "active" });
    const result = transitionTask(task, "failed");
    expect(result.status).toBe("failed");
  });
});

describe("transitionTask — invalid transitions", () => {
  const invalidTransitions: [TaskStatus, TaskStatus][] = [
    ["pending", "done"],
    ["pending", "failed"],
    ["pending", "pending"],
    ["active", "active"],
    ["active", "pending"],
    ["done", "pending"],
    ["done", "active"],
    ["done", "failed"],
    ["done", "done"],
    ["failed", "pending"],
    ["failed", "active"],
    ["failed", "done"],
    ["failed", "failed"],
  ];

  for (const [from, to] of invalidTransitions) {
    it(`throws on ${from} -> ${to}`, () => {
      const task = makeTask({ status: from });
      expect(() => transitionTask(task, to)).toThrow(TaskError);
    });
  }
});

describe("transitionTask — immutability", () => {
  it("returns a new object, does not mutate the original", () => {
    const task = makeTask({ status: "pending" });
    const result = transitionTask(task, "active");
    expect(task.status).toBe("pending");
    expect(result.status).toBe("active");
    expect(task).not.toBe(result);
  });
});
