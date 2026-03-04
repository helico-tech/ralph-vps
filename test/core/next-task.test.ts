import { describe, it, expect } from "bun:test";
import { buildNextTasks, resolveBranchName } from "../../src/core/next-task.js";
import type { Task } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    status: "done",
    type: "feature",
    priority: 100,
    description: "A test task.",
    ...overrides,
  };
}

describe("buildNextTasks", () => {
  describe("feature/bugfix tasks", () => {
    it("creates review task when feature passes", () => {
      const task = makeTask({ type: "feature" });
      const { followUps, shouldMerge } = buildNextTasks(task, true, "TASK-002");

      expect(followUps).toHaveLength(1);
      expect(followUps[0].type).toBe("review");
      expect(followUps[0].id).toBe("TASK-002");
      expect(followUps[0].parent_id).toBe("TASK-001");
      expect(followUps[0].priority).toBe(100);
      expect(shouldMerge).toBe(false);
    });

    it("creates review task when bugfix passes", () => {
      const task = makeTask({ type: "bugfix" });
      const { followUps, shouldMerge } = buildNextTasks(task, true, "TASK-002");

      expect(followUps).toHaveLength(1);
      expect(followUps[0].type).toBe("review");
      expect(shouldMerge).toBe(false);
    });

    it("creates no follow-ups when feature fails", () => {
      const task = makeTask({ type: "feature" });
      const { followUps, shouldMerge } = buildNextTasks(task, false, "TASK-002");

      expect(followUps).toHaveLength(0);
      expect(shouldMerge).toBe(false);
    });
  });

  describe("review tasks", () => {
    it("signals merge when review passes", () => {
      const task = makeTask({ type: "review", parent_id: "TASK-001" });
      const { followUps, shouldMerge } = buildNextTasks(task, true, "TASK-003");

      expect(followUps).toHaveLength(0);
      expect(shouldMerge).toBe(true);
    });

    it("creates fix task when review fails", () => {
      const task = makeTask({ id: "TASK-002", type: "review", parent_id: "TASK-001" });
      const { followUps, shouldMerge } = buildNextTasks(task, false, "TASK-003");

      expect(followUps).toHaveLength(1);
      expect(followUps[0].type).toBe("fix");
      expect(followUps[0].id).toBe("TASK-003");
      expect(followUps[0].parent_id).toBe("TASK-002");
      expect(shouldMerge).toBe(false);
    });
  });

  describe("fix tasks", () => {
    it("creates review task when fix passes", () => {
      const task = makeTask({ type: "fix", parent_id: "TASK-002" });
      const { followUps, shouldMerge } = buildNextTasks(task, true, "TASK-004");

      expect(followUps).toHaveLength(1);
      expect(followUps[0].type).toBe("review");
      expect(followUps[0].parent_id).toBe("TASK-001");
      expect(shouldMerge).toBe(false);
    });

    it("creates no follow-ups when fix fails (dead end)", () => {
      const task = makeTask({ type: "fix", parent_id: "TASK-002" });
      const { followUps, shouldMerge } = buildNextTasks(task, false, "TASK-004");

      expect(followUps).toHaveLength(0);
      expect(shouldMerge).toBe(false);
    });
  });

  describe("root_task_id propagation", () => {
    it("sets root_task_id on review spawned from feature", () => {
      const task = makeTask({ id: "TASK-001", type: "feature" });
      const { followUps } = buildNextTasks(task, true, "TASK-002");

      expect(followUps[0].root_task_id).toBe("TASK-001");
    });

    it("propagates root_task_id through fix spawned from review", () => {
      const review = makeTask({
        id: "TASK-002",
        type: "review",
        parent_id: "TASK-001",
        root_task_id: "TASK-001",
      });
      const { followUps } = buildNextTasks(review, false, "TASK-003");

      expect(followUps[0].root_task_id).toBe("TASK-001");
    });

    it("propagates root_task_id through second-gen review from fix", () => {
      const fix = makeTask({
        id: "TASK-003",
        type: "fix",
        parent_id: "TASK-002",
        root_task_id: "TASK-001",
      });
      const { followUps } = buildNextTasks(fix, true, "TASK-004");

      // The new review task should still point to the root feature
      expect(followUps[0].root_task_id).toBe("TASK-001");
      expect(followUps[0].parent_id).toBe("TASK-003");
    });
  });

  describe("review task description", () => {
    it("includes parent task reference", () => {
      const task = makeTask({ type: "feature", commit_hash: "abc123" });
      const { followUps } = buildNextTasks(task, true, "TASK-002");

      expect(followUps[0].description).toContain("TASK-001");
      expect(followUps[0].description).toContain("abc123");
    });
  });
});

describe("resolveBranchName", () => {
  it("uses task id for feature tasks", () => {
    const task = makeTask({ id: "TASK-001", type: "feature" });
    expect(resolveBranchName(task, "ralph/")).toBe("ralph/TASK-001");
  });

  it("uses task id for bugfix tasks", () => {
    const task = makeTask({ id: "TASK-001", type: "bugfix" });
    expect(resolveBranchName(task, "ralph/")).toBe("ralph/TASK-001");
  });

  it("uses root_task_id for review tasks", () => {
    const task = makeTask({
      id: "TASK-002",
      type: "review",
      parent_id: "TASK-001",
      root_task_id: "TASK-001",
    });
    expect(resolveBranchName(task, "ralph/")).toBe("ralph/TASK-001");
  });

  it("uses root_task_id for fix tasks (multi-hop)", () => {
    const task = makeTask({
      id: "TASK-003",
      type: "fix",
      parent_id: "TASK-002",
      root_task_id: "TASK-001",
    });
    expect(resolveBranchName(task, "ralph/")).toBe("ralph/TASK-001");
  });

  it("falls back to parent_id when root_task_id absent", () => {
    const task = makeTask({ id: "TASK-002", type: "review", parent_id: "TASK-001" });
    expect(resolveBranchName(task, "ralph/")).toBe("ralph/TASK-001");
  });

  it("handles custom branch prefix", () => {
    const task = makeTask({ id: "TASK-001", type: "feature" });
    expect(resolveBranchName(task, "auto/")).toBe("auto/TASK-001");
  });
});
