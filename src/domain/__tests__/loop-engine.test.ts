import { describe, expect, test, beforeEach } from "bun:test";
import { LoopEngine, type LoopEngineDeps } from "../loop-engine";
import {
  MockTaskRepository,
  MockTaskSelector,
  MockPromptCompiler,
  MockProcessRunner,
  MockProgressDetector,
  MockGitSynchronizer,
  MockLogStore,
} from "../../__tests__/helpers/mock-adapters";
import { FsTypeResolver } from "../../adapters/fs-type-resolver";
import type { Task } from "../task";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "20260302-test",
  title: "Test Task",
  status: "pending",
  type: "feature-dev",
  priority: 2,
  order: 0,
  depends_on: [],
  created: "2026-03-02T00:00:00.000Z",
  body: "Test body",
  filePath: "test.md",
  ...overrides,
});

let taskRepo: MockTaskRepository;
let taskSelector: MockTaskSelector;
let promptCompiler: MockPromptCompiler;
let processRunner: MockProcessRunner;
let progressDetector: MockProgressDetector;
let gitSync: MockGitSynchronizer;
let logStore: MockLogStore;
let deps: LoopEngineDeps;

beforeEach(() => {
  taskRepo = new MockTaskRepository();
  taskSelector = new MockTaskSelector();
  promptCompiler = new MockPromptCompiler();
  processRunner = new MockProcessRunner();
  progressDetector = new MockProgressDetector();
  gitSync = new MockGitSynchronizer();
  logStore = new MockLogStore();

  deps = {
    taskRepository: taskRepo,
    taskSelector,
    promptCompiler,
    processRunner,
    progressDetector,
    gitSynchronizer: gitSync,
    logStore,
    typeResolver: new FsTypeResolver("/tmp"),
    projectName: "test-project",
    projectRoot: "/tmp/test",
    circuitBreakerConfig: {
      maxConsecutiveErrors: 3,
      maxStallIterations: 5,
      maxCostUsd: 0,
      maxTokens: 0,
      maxIterations: 0,
    },
    reviewAfterCompletion: false,
  };
});

describe("LoopEngine", () => {
  describe("runIteration", () => {
    test("successful iteration follows correct order", async () => {
      const task = makeTask();
      taskRepo.tasks = [task];
      taskSelector.nextTask = task;

      const engine = new LoopEngine(deps);
      const result = await engine.runIteration();

      expect(result.success).toBe(true);
      expect(result.taskId).toBe(task.id);
      expect(result.tokensUsed).toBeGreaterThan(0);
      expect(result.commitsMade).toBe(1);

      // Verify prompt was compiled
      expect(promptCompiler.lastTask?.id).toBe(task.id);

      // Verify process was run
      expect(processRunner.lastOptions).not.toBeNull();

      // Verify log was written
      expect(logStore.logs).toHaveLength(1);
      expect(logStore.logs[0].taskId).toBe(task.id);

      // Verify git push was called
      expect(gitSync.lastCommitMessage).toContain(task.title);
    });

    test("returns error when no tasks available", async () => {
      taskSelector.nextTask = null;
      const engine = new LoopEngine(deps);
      const result = await engine.runIteration();

      expect(result.success).toBe(false);
      expect(result.error).toBe("No eligible tasks");
    });

    test("returns error when git pull fails", async () => {
      gitSync.syncResult = { success: false, error: "merge conflict" };
      const engine = new LoopEngine(deps);
      const result = await engine.runIteration();

      expect(result.success).toBe(false);
      expect(result.error).toContain("Git pull failed");
    });

    test("handles process runner errors", async () => {
      const task = makeTask();
      taskRepo.tasks = [task];
      taskSelector.nextTask = task;
      processRunner.result = {
        ...processRunner.result,
        exitCode: 1,
        error: "Claude crashed",
      };

      const engine = new LoopEngine(deps);
      const result = await engine.runIteration();

      expect(result.success).toBe(false);
      expect(logStore.logs[0].success).toBe(false);
    });
  });

  describe("run", () => {
    test("stops when no tasks", async () => {
      taskSelector.nextTask = null;
      const engine = new LoopEngine(deps);
      const reason = await engine.run();
      expect(reason).toBe("no_tasks");
    });

    test("stops on abort signal", async () => {
      const controller = new AbortController();
      controller.abort();

      const engine = new LoopEngine(deps);
      const reason = await engine.run(controller.signal);
      expect(reason).toBe("aborted");
    });

    test("stops on circuit breaker", async () => {
      deps.circuitBreakerConfig.maxIterations = 1;
      const task = makeTask();
      taskRepo.tasks = [task];
      taskSelector.nextTask = task;

      const engine = new LoopEngine(deps);

      // Run first iteration manually to increment counter
      await engine.runIteration();
      const status = engine.getStatus();

      // After updating, it should trip
      const updatedDeps = { ...deps, circuitBreakerConfig: { ...deps.circuitBreakerConfig, maxIterations: 1 } };
      const engine2 = new LoopEngine(updatedDeps, {
        ...status,
        iteration: 1,
      });
      const reason = await engine2.run();
      expect(reason).toBe("max_iterations");
    });
  });

  describe("getStatus", () => {
    test("returns copy of status", () => {
      const engine = new LoopEngine(deps);
      const s1 = engine.getStatus();
      const s2 = engine.getStatus();
      expect(s1).toEqual(s2);
      expect(s1).not.toBe(s2); // different objects
    });
  });
});
