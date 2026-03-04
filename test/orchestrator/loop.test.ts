import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { processTask } from "../../src/orchestrator/loop.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";
import { MockVerifier } from "../../src/adapters/mock/mock-verifier.js";
import { MockObservability } from "../../src/adapters/mock/mock-observability.js";
import type { OrchestratorDeps } from "../../src/orchestrator/loop.js";
import type { Task, RalphConfig, ExecutionResult, ExecutionPlan } from "../../src/core/types.js";
import type { AgentExecutor } from "../../src/ports/agent-executor.js";

let templatesDir: string;

beforeEach(async () => {
  templatesDir = await mkdtemp(join(tmpdir(), "ralph-tpl-"));
  await Bun.write(join(templatesDir, "default.md"), "Task: {{title}}\n\n{{description}}");
});

afterEach(async () => {
  await rm(templatesDir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Test task",
    status: "pending",
    type: "feature",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "Arjan",
    description: "Do the thing.",
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

interface TestDeps extends OrchestratorDeps {
  repo: MockTaskRepository;
  git: MockSourceControl;
  executor: MockExecutor;
  verifier: MockVerifier;
  obs: MockObservability;
}

function makeDeps(overrides: Partial<OrchestratorDeps> = {}): TestDeps {
  const repo = new MockTaskRepository();
  const git = new MockSourceControl();
  const executor = new MockExecutor();
  const verifier = new MockVerifier();
  const obs = new MockObservability();
  return {
    repo,
    git,
    executor,
    verifier,
    obs,
    config: TEST_CONFIG,
    templatesDir,
    tasksDir: ".ralph/tasks",
    ...overrides,
  } as TestDeps;
}

describe("processTask — happy path", () => {
  it("claims, executes, verifies, and transitions to review", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // Task should be in review
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("review");
    expect(result!.branch).toBe("ralph/t1");
    expect(result!.cost_usd).toBe(0.01);
    expect(result!.turns).toBe(3);
    expect(result!.duration_s).toBe(10);
  });

  it("creates the feature branch", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.git.branches).toContain("ralph/t1");
  });

  it("pushes the feature branch", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // Task transitions should stage the tasks directory
    expect(deps.git.staged.length).toBeGreaterThanOrEqual(2); // claim + review transitions
    expect(deps.git.staged[0]).toEqual([".ralph/tasks"]);
  });

  it("emits events in correct order", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const types = deps.obs.events.map((e) => e.type);
    expect(types).toEqual([
      "task.claimed",
      "execution.started",
      "execution.completed",
      "verification.started",
      "verification.completed",
      "task.completed",
    ]);
  });

  it("passes execution plan to executor", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1", title: "Fix the bug", description: "It is broken." });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.executor.calls).toHaveLength(1);
    expect(deps.executor.calls[0].prompt).toContain("Fix the bug");
    expect(deps.executor.calls[0].model).toBe("opus");
  });
});

describe("processTask — push conflict on claim", () => {
  it("reverts task to pending when push fails", async () => {
    const deps = makeDeps();
    deps.git.setPushFails(true);
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // Task should be back in pending
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("pending");

    // No execution should have happened
    expect(deps.executor.calls).toHaveLength(0);

    // No task.claimed event (push failed before we emitted it)
    expect(deps.obs.ofType("task.claimed")).toHaveLength(0);
  });
});

describe("processTask — verification failure", () => {
  it("retries task when verification fails and retries remain", async () => {
    const deps = makeDeps();
    deps.verifier.setTestResult({ passed: false, output: "FAIL: test.ts" });
    const task = makeTask({ id: "t1", retry_count: 0, max_retries: 2 });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("pending");
    expect(result!.retry_count).toBe(1);
  });

  it("fails task permanently when retries exhausted", async () => {
    const deps = makeDeps();
    deps.verifier.setTestResult({ passed: false });
    const task = makeTask({ id: "t1", retry_count: 2, max_retries: 2 });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("failed");
  });

  it("emits task.retried for retriable failure", async () => {
    const deps = makeDeps();
    deps.verifier.setTestResult({ passed: false });
    const task = makeTask({ id: "t1", retry_count: 0 });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const retried = deps.obs.ofType("task.retried");
    expect(retried).toHaveLength(1);
    expect(retried[0].task_id).toBe("t1");
    expect(retried[0].attempt).toBe(1);
  });

  it("emits task.failed for permanent failure", async () => {
    const deps = makeDeps();
    deps.verifier.setTestResult({ passed: false });
    const task = makeTask({ id: "t1", retry_count: 2, max_retries: 2 });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const failed = deps.obs.ofType("task.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].task_id).toBe("t1");
    expect(failed[0].reason).toContain("verification failed");
  });

  it("cleans up stale branch on failure", async () => {
    const deps = makeDeps();
    deps.verifier.setTestResult({ passed: false });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // Branch was created during execution, should be cleaned up
    expect(deps.git.deletedBranches).toContain("ralph/t1");
  });
});

describe("processTask — stop reason handling", () => {
  it("skips verification for error stop reason", async () => {
    const errorResult: ExecutionResult = {
      stop_reason: "error",
      cost_usd: 0.01,
      turns: 1,
      duration_s: 5,
      output: "Error occurred",
    };
    const deps = makeDeps({ executor: new MockExecutor(errorResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // No verification events
    expect(deps.obs.ofType("verification.started")).toHaveLength(0);
    expect(deps.verifier.calls).toHaveLength(0);

    // Task should be retried (not failed — retries remain)
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("pending");
  });

  it("skips verification for timeout stop reason", async () => {
    const timeoutResult: ExecutionResult = {
      stop_reason: "timeout",
      cost_usd: 0.02,
      turns: 5,
      duration_s: 1800,
      output: "",
    };
    const deps = makeDeps({ executor: new MockExecutor(timeoutResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.verifier.calls).toHaveLength(0);
  });

  it("skips verification for refusal stop reason", async () => {
    const refusalResult: ExecutionResult = {
      stop_reason: "refusal",
      cost_usd: 0.001,
      turns: 1,
      duration_s: 2,
      output: "I cannot do that.",
    };
    const deps = makeDeps({ executor: new MockExecutor(refusalResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.verifier.calls).toHaveLength(0);
  });

  it("runs verification for max_turns stop reason", async () => {
    const maxTurnsResult: ExecutionResult = {
      stop_reason: "max_turns",
      cost_usd: 0.05,
      turns: 50,
      duration_s: 300,
      output: "Ran out of turns but made progress.",
    };
    const deps = makeDeps({ executor: new MockExecutor(maxTurnsResult) });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // Verification should have run
    expect(deps.obs.ofType("verification.started")).toHaveLength(1);
    expect(deps.verifier.calls.length).toBeGreaterThan(0);

    // If tests pass (default), task goes to review
    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("review");
  });

  it("runs verification for end_turn stop reason", async () => {
    const deps = makeDeps(); // default executor returns end_turn
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.obs.ofType("verification.started")).toHaveLength(1);
    expect(deps.verifier.calls.length).toBeGreaterThan(0);
  });
});

describe("processTask — template loading", () => {
  it("loads type-specific template when available", async () => {
    await Bun.write(join(templatesDir, "bugfix.md"), "BUGFIX: {{title}}");
    const deps = makeDeps();
    const task = makeTask({ id: "t1", type: "bugfix", title: "Fix crash" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    expect(deps.executor.calls[0].prompt).toContain("BUGFIX: Fix crash");
  });

  it("falls back to default.md template", async () => {
    const deps = makeDeps();
    const task = makeTask({ id: "t1", type: "research", title: "Investigate" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    // default.md has "Task: {{title}}"
    expect(deps.executor.calls[0].prompt).toContain("Task: Investigate");
  });
});

describe("processTask — uncaught exception recovery", () => {
  it("transitions task out of active when executor throws", async () => {
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
    expect(result!.status).toBe("pending"); // retried, not stuck in active
    expect(result!.retry_count).toBe(1);
  });

  it("emits task.retried when executor throws and retries remain", async () => {
    const throwingExecutor: AgentExecutor = {
      async execute(): Promise<ExecutionResult> {
        throw new Error("boom");
      },
    };
    const deps = makeDeps({ executor: throwingExecutor });
    const task = makeTask({ id: "t1", retry_count: 0 });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const retried = deps.obs.ofType("task.retried");
    expect(retried).toHaveLength(1);
    expect(retried[0].task_id).toBe("t1");
  });
});

describe("processTask — exit_criteria", () => {
  it("passes when required checks pass", async () => {
    const config: RalphConfig = {
      ...TEST_CONFIG,
      exit_criteria: { require_tests: true, require_build: true, require_lint: true },
      verify: { test: "bun test", build: "bun build", lint: "bun lint" },
    };
    const deps = makeDeps({ config });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("review");
  });

  it("fails when a required check fails", async () => {
    const config: RalphConfig = {
      ...TEST_CONFIG,
      exit_criteria: { require_tests: true, require_build: true, require_lint: false },
      verify: { test: "bun test", build: "bun build", lint: "" },
    };
    const deps = makeDeps({ config });
    deps.verifier.setBuildResult({ passed: false });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("pending"); // retried
  });

  it("passes when a non-required check fails", async () => {
    const config: RalphConfig = {
      ...TEST_CONFIG,
      exit_criteria: { require_tests: true, require_build: false, require_lint: false },
      verify: { test: "bun test", build: "bun build", lint: "" },
    };
    const deps = makeDeps({ config });
    deps.verifier.setBuildResult({ passed: false });
    const task = makeTask({ id: "t1" });
    deps.repo.seed(task, "pending");

    await processTask(deps, task);

    const result = await deps.repo.findById("t1");
    expect(result!.status).toBe("review"); // build not required, so OK
  });
});
