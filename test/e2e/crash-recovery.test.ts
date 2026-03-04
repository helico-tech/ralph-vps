// E2E: Crash recovery — orphaned active tasks are recovered on startup
//
// Simulates a crash by manually placing a task in active/.
// Tests that recoverOrphanedTasks moves it back and the orchestrator
// can then process it normally.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
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
import { recoverOrphanedTasks } from "../../src/orchestrator/recovery.js";
import { processTask } from "../../src/orchestrator/loop.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";

let env: E2EEnv;

beforeEach(async () => {
  env = await createE2EEnv();
});

afterEach(async () => {
  await cleanupE2EEnv(env);
});

describe("E2E — crash recovery", () => {
  it("recovers orphaned active task to pending", async () => {
    // Simulate crash: task is stuck in active/ (the orchestrator died mid-execution)
    const task = makeTask({ status: "active", retry_count: 0, max_retries: 2, claimed_at: "2026-03-03T12:00:00Z" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash: TASK-001 stuck in active");
    await pushAll(env);

    // Run recovery
    await recoverOrphanedTasks(env.deps);

    // Task should be back in pending with incremented retry_count
    const recovered = await env.deps.repo.findById("TASK-001");
    expect(recovered).not.toBeNull();
    expect(recovered!.status).toBe("pending");
    expect(recovered!.retry_count).toBe(1);
  });

  it("recovery commits and pushes to remote", async () => {
    const task = makeTask({ status: "active", retry_count: 0, claimed_at: "2026-03-03T12:00:00Z" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    // Verify the recovery commit was pushed to remote
    const remoteLog = await run(env.remoteDir, "git log --oneline main");
    expect(remoteLog).toContain("crash recovery");
  });

  it("emits task.retried event on recovery", async () => {
    const task = makeTask({ status: "active", retry_count: 0, claimed_at: "2026-03-03T12:00:00Z" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const retried = env.deps.obs.ofType("task.retried");
    expect(retried).toHaveLength(1);
    expect(retried[0].task_id).toBe("TASK-001");
    expect(retried[0].attempt).toBe(1);
  });

  it("moves to failed if retries exhausted during recovery", async () => {
    const task = makeTask({ status: "active", retry_count: 2, max_retries: 2, claimed_at: "2026-03-03T12:00:00Z" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash: exhausted retries");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const recovered = await env.deps.repo.findById("TASK-001");
    expect(recovered!.status).toBe("failed");

    const failed = env.deps.obs.ofType("task.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("crash recovery");
  });

  it("cleans up stale branch during recovery", async () => {
    // Create a stale branch that would exist from the crashed execution
    await run(env.workDir, "git checkout -b ralph/TASK-001");
    await run(env.workDir, "git checkout main");

    const task = makeTask({ status: "active", retry_count: 0, claimed_at: "2026-03-03T12:00:00Z" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash with stale branch");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    // Stale branch should be deleted
    const branches = await run(env.workDir, "git branch");
    expect(branches).not.toContain("ralph/TASK-001");
  });

  it("recovered task can be processed normally after recovery", async () => {
    const task = makeTask({ status: "active", retry_count: 0, claimed_at: "2026-03-03T12:00:00Z" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash");
    await pushAll(env);

    // Step 1: Recovery moves task back to pending
    await recoverOrphanedTasks(env.deps);
    const recovered = await env.deps.repo.findById("TASK-001");
    expect(recovered!.status).toBe("pending");

    // Step 2: Orchestrator picks it up and processes it normally
    env.deps.executor = new MockExecutor(makeFileWritingExecutor(env.workDir));
    env.deps.obs.clear();

    await processTask(env.deps, recovered!);

    const processed = await env.deps.repo.findById("TASK-001");
    expect(processed!.status).toBe("review");
    expect(processed!.branch).toBe("ralph/TASK-001");
  });

  it("recovers multiple orphaned tasks", async () => {
    const task1 = makeTask({ id: "TASK-001", status: "active", retry_count: 0, claimed_at: "2026-03-03T12:00:00Z" });
    const task2 = makeTask({ id: "TASK-002", status: "active", retry_count: 1, claimed_at: "2026-03-03T12:01:00Z" });
    await seedTask(env, task1, "active");
    await seedTask(env, task2, "active");
    await commitAll(env, "simulate crash: 2 tasks");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const t1 = await env.deps.repo.findById("TASK-001");
    const t2 = await env.deps.repo.findById("TASK-002");
    expect(t1!.status).toBe("pending");
    expect(t1!.retry_count).toBe(1);
    expect(t2!.status).toBe("pending");
    expect(t2!.retry_count).toBe(2);
  });

  it("does nothing when no orphaned tasks exist", async () => {
    const task = makeTask();
    await seedTask(env, task, "pending");
    await commitAll(env, "normal state");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    // No events emitted
    expect(env.deps.obs.events).toHaveLength(0);

    // Task unchanged
    const t = await env.deps.repo.findById("TASK-001");
    expect(t!.status).toBe("pending");
    expect(t!.retry_count).toBe(0);
  });
});
