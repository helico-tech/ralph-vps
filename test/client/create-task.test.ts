import { describe, it, expect } from "bun:test";
import { generateNextId, createTask } from "../../src/client/create-task.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import { GitError } from "../../src/core/errors.js";
import type { Task, RalphConfig } from "../../src/core/types.js";
import type { ClientDeps } from "../../src/client/types.js";

const TEST_CONFIG: RalphConfig = {
  version: 1,
  project: { name: "test" },
  verify: "bun test",
  task_defaults: { model: "opus", max_turns: 50, timeout_seconds: 1800 },
  git: { main_branch: "main", branch_prefix: "ralph/" },
  execution: { permission_mode: "skip_all" },
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    status: "pending",
    type: "feature",
    priority: 100,
    description: "Do the thing.",
    ...overrides,
  };
}

function makeDeps(): ClientDeps & { repo: MockTaskRepository; git: MockSourceControl } {
  return {
    repo: new MockTaskRepository(),
    git: new MockSourceControl(),
    config: TEST_CONFIG,
    tasksDir: ".ralph/tasks",
  };
}

describe("generateNextId", () => {
  it("returns TASK-001 when no tasks exist", () => {
    expect(generateNextId([])).toBe("TASK-001");
  });

  it("increments from the highest existing ID", () => {
    const tasks = [
      makeTask({ id: "TASK-001" }),
      makeTask({ id: "TASK-003" }),
      makeTask({ id: "TASK-002" }),
    ];
    expect(generateNextId(tasks)).toBe("TASK-004");
  });

  it("ignores non-matching IDs", () => {
    const tasks = [
      makeTask({ id: "TASK-005" }),
      makeTask({ id: "custom-id" }),
      makeTask({ id: "legacy-42" }),
    ];
    expect(generateNextId(tasks)).toBe("TASK-006");
  });

  it("zero-pads to at least 3 digits", () => {
    expect(generateNextId([])).toBe("TASK-001");
    const tasks = [makeTask({ id: "TASK-009" })];
    expect(generateNextId(tasks)).toBe("TASK-010");
  });

  it("handles IDs beyond 3 digits", () => {
    const tasks = [makeTask({ id: "TASK-999" })];
    expect(generateNextId(tasks)).toBe("TASK-1000");
  });
});

describe("createTask", () => {
  it("creates a task with generated ID", async () => {
    const deps = makeDeps();
    const task = await createTask(deps, { description: "Fix the bug" });

    expect(task.id).toBe("TASK-001");
    expect(task.description).toBe("Fix the bug");
    expect(task.status).toBe("pending");
    expect(task.type).toBe("feature");
  });

  it("uses provided type and priority", async () => {
    const deps = makeDeps();
    const task = await createTask(deps, {
      description: "Fix auth crash",
      type: "bugfix",
      priority: 50,
    });

    expect(task.type).toBe("bugfix");
    expect(task.priority).toBe(50);
  });

  it("increments ID from existing tasks", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-003" }), "pending");

    const task = await createTask(deps, { description: "New task" });
    expect(task.id).toBe("TASK-004");
  });

  it("writes task to repository", async () => {
    const deps = makeDeps();
    const task = await createTask(deps, { description: "Stored task" });

    const stored = await deps.repo.findById(task.id);
    expect(stored).not.toBeNull();
    expect(stored!.description).toBe("Stored task");
    expect(stored!.status).toBe("pending");
  });

  it("stages, commits, and pushes", async () => {
    const deps = makeDeps();
    await createTask(deps, { description: "Git task" });

    expect(deps.git.staged).toHaveLength(1);
    expect(deps.git.staged[0]).toEqual([".ralph/tasks/pending/TASK-001.md"]);
    expect(deps.git.commits).toHaveLength(1);
    expect(deps.git.commits[0]).toContain("TASK-001");
  });

  it("throws GIT_PUSH_FAILED when push fails", async () => {
    const deps = makeDeps();
    deps.git.setPushFails(true);

    try {
      await createTask(deps, { description: "Push fail task" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitError);
      expect((err as GitError).code).toBe("GIT_PUSH_FAILED");
    }
  });
});
