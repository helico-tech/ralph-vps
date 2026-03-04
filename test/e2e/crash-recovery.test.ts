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
    const task = makeTask({ status: "active" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash: TASK-001 stuck in active");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const recovered = await env.deps.repo.findById("TASK-001");
    expect(recovered).not.toBeNull();
    expect(recovered!.status).toBe("pending");
  });

  it("recovery commits and pushes to remote", async () => {
    const task = makeTask({ status: "active" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const remoteLog = await run(env.remoteDir, "git log --oneline main");
    expect(remoteLog).toContain("crash recovery");
  });

  it("emits task.recovered event on recovery", async () => {
    const task = makeTask({ status: "active" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const recovered = env.deps.obs.ofType("task.recovered");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].task_id).toBe("TASK-001");
  });

  it("cleans up stale branch during recovery", async () => {
    await run(env.workDir, "git checkout -b ralph/TASK-001");
    await run(env.workDir, "git checkout main");

    const task = makeTask({ status: "active" });
    await seedTask(env, task, "active");
    await commitAll(env, "simulate crash with stale branch");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const branches = await run(env.workDir, "git branch");
    expect(branches).not.toContain("ralph/TASK-001");
  });

  it("recovered task can be processed normally after recovery", async () => {
    const task = makeTask({ status: "active" });
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
    expect(processed!.status).toBe("done");
  });

  it("recovers multiple orphaned tasks", async () => {
    const task1 = makeTask({ id: "TASK-001", status: "active" });
    const task2 = makeTask({ id: "TASK-002", status: "active" });
    await seedTask(env, task1, "active");
    await seedTask(env, task2, "active");
    await commitAll(env, "simulate crash: 2 tasks");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    const t1 = await env.deps.repo.findById("TASK-001");
    const t2 = await env.deps.repo.findById("TASK-002");
    expect(t1!.status).toBe("pending");
    expect(t2!.status).toBe("pending");
  });

  it("does nothing when no orphaned tasks exist", async () => {
    const task = makeTask();
    await seedTask(env, task, "pending");
    await commitAll(env, "normal state");
    await pushAll(env);

    await recoverOrphanedTasks(env.deps);

    expect(env.deps.obs.events).toHaveLength(0);

    const t = await env.deps.repo.findById("TASK-001");
    expect(t!.status).toBe("pending");
  });
});
