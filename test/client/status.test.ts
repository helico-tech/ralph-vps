import { describe, it, expect } from "bun:test";
import { getStatus } from "../../src/client/status.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import type { Task } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
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

describe("getStatus", () => {
  it("counts tasks by status", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "t1", status: "pending" }), "pending");
    repo.seed(makeTask({ id: "t2", status: "pending" }), "pending");
    repo.seed(makeTask({ id: "t3", status: "active", claimed_at: "2026-03-03T12:00:00Z" }), "active");
    repo.seed(makeTask({ id: "t4", status: "done" }), "done");
    const git = new MockSourceControl();

    const report = await getStatus(repo, git);

    expect(report.counts.pending).toBe(2);
    expect(report.counts.active).toBe(1);
    expect(report.counts.done).toBe(1);
    expect(report.counts.review).toBe(0);
    expect(report.counts.failed).toBe(0);
    expect(report.total).toBe(4);
  });

  it("reports active task", async () => {
    const repo = new MockTaskRepository();
    repo.seed(
      makeTask({ id: "t1", status: "active", title: "Fix auth", claimed_at: "2026-03-03T12:00:00Z" }),
      "active",
    );
    const git = new MockSourceControl();

    const report = await getStatus(repo, git);

    expect(report.active_task).not.toBeNull();
    expect(report.active_task!.id).toBe("t1");
    expect(report.active_task!.title).toBe("Fix auth");
  });

  it("reports null when no active task", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "t1", status: "pending" }), "pending");
    const git = new MockSourceControl();

    const report = await getStatus(repo, git);
    expect(report.active_task).toBeNull();
  });

  it("includes last commit info", async () => {
    const repo = new MockTaskRepository();
    const git = new MockSourceControl();
    git.setLastCommit({ sha: "def5678", timestamp: "2026-03-03T12:30:00Z", message: "ralph: claimed" });

    const report = await getStatus(repo, git);

    expect(report.last_commit).not.toBeNull();
    expect(report.last_commit!.sha).toBe("def5678");
    expect(report.last_commit!.message).toBe("ralph: claimed");
  });

  it("handles null last commit", async () => {
    const repo = new MockTaskRepository();
    const git = new MockSourceControl();
    git.setLastCommit(null);

    const report = await getStatus(repo, git);
    expect(report.last_commit).toBeNull();
  });

  it("returns zero counts when no tasks exist", async () => {
    const repo = new MockTaskRepository();
    const git = new MockSourceControl();

    const report = await getStatus(repo, git);

    expect(report.total).toBe(0);
    expect(report.counts.pending).toBe(0);
    expect(report.active_task).toBeNull();
  });
});
