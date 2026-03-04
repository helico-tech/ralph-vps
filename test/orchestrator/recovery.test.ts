import { describe, it, expect } from "bun:test";
import { recoverOrphanedTasks } from "../../src/orchestrator/recovery.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import { MockObservability } from "../../src/adapters/mock/mock-observability.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";
import type { OrchestratorDeps } from "../../src/orchestrator/loop.js";
import type { Task, RalphConfig } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    status: "active",
    type: "feature",
    priority: 100,
    description: "A test task.",
    ...overrides,
  };
}

const TEST_CONFIG: RalphConfig = {
  version: 1,
  project: { name: "test" },
  verify: "bun test",
  task_defaults: { model: "opus", max_turns: 50, timeout_seconds: 1800 },
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
    config: TEST_CONFIG,
    templatesDir: "/tmp/templates",
    tasksDir: ".ralph/tasks",
    systemPromptPath: "/tmp/templates/ralph-system.md",
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

  it("moves orphaned task to pending", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active" }), "active");

    await recoverOrphanedTasks(deps);

    const task = await deps.repo.findById("t1");
    expect(task!.status).toBe("pending");
  });

  it("emits task.recovered for recovered tasks", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active" }), "active");

    await recoverOrphanedTasks(deps);

    const recovered = deps.obs.ofType("task.recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].task_id).toBe("t1");
  });

  it("deletes stale branch if it exists", async () => {
    const deps = makeDeps();
    deps.git.branches.push("ralph/t1");
    deps.repo.seed(makeTask({ id: "t1", status: "active" }), "active");

    await recoverOrphanedTasks(deps);

    expect(deps.git.deletedBranches).toContain("ralph/t1");
  });

  it("skips branch deletion if branch does not exist", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active" }), "active");

    await recoverOrphanedTasks(deps);

    expect(deps.git.deletedBranches).toHaveLength(0);
  });

  it("recovers multiple tasks in one commit", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "active" }), "active");
    deps.repo.seed(makeTask({ id: "t2", status: "active" }), "active");
    deps.repo.seed(makeTask({ id: "t3", status: "active" }), "active");

    await recoverOrphanedTasks(deps);

    const t1 = await deps.repo.findById("t1");
    const t2 = await deps.repo.findById("t2");
    const t3 = await deps.repo.findById("t3");
    expect(t1!.status).toBe("pending");
    expect(t2!.status).toBe("pending");
    expect(t3!.status).toBe("pending");

    expect(deps.git.commits).toHaveLength(1);
    expect(deps.git.commits[0]).toContain("3 task(s)");
  });

  it("ignores tasks in non-active directories", async () => {
    const deps = makeDeps();
    deps.repo.seed(makeTask({ id: "t1", status: "pending" }), "pending");
    deps.repo.seed(makeTask({ id: "t2", status: "done" }), "done");

    await recoverOrphanedTasks(deps);

    expect(deps.git.commits).toHaveLength(0);
    expect(deps.obs.events).toHaveLength(0);
  });
});
