import { describe, it, expect } from "bun:test";
import { reviewTask } from "../../src/client/review-task.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import { TaskError, GitError } from "../../src/core/errors.js";
import type { Task, RalphConfig } from "../../src/core/types.js";
import type { ClientDeps } from "../../src/client/types.js";

const TEST_CONFIG: RalphConfig = {
  version: 1,
  project: { name: "test" },
  verify: { test: "bun test", build: "", lint: "" },
  task_defaults: { max_retries: 2, model: "opus", max_turns: 50, max_budget_usd: 5, timeout_seconds: 1800 },
  exit_criteria: { require_tests: true, require_build: false, require_lint: false },
  git: { main_branch: "main", branch_prefix: "ralph/" },
  execution: { permission_mode: "skip_all" },
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    title: "Test task",
    status: "review",
    type: "feature",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "Arjan",
    description: "Do the thing.",
    max_retries: 2,
    retry_count: 0,
    branch: "ralph/TASK-001",
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

describe("reviewTask — approve", () => {
  it("transitions task to done", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    const result = await reviewTask(deps, "TASK-001", { decision: "approve" });
    expect(result.status).toBe("done");
  });

  it("merges the feature branch", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001", branch: "ralph/TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "approve" });
    expect(deps.git.mergedBranches).toContain("ralph/TASK-001");
  });

  it("stages both review and done paths", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "approve" });

    // Should stage both the old review file and new done file
    const staged = deps.git.staged.flat();
    expect(staged).toContain(".ralph/tasks/review/TASK-001.md");
    expect(staged).toContain(".ralph/tasks/done/TASK-001.md");
  });

  it("commits with approve message", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "approve" });
    expect(deps.git.commits.some((c) => c.includes("approved"))).toBe(true);
  });

  it("deletes the feature branch", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001", branch: "ralph/TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "approve" });
    expect(deps.git.deletedBranches).toContain("ralph/TASK-001");
  });

  it("checks out main and pulls before merge", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "approve" });
    expect(deps.git.checkouts[0]).toBe("main");
  });
});

describe("reviewTask — reject", () => {
  it("transitions task to pending when retries remain", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001", retry_count: 0, max_retries: 2 }), "review");

    const result = await reviewTask(deps, "TASK-001", { decision: "reject", reason: "needs tests" });
    expect(result.status).toBe("pending");
    expect(result.retry_count).toBe(1);
  });

  it("transitions task to failed when retries exhausted", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001", retry_count: 2, max_retries: 2 }), "review");

    const result = await reviewTask(deps, "TASK-001", { decision: "reject" });
    expect(result.status).toBe("failed");
  });

  it("includes reason in commit message", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "reject", reason: "needs tests" });
    expect(deps.git.commits.some((c) => c.includes("needs tests"))).toBe(true);
  });

  it("deletes the feature branch on reject", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001", branch: "ralph/TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "reject" });
    expect(deps.git.deletedBranches).toContain("ralph/TASK-001");
  });

  it("uses default reason when none given", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    await reviewTask(deps, "TASK-001", { decision: "reject" });
    expect(deps.git.commits.some((c) => c.includes("no reason given"))).toBe(true);
  });
});

describe("reviewTask — error cases", () => {
  it("throws TASK_NOT_FOUND for unknown task", async () => {
    const deps = makeDeps();

    try {
      await reviewTask(deps, "TASK-999", { decision: "approve" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TaskError);
      expect((err as TaskError).code).toBe("TASK_NOT_FOUND");
    }
  });

  it("throws INVALID_TRANSITION for non-review task", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "TASK-001", status: "pending" }), "pending");

    try {
      await reviewTask(deps, "TASK-001", { decision: "approve" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TaskError);
      expect((err as TaskError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("falls back to branch prefix + ID when task has no branch", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "TASK-001" });
    delete task.branch;
    deps.repo.seed(task, "review");

    await reviewTask(deps, "TASK-001", { decision: "approve" });
    expect(deps.git.mergedBranches).toContain("ralph/TASK-001");
  });

  it("throws GIT_MERGE_CONFLICT when merge fails", async () => {
    const deps = makeDeps();
    deps.git.setMergeFails(true);
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    try {
      await reviewTask(deps, "TASK-001", { decision: "approve" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitError);
      expect((err as GitError).code).toBe("GIT_MERGE_CONFLICT");
    }

    // Task should still be in review (not transitioned)
    const result = await deps.repo.findById("TASK-001");
    expect(result!.status).toBe("review");
  });

  it("throws GIT_PUSH_FAILED when push fails on approve", async () => {
    const deps = makeDeps();
    deps.git.setPushFails(true);
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    try {
      await reviewTask(deps, "TASK-001", { decision: "approve" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitError);
      expect((err as GitError).code).toBe("GIT_PUSH_FAILED");
    }
  });

  it("throws GIT_PUSH_FAILED when push fails on reject", async () => {
    const deps = makeDeps();
    deps.git.setPushFails(true);
    deps.repo.seed(makeTask({ id: "TASK-001" }), "review");

    try {
      await reviewTask(deps, "TASK-001", { decision: "reject" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GitError);
      expect((err as GitError).code).toBe("GIT_PUSH_FAILED");
    }
  });
});
