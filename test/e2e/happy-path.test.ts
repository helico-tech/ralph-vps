// E2E: Happy path — full cycle from pending through review to done
//
// Uses real filesystem + real git (temp repos) + mock executor.
// The executor writes a real file to simulate Claude's work.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import {
  createE2EEnv,
  cleanupE2EEnv,
  seedTask,
  commitAll,
  pushAll,
  makeTask,
  makeFileWritingExecutor,
  run,
} from "./helpers.js";
import type { E2EEnv } from "./helpers.js";
import { processTask } from "../../src/orchestrator/loop.js";
import { reviewTask } from "../../src/client/review-task.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";

let env: E2EEnv;

beforeEach(async () => {
  const task = makeTask();
  env = await createE2EEnv();
  await seedTask(env, task, "pending");
  await commitAll(env, "seed: TASK-001 pending");
  await pushAll(env);

  env.deps.executor = new MockExecutor(makeFileWritingExecutor(env.workDir));
});

afterEach(async () => {
  await cleanupE2EEnv(env);
});

function makeClientDeps() {
  return {
    repo: env.deps.repo,
    git: env.deps.git,
    config: env.deps.config,
    tasksDir: ".ralph/tasks",
  };
}

describe("E2E — happy path", () => {
  it("processes task from pending to review", async () => {
    // Verify task starts in pending
    const before = await env.deps.repo.findById("TASK-001");
    expect(before).not.toBeNull();
    expect(before!.status).toBe("pending");

    // Run processTask
    await processTask(env.deps, before!);

    // Task should now be in review
    const after = await env.deps.repo.findById("TASK-001");
    expect(after).not.toBeNull();
    expect(after!.status).toBe("review");
    expect(after!.branch).toBe("ralph/TASK-001");
    expect(after!.cost_usd).toBe(0.05);
    expect(after!.turns).toBe(5);
  });

  it("creates and pushes feature branch", async () => {
    const task = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, task!);

    // Feature branch should exist in remote
    const remoteBranches = await run(env.remoteDir, "git branch");
    expect(remoteBranches).toContain("ralph/TASK-001");
  });

  it("agent-written file exists on feature branch", async () => {
    const task = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, task!);

    // Check out the feature branch and verify the file
    await run(env.workDir, "git checkout ralph/TASK-001");
    const content = await Bun.file(join(env.workDir, "agent-output.txt")).text();
    expect(content).toContain("Agent was here");

    // Switch back to main
    await run(env.workDir, "git checkout main");
  });

  it("emits correct domain events", async () => {
    const task = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, task!);

    const types = env.deps.obs.events.map((e) => e.type);
    expect(types).toEqual([
      "task.claimed",
      "execution.started",
      "execution.completed",
      "verification.started",
      "verification.completed",
      "task.completed",
    ]);
  });

  it("full cycle: pending → review → done (approve)", async () => {
    // Step 1: Orchestrator processes task
    const task = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, task!);

    // Verify task is in review
    const inReview = await env.deps.repo.findById("TASK-001");
    expect(inReview!.status).toBe("review");

    // Step 2: Client approves the task
    const approved = await reviewTask(makeClientDeps(), "TASK-001", { decision: "approve" });
    expect(approved.status).toBe("done");

    // Task file should be in done/
    const final = await env.deps.repo.findById("TASK-001");
    expect(final).not.toBeNull();
    expect(final!.status).toBe("done");
  });

  it("review approve merges feature branch changes into main", async () => {
    const task = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, task!);

    await reviewTask(makeClientDeps(), "TASK-001", { decision: "approve" });

    // The agent's file should now be on main (merged)
    const content = await Bun.file(join(env.workDir, "agent-output.txt")).text();
    expect(content).toContain("Agent was here");
  });

  it("review approve pushes all changes to remote", async () => {
    const task = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, task!);

    await reviewTask(makeClientDeps(), "TASK-001", { decision: "approve" });

    // Verify remote main has the merge
    const remoteLog = await run(env.remoteDir, "git log --oneline main");
    expect(remoteLog).toContain("approved");
  });
});
