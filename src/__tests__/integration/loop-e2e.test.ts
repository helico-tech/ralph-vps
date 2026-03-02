import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTempDir, cleanupTempDir } from "../helpers";
import { FsTaskRepository } from "../../adapters/fs-task-repository";
import { PriorityTaskSelector } from "../../adapters/priority-task-selector";
import { TemplatePromptCompiler } from "../../adapters/template-prompt-compiler";
import { FsTypeResolver } from "../../adapters/fs-type-resolver";
import { GitProgressDetector } from "../../adapters/git-progress-detector";
import { JsonLogStore } from "../../adapters/json-log-store";
import { LoopEngine } from "../../domain/loop-engine";
import { generateTaskId, slugify } from "../../domain/task";
import type { Task } from "../../domain/task";
import { TASKS_DIR } from "../../constants";
import { MockProcessRunner, MockGitSynchronizer } from "../helpers/mock-adapters";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await createTempDir();
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

function gitSync(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString()}`);
  }
}

async function setupProject(dir: string): Promise<void> {
  gitSync(dir, "init");
  gitSync(dir, "config", "user.name", "Test");
  gitSync(dir, "config", "user.email", "test@test.com");

  await mkdir(join(dir, ".ralph/tasks"), { recursive: true });
  await mkdir(join(dir, ".ralph/types"), { recursive: true });
  await mkdir(join(dir, ".ralph-local/logs"), { recursive: true });
  await Bun.write(
    join(dir, ".ralph/project.json"),
    JSON.stringify({
      name: "test-project",
      defaultType: "feature-dev",
      reviewAfterCompletion: false,
    })
  );
}

function makeTask(title: string, overrides: Partial<Task> = {}): Task {
  const now = new Date(overrides.created ?? "2026-03-02T10:00:00.000Z");
  return {
    id: generateTaskId(title, now),
    title,
    status: "pending",
    type: "feature-dev",
    priority: 1,
    order: 1,
    depends_on: [],
    created: now.toISOString(),
    body: `Implement: ${title}`,
    filePath: join(tmpDir, TASKS_DIR, `${slugify(title)}.md`),
    ...overrides,
  };
}

function createEngine(overrides: Record<string, unknown> = {}) {
  return new LoopEngine({
    taskRepository: new FsTaskRepository(tmpDir),
    taskSelector: new PriorityTaskSelector(),
    promptCompiler: new TemplatePromptCompiler(),
    processRunner: new MockProcessRunner(),
    progressDetector: new GitProgressDetector(),
    gitSynchronizer: new MockGitSynchronizer(),
    logStore: new JsonLogStore(tmpDir),
    typeResolver: new FsTypeResolver(tmpDir),
    projectName: "test-project",
    projectRoot: tmpDir,
    circuitBreakerConfig: {
      maxConsecutiveErrors: 3,
      maxStallIterations: 3,
      maxCostUsd: 100,
      maxTokens: 1000000,
      maxIterations: 10,
    },
    reviewAfterCompletion: false,
    ...overrides,
  });
}

describe("Loop E2E", () => {
  test("single iteration: selects task, runs mock, writes log, transitions status", async () => {
    await setupProject(tmpDir);

    const repo = new FsTaskRepository(tmpDir);
    const task = makeTask("Setup database");
    await repo.create(task);

    gitSync(tmpDir, "add", ".");
    gitSync(tmpDir, "commit", "-m", "Initial project setup");

    const mockProcessRunner = new MockProcessRunner();
    const mockGitSync = new MockGitSynchronizer();
    const engine = createEngine({
      processRunner: mockProcessRunner,
      gitSynchronizer: mockGitSync,
    });

    const result = await engine.runIteration();

    // Iteration succeeded
    expect(result.success).toBe(true);
    expect(result.taskId).toBe(task.id);
    expect(result.tokensUsed).toBe(12000); // 10000 + 2000 from MockProcessRunner

    // Task transitioned to in_progress on disk
    const updated = await repo.get(task.id);
    expect(updated?.status).toBe("in_progress");

    // Iteration log written with correct data
    const logs = await new JsonLogStore(tmpDir).listAll();
    expect(logs).toHaveLength(1);
    expect(logs[0].taskId).toBe(task.id);
    expect(logs[0].taskTitle).toBe("Setup database");
    expect(logs[0].iteration).toBe(1);
    expect(logs[0].inputTokens).toBe(10000);
    expect(logs[0].outputTokens).toBe(2000);
    expect(logs[0].toolCalls).toBe(15);
    expect(logs[0].model).toBe("claude-sonnet-4-6");
    expect(logs[0].success).toBe(true);

    // Prompt compiled and passed to runner
    expect(mockProcessRunner.lastOptions).not.toBeNull();
    expect(mockProcessRunner.lastOptions!.cwd).toBe(tmpDir);
    expect(mockProcessRunner.lastOptions!.prompt).toContain("Setup database");

    // Git commit+push was called with iteration message
    expect(mockGitSync.lastCommitMessage).toContain("iteration 1");
    expect(mockGitSync.lastCommitMessage).toContain("Setup database");
  });

  test("returns error when no eligible tasks exist", async () => {
    await setupProject(tmpDir);

    gitSync(tmpDir, "add", ".");
    gitSync(tmpDir, "commit", "-m", "Empty project");

    const engine = createEngine();
    const result = await engine.runIteration();

    expect(result.success).toBe(false);
    expect(result.error).toContain("No eligible tasks");
    expect(result.taskId).toBeNull();
  });

  test("loop run stops on max_iterations circuit breaker", async () => {
    await setupProject(tmpDir);

    const repo = new FsTaskRepository(tmpDir);
    await repo.create(makeTask("Task one", { order: 1 }));
    await repo.create(
      makeTask("Task two", { order: 2, created: "2026-03-02T10:00:01.000Z" })
    );

    gitSync(tmpDir, "add", ".");
    gitSync(tmpDir, "commit", "-m", "Two tasks");

    const engine = createEngine({
      circuitBreakerConfig: {
        maxConsecutiveErrors: 0,
        maxStallIterations: 0,
        maxCostUsd: 0,
        maxTokens: 0,
        maxIterations: 1,
      },
    });

    const reason = await engine.run();

    expect(reason).toBe("max_iterations");
    expect(engine.getStatus().iteration).toBe(1);
  });

  test("loop run returns no_tasks when all tasks consumed", async () => {
    await setupProject(tmpDir);

    const repo = new FsTaskRepository(tmpDir);
    await repo.create(makeTask("Only task"));

    gitSync(tmpDir, "add", ".");
    gitSync(tmpDir, "commit", "-m", "One task");

    const engine = createEngine({
      circuitBreakerConfig: {
        maxConsecutiveErrors: 0,
        maxStallIterations: 0,
        maxCostUsd: 0,
        maxTokens: 0,
        maxIterations: 100,
      },
    });

    const reason = await engine.run();

    // First iteration transitions the task to in_progress,
    // second iteration finds no pending tasks
    expect(reason).toBe("no_tasks");
    expect(engine.getStatus().iteration).toBe(1);
  });
});
