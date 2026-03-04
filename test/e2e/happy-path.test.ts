// E2E: Happy path — full cycle from pending through done with follow-up tasks
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

describe("E2E — happy path", () => {
  it("processes feature task from pending to done and spawns review", async () => {
    const before = await env.deps.repo.findById("TASK-001");
    expect(before).not.toBeNull();
    expect(before!.status).toBe("pending");

    await processTask(env.deps, before!);

    // Task should now be done
    const after = await env.deps.repo.findById("TASK-001");
    expect(after).not.toBeNull();
    expect(after!.status).toBe("done");

    // A review task should have been spawned
    const allTasks = await env.deps.repo.listAll();
    const review = allTasks.find((t) => t.type === "review");
    expect(review).toBeDefined();
    expect(review!.parent_id).toBe("TASK-001");
    expect(review!.status).toBe("pending");
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

    await run(env.workDir, "git checkout main");
  });

  it("emits correct domain events", async () => {
    const task = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, task!);

    const types = env.deps.obs.events.map((e) => e.type);
    expect(types).toContain("task.claimed");
    expect(types).toContain("execution.started");
    expect(types).toContain("execution.completed");
    expect(types).toContain("verification.started");
    expect(types).toContain("verification.completed");
    expect(types).toContain("task.completed");
    expect(types).toContain("task.spawned");
  });
});
