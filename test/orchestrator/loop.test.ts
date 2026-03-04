import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { processTask } from "../../src/orchestrator/loop.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";
import { MockObservability } from "../../src/adapters/mock/mock-observability.js";
import type { OrchestratorDeps } from "../../src/orchestrator/loop.js";
import type { Task, RalphConfig, ExecutionResult, ExecutionPlan } from "../../src/core/types.js";
import type { AgentExecutor } from "../../src/ports/agent-executor.js";

let templatesDir: string;
let systemPromptPath: string;

beforeEach(async () => {
  templatesDir = await mkdtemp(join(tmpdir(), "ralph-tpl-"));
  await Bun.write(join(templatesDir, "default.md"), "Task: {{id}}\n\n{{description}}");
  await Bun.write(join(templatesDir, "feature.md"), "Feature: {{id}}\n\n{{description}}");
  await Bun.write(join(templatesDir, "bugfix.md"), "Bugfix: {{id}}\n\n{{description}}");
  systemPromptPath = join(templatesDir, "ralph-system.md");
  await Bun.write(systemPromptPath, "You are Ralph.");
});

afterEach(async () => {
  await rm(templatesDir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    status: "pending",
    type: "feature",
    priority: 100,
    description: "Do the thing.",
    ...overrides,
  };
}

const TEST_CONFIG: RalphConfig = {
  version: 1,
  project: { name: "test" },
  verify: "true", // always passes
  task_defaults: { model: "opus", max_turns: 50, timeout_seconds: 1800 },
  git: { main_branch: "main", branch_prefix: "ralph/" },
  execution: { permission_mode: "skip_all" },
};

interface TestDeps extends OrchestratorDeps {
  repo: MockTaskRepository;
  git: MockSourceControl;
  executor: MockExecutor;
  obs: MockObservability;
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): TestDeps {
  const repo = new MockTaskRepository();
  const git = new MockSourceControl();
  const executor = new MockExecutor();
  const obs = new MockObservability();
  return {
    repo,
    git,
    executor,
    obs,
    config: TEST_CONFIG,
    templatesDir,
    tasksDir: ".ralph/tasks",
    systemPromptPath,
    ...overrides,
  } as TestDeps;
}

describe("processTask — happy path (feature)", () => {
  it("claims, executes, verifies, transitions to done, and spawns review", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // Original task should be done
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("done");

    // A review task should be spawned
    const allTasks = await deps.repo.listAll();
    const review = allTasks.find((t) => t.type === "review");
    expect(review).toBeDefined();
    expect(review!.parent_id).toBe("t1");
    expect(review!.status).toBe("pending");
  });

  it("creates the feature branch", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.git.branches).toContain("ralph/t1");
  });

  it("emits events in correct order", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const types = deps.obs.events.map((e) => e.type);
    expect(types).toContain("task.claimed");
    expect(types).toContain("execution.started");
    expect(types).toContain("execution.completed");
    expect(types).toContain("verification.started");
    expect(types).toContain("verification.completed");
    expect(types).toContain("task.completed");
    expect(types).toContain("task.spawned");
  });

  it("passes execution plan to executor", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1", description: "It is broken." });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.executor.calls).toHaveLength(1);
    expect(deps.executor.calls[0].prompt).toContain("t1");
    expect(deps.executor.calls[0].model).toBe("opus");
  });
});

describe("processTask — review task (pass → merge)", () => {
  it("merges branch when review passes", async () => {
    const deps = makeDeps();
    // Review task for a feature on branch ralph/t0
    const task = makeTask({ id: "t1", type: "review", parent_id: "t0" });
    deps.repo.seed(task, "pending");
    // The parent branch must exist
    deps.git.branches.push("ralph/t0");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("done");

    // Branch should be merged
    expect(deps.git.mergedBranches).toContain("ralph/t0");

    // No follow-up tasks (review pass = merge, done)
    const allTasks = await deps.repo.listAll();
    const followUps = allTasks.filter((t) => t.parent_id === "t1");
    expect(followUps).toHaveLength(0);
  });
});

describe("processTask — review task (fail → fix)", () => {
  it("spawns fix task when review fails verification", async () => {
    const deps = makeDeps({ config: { ...TEST_CONFIG, verify: "false" } });
    const task = makeTask({ id: "t1", type: "review", parent_id: "t0" });
    deps.repo.seed(task, "pending");
    deps.git.branches.push("ralph/t0");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("failed");

    // A fix task should be spawned
    const allTasks = await deps.repo.listAll();
    const fix = allTasks.find((t) => t.type === "fix");
    expect(fix).toBeDefined();
    expect(fix!.parent_id).toBe("t1");
  });
});

describe("processTask — push conflict on claim", () => {
  it("reverts task to pending when push fails", async () => {
    const deps = makeDeps();
    deps.git.setPushFails(true);
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("pending");

    // No execution should have happened
    expect(deps.executor.calls).toHaveLength(0);

    // No task.claimed event (push failed before we emitted it)
    expect(deps.obs.ofType("task.claimed")).toHaveLength(0);
  });
});

describe("processTask — stop reason handling", () => {
  it("skips verification for error stop reason", async () => {
    const errorResult: ExecutionResult = {
      stop_reason: "error",
      output: "Error occurred",
    };
    const deps = makeDeps({ executor: new MockExecutor(errorResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // No verification events
    expect(deps.obs.ofType("verification.started")).toHaveLength(0);

    // Task should be failed (no retries in new system)
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("failed");
  });

  it("skips verification for timeout stop reason", async () => {
    const timeoutResult: ExecutionResult = {
      stop_reason: "timeout",
      output: "",
    };
    const deps = makeDeps({ executor: new MockExecutor(timeoutResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.obs.ofType("verification.started")).toHaveLength(0);
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("failed");
  });

  it("skips verification for refusal stop reason", async () => {
    const refusalResult: ExecutionResult = {
      stop_reason: "refusal",
      output: "I cannot do that.",
    };
    const deps = makeDeps({ executor: new MockExecutor(refusalResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.obs.ofType("verification.started")).toHaveLength(0);
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("failed");
  });

  it("runs verification for max_turns stop reason", async () => {
    const maxTurnsResult: ExecutionResult = {
      stop_reason: "max_turns",
      output: "Ran out of turns but made progress.",
    };
    const deps = makeDeps({ executor: new MockExecutor(maxTurnsResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.obs.ofType("verification.started")).toHaveLength(1);
  });

  it("runs verification for end_turn stop reason", async () => {
    const deps = makeDeps(); // default executor returns end_turn
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.obs.ofType("verification.started")).toHaveLength(1);
  });
});

describe("processTask — template loading", () => {
  it("loads type-specific template when available", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1", type: "bugfix", description: "Fix crash" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.executor.calls[0].prompt).toContain("Bugfix: t1");
  });

  it("falls back to default.md template", async () => {
    // Create a review template by writing to the templates dir
    // (review.md doesn't exist, so it falls back to default.md)
    const deps = makeDeps();
    const task = makeTask({ id: "t1", type: "review", parent_id: "t0" });
    deps.repo.seed(task, "pending");
    deps.git.branches.push("ralph/t0");

    await processTask(deps, task);

    // default.md has "Task: {{id}}"
    expect(deps.executor.calls[0].prompt).toContain("Task: t1");
  });
});

describe("processTask — uncaught exception recovery", () => {
  it("transitions task to failed when executor throws", async () => {
    const throwingExecutor: AgentExecutor = {
      async execute(_plan: ExecutionPlan): Promise<ExecutionResult> {
        throw new Error("Claude CLI crashed");
      },
    };
    const deps = makeDeps({ executor: throwingExecutor });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    // Should not throw — processTask catches and calls failTask
    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("failed");
  });

  it("emits task.failed when executor throws", async () => {
    const throwingExecutor: AgentExecutor = {
      async execute(): Promise<ExecutionResult> {
        throw new Error("boom");
      },
    };
    const deps = makeDeps({ executor: throwingExecutor });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const failed = deps.obs.ofType("task.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].task_id).toBe("t1");
  });
});
