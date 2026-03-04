// E2E: Failure and retry cycle — task fails verification, retries, eventually fails permanently
//
// Uses real filesystem + real git (temp repos) + mock executor + mock verifier.

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createE2EEnv,
  cleanupE2EEnv,
  seedTask,
  commitAll,
  pushAll,
  makeTask,
  makeFileWritingExecutor,
} from "./helpers.js";
import type { E2EEnv } from "./helpers.js";
import { processTask } from "../../src/orchestrator/loop.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";

let env: E2EEnv;

beforeEach(async () => {
  env = await createE2EEnv();
});

afterEach(async () => {
  await cleanupE2EEnv(env);
});

describe("E2E — failure and retry", () => {
  it("retries task on verification failure", async () => {
    const task = makeTask({ max_retries: 2, retry_count: 0 });
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    // Executor succeeds but verifier fails
    env.deps.executor = new MockExecutor(makeFileWritingExecutor(env.workDir));
    env.deps.verifier.setTestResult({ passed: false, output: "FAIL" });

    // First attempt — should go back to pending with retry_count: 1
    const pending = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, pending!);

    const afterFirst = await env.deps.repo.findById("TASK-001");
    expect(afterFirst!.status).toBe("pending");
    expect(afterFirst!.retry_count).toBe(1);
  });

  it("fails permanently after exhausting retries", async () => {
    const task = makeTask({ max_retries: 2, retry_count: 0 });
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    // Executor writes files, verifier always fails
    env.deps.executor = new MockExecutor(makeFileWritingExecutor(env.workDir));
    env.deps.verifier.setTestResult({ passed: false, output: "FAIL" });

    // Attempt 1: pending(0) → active → pending(1)
    let current = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, current!);
    current = await env.deps.repo.findById("TASK-001");
    expect(current!.status).toBe("pending");
    expect(current!.retry_count).toBe(1);

    // Attempt 2: pending(1) → active → pending(2)
    env.deps.obs.clear();
    await processTask(env.deps, current!);
    current = await env.deps.repo.findById("TASK-001");
    expect(current!.status).toBe("pending");
    expect(current!.retry_count).toBe(2);

    // Attempt 3: pending(2) → active → failed (retries exhausted)
    env.deps.obs.clear();
    await processTask(env.deps, current!);
    current = await env.deps.repo.findById("TASK-001");
    expect(current!.status).toBe("failed");
  });

  it("emits task.retried on retry and task.failed on exhaustion", async () => {
    const task = makeTask({ max_retries: 1, retry_count: 0 });
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    env.deps.executor = new MockExecutor(makeFileWritingExecutor(env.workDir));
    env.deps.verifier.setTestResult({ passed: false, output: "FAIL" });

    // Attempt 1: should emit task.retried
    let current = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, current!);

    const retried = env.deps.obs.ofType("task.retried");
    expect(retried).toHaveLength(1);
    expect(retried[0].attempt).toBe(1);

    // Attempt 2: should emit task.failed (max_retries=1, retry_count now 1)
    env.deps.obs.clear();
    current = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, current!);

    const failed = env.deps.obs.ofType("task.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("verification failed");
  });

  it("retries on execution error without calling verifier", async () => {
    const task = makeTask({ max_retries: 2, retry_count: 0 });
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    // Executor returns error stop reason
    env.deps.executor = new MockExecutor({
      stop_reason: "error",
      cost_usd: 0,
      turns: 1,
      duration_s: 1,
      output: "Error",
    });

    const pending = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, pending!);

    const after = await env.deps.repo.findById("TASK-001");
    expect(after!.status).toBe("pending");
    expect(after!.retry_count).toBe(1);

    // Verification should NOT have been called
    expect(env.deps.verifier.calls).toHaveLength(0);
  });

  it("fails immediately on timeout (no verification)", async () => {
    const task = makeTask({ max_retries: 0, retry_count: 0 });
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    env.deps.executor = new MockExecutor({
      stop_reason: "timeout",
      cost_usd: 0,
      turns: 1,
      duration_s: 1800,
      output: "",
    });

    const pending = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, pending!);

    // max_retries=0, so goes straight to failed
    const after = await env.deps.repo.findById("TASK-001");
    expect(after!.status).toBe("failed");
    expect(env.deps.verifier.calls).toHaveLength(0);
  });
});
