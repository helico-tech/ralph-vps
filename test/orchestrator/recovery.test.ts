import { describe, it, expect } from "bun:test";
import { recoverOrphanedTasks } from "../../src/orchestrator/recovery.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import { MockObservability } from "../../src/adapters/mock/mock-observability.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";
import { MockVerifier } from "../../src/adapters/mock/mock-verifier.js";
import type { OrchestratorDeps } from "../../src/orchestrator/loop.js";
import type { Task, RalphConfig } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Test task",
    status: "active",
    type: "feature",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "Arjan",
    description: "A test task.",
    max_retries: 2,
    retry_count: 0,
    ...overrides,
  };
}

const TEST_CONFIG: RalphConfig = {
  version: 1,
  project: { name: "test" },
  verify: { test: "bun test", build: "", lint: "" },
  task_defaults: { max_retries: 2, model: "opus", max_turns: 50, max_budget_usd: 5, timeout_seconds: 1800 },
  exit_criteria: { require_tests: true, require_build: false, require_lint: false },
  git: { main_branch: "main", branch_prefix: "ralph/" },
  execution: { permission_mode: "skip_all" },
};

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps & {
  repo: MockTaskRepository;
  git: MockSourceControl;
  obs: MockObservability;
} {
  const repo = new MockTaskRepository();
  const git = new MockSourceControl();
  const obs = new MockObservability();
  return {
    repo,
    git,
    obs,
    executor: new MockExecutor(),
    verifier: new MockVerifier(),
    config: TEST_CONFIG,
    templatesDir: "/tmp/templates",
    ...overrides,
  } as OrchestratorDeps & { repo: MockTaskRepository; git: MockSourceControl; obs: MockObservability };
}

describe("recoverOrphanedTasks", () => {
  it("does nothing when active/ is empty", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "pending" }), "pending");

    await recoverOrphanedTasks(deps);

    expect(deps.git.commits).toHaveLength(0);
    expect(deps.obs.events).toHaveLength(0);
  });

  it("moves orphaned task with retries remaining to pending", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active", retry_count: 0 }), "active");

    await recoverOrphanedTasks(deps);

    const task = await deps.repo.findById("t1");
    expect(task!.status).toBe("pending");
    expect(task!.retry_count).toBe(1);
  });

  it("moves orphaned task at max retries to failed", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active", retry_count: 2, max_retries: 2 }), "active");

    await recoverOrphanedTasks(deps);

    const task = await deps.repo.findById("t1");
    expect(task!.status).toBe("failed");
  });

  it("emits task.retried for recoverable tasks", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active", retry_count: 0 }), "active");

    await recoverOrphanedTasks(deps);

    const retried = deps.obs.ofType("task.retried");
    expect(retried).toHaveLength(1);
    expect(retried[0].task_id).toBe("t1");
    expect(retried[0].attempt).toBe(1);
  });

  it("emits task.failed for exhausted tasks", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active", retry_count: 2, max_retries: 2 }), "active");

    await recoverOrphanedTasks(deps);

    const failed = deps.obs.ofType("task.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].task_id).toBe("t1");
    expect(failed[0].reason).toContain("crash recovery");
  });

  it("deletes stale branch if it exists", async () => {
    const deps = makeDeps();
    // Simulate existing branch
    deps.git.branches.push("ralph/t1");
    deps.repo.seed(makeTask({ id: "t1", status: "active", retry_count: 0 }), "active");

    await recoverOrphanedTasks(deps);

    expect(deps.git.deletedBranches).toContain("ralph/t1");
  });

  it("skips branch deletion if branch does not exist", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active", retry_count: 0 }), "active");

    await recoverOrphanedTasks(deps);

    expect(deps.git.deletedBranches).toHaveLength(0);
  });

  it("recovers multiple tasks in one commit", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active", retry_count: 0 }), "active");
    deps.repo.seed(makeTask({ id: "t2", status: "active", retry_count: 1, max_retries: 2 }), "active");
    deps.repo.seed(makeTask({ id: "t3", status: "active", retry_count: 2, max_retries: 2 }), "active");

    await recoverOrphanedTasks(deps);

    // All recovered
    const t1 = await deps.repo.findById("t1");
    const t2 = await deps.repo.findById("t2");
    const t3 = await deps.repo.findById("t3");
    expect(t1!.status).toBe("pending");
    expect(t2!.status).toBe("pending");
    expect(t3!.status).toBe("failed");

    // One commit for all
    expect(deps.git.commits).toHaveLength(1);
    expect(deps.git.commits[0]).toContain("3 task(s)");
  });

  it("ignores tasks in non-active directories", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "pending" }), "pending");
    deps.repo.seed(makeTask({ id: "t2", status: "review" }), "review");
    deps.repo.seed(makeTask({ id: "t3", status: "done" }), "done");

    await recoverOrphanedTasks(deps);

    expect(deps.git.commits).toHaveLength(0);
    expect(deps.obs.events).toHaveLength(0);
  });
});
