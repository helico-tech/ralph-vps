import { describe, it, expect } from "bun:test";
import { sortTasks, listTasks } from "../../src/client/list-tasks.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import type { Task } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    status: "pending",
    type: "feature",
    priority: 100,
    description: "",
    ...overrides,
  };
}

describe("sortTasks", () => {
  it("sorts by status group order", () => {
    const tasks = [
      makeTask({ id: "t1", status: "pending" }),
      makeTask({ id: "t2", status: "active" }),
      makeTask({ id: "t3", status: "done" }),
      makeTask({ id: "t4", status: "failed" }),
    ];
    const sorted = sortTasks(tasks);
    expect(sorted.map((t) => t.status)).toEqual(["active", "pending", "done", "failed"]);
  });

  it("sorts by priority within same status", () => {
    const tasks = [
      makeTask({ id: "t1", status: "pending", priority: 100 }),
      makeTask({ id: "t2", status: "pending", priority: 10 }),
      makeTask({ id: "t3", status: "pending", priority: 50 }),
    ];
    const sorted = sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("does not mutate the original array", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t2", status: "active" }),
    ];
    const sorted = sortTasks(tasks);
    expect(sorted).not.toBe(tasks);
    expect(tasks[0].id).toBe("t1");
  });
});

describe("listTasks", () => {
  it("returns all tasks sorted", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "t1", status: "done" }), "done");
    repo.seed(makeTask({ id: "t2", status: "pending" }), "pending");
    repo.seed(makeTask({ id: "t3", status: "active" }), "active");

    const tasks = await listTasks(repo);
    expect(tasks.map((t) => t.status)).toEqual(["active", "pending", "done"]);
  });

  it("filters by status", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "t1", status: "pending" }), "pending");
    repo.seed(makeTask({ id: "t2", status: "done" }), "done");
    repo.seed(makeTask({ id: "t3", status: "pending" }), "pending");

    const tasks = await listTasks(repo, { status: "pending" });
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === "pending")).toBe(true);
  });

  it("returns empty array when no tasks match", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "t1", status: "done" }), "done");

    const tasks = await listTasks(repo, { status: "pending" });
    expect(tasks).toHaveLength(0);
  });
});
