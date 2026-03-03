import { describe, it, expect } from "bun:test";
import { checkConsistency } from "../../src/core/consistency.js";
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

describe("checkConsistency", () => {
  it("returns clean for consistent state", () => {
    const tasks = [
      makeTask({ id: "t1", status: "pending" }),
      makeTask({ id: "t2", status: "active" }),
    ];
    const branches = ["ralph/t2"];
    const report = checkConsistency(tasks, branches, "ralph/");
    expect(report.clean).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it("detects active task with no matching branch", () => {
    const tasks = [makeTask({ id: "t1", status: "active" })];
    const report = checkConsistency(tasks, [], "ralph/");
    expect(report.clean).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].type).toBe("missing_branch");
    expect(report.issues[0].task_id).toBe("t1");
  });

  it("detects duplicate task IDs across non-terminal statuses", () => {
    const tasks = [
      makeTask({ id: "t1", status: "pending" }),
      makeTask({ id: "t1", status: "review" }),
    ];
    const report = checkConsistency(tasks, [], "ralph/");
    expect(report.clean).toBe(false);
    const dupes = report.issues.filter((i) => i.type === "duplicate_id");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].message).toContain("2 times");
  });

  it("skips terminal states (done, failed)", () => {
    const tasks = [
      makeTask({ id: "t1", status: "done" }),
      makeTask({ id: "t1", status: "failed" }),
      makeTask({ id: "t2", status: "done" }),
    ];
    const report = checkConsistency(tasks, [], "ralph/");
    expect(report.clean).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it("reports multiple issues in a single scan", () => {
    const tasks = [
      makeTask({ id: "t1", status: "active" }), // no branch
      makeTask({ id: "t2", status: "pending" }),
      makeTask({ id: "t2", status: "review" }), // duplicate
    ];
    const report = checkConsistency(tasks, [], "ralph/");
    expect(report.clean).toBe(false);
    expect(report.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("scans only pending, active, review", () => {
    const tasks = [makeTask({ id: "t1", status: "pending" })];
    const report = checkConsistency(tasks, [], "ralph/");
    expect(report.scanned_statuses).toEqual(["pending", "active", "review"]);
  });

  it("handles empty task list", () => {
    const report = checkConsistency([], [], "ralph/");
    expect(report.clean).toBe(true);
    expect(report.issues).toHaveLength(0);
  });
});
