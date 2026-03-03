import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { checkConfig, checkTaskDirs, checkTaskConsistency } from "../../src/doctor.js";
import { MockTaskRepository } from "../../src/adapters/mock/mock-task-repository.js";
import { MockSourceControl } from "../../src/adapters/mock/mock-source-control.js";
import type { Task } from "../../src/core/types.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ralph-doctor-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

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

describe("checkConfig", () => {
  it("passes for valid config", async () => {
    const configPath = join(tmpDir, "config.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        version: 1,
        project: { name: "test" },
        verify: { test: "bun test" },
      }),
    );

    const result = await checkConfig(configPath);
    expect(result.passed).toBe(true);
    expect(result.name).toBe("Configuration");
  });

  it("fails for missing config", async () => {
    const result = await checkConfig(join(tmpDir, "nope.json"));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("fails for invalid config", async () => {
    const configPath = join(tmpDir, "bad.json");
    await Bun.write(configPath, "not json");

    const result = await checkConfig(configPath);
    expect(result.passed).toBe(false);
  });
});

describe("checkTaskDirs", () => {
  it("passes when all directories exist", async () => {
    const tasksDir = join(tmpDir, "tasks");
    for (const dir of ["pending", "active", "review", "done", "failed"]) {
      await mkdir(join(tasksDir, dir), { recursive: true });
    }

    const result = await checkTaskDirs(tasksDir);
    expect(result.passed).toBe(true);
  });

  it("fails when directories are missing", async () => {
    const tasksDir = join(tmpDir, "tasks");
    await mkdir(join(tasksDir, "pending"), { recursive: true });

    const result = await checkTaskDirs(tasksDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("active");
    expect(result.message).toContain("review");
  });

  it("fails when tasks dir does not exist", async () => {
    const result = await checkTaskDirs(join(tmpDir, "nonexistent"));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("pending");
  });
});

describe("checkTaskConsistency", () => {
  it("passes when no issues found", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "TASK-001", status: "pending" }), "pending");
    const git = new MockSourceControl();

    const result = await checkTaskConsistency(repo, git, "ralph/");
    expect(result.passed).toBe(true);
  });

  it("fails when active task has no branch", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "TASK-001", status: "active" }), "active");
    const git = new MockSourceControl();
    // No branches exist

    const result = await checkTaskConsistency(repo, git, "ralph/");
    expect(result.passed).toBe(false);
    expect(result.message).toContain("TASK-001");
  });

  it("passes when active task has matching branch", async () => {
    const repo = new MockTaskRepository();
    repo.seed(makeTask({ id: "TASK-001", status: "active" }), "active");
    const git = new MockSourceControl();
    await git.createBranch("ralph/TASK-001");

    const result = await checkTaskConsistency(repo, git, "ralph/");
    expect(result.passed).toBe(true);
  });
});
