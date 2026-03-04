// E2E: Failure scenarios — task fails verification or execution
//
// Uses real filesystem + real git (temp repos) + mock executor.

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

describe("E2E — failure scenarios", () => {
  it("fails task when verification fails", async () => {
    // Override verify command to one that always fails
    env = await createE2EEnv({ verify: "false" });
    const task = makeTask();
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    env.deps.executor = new MockExecutor(makeFileWritingExecutor(env.workDir));

    const pending = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, pending!);

    const after = await env.deps.repo.findById("TASK-001");
    expect(after!.status).toBe("failed");
  });

  it("fails on execution error without calling verifier", async () => {
    const task = makeTask();
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    env.deps.executor = new MockExecutor({
      stop_reason: "error",
      output: "Error",
    });

    const pending = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, pending!);

    const after = await env.deps.repo.findById("TASK-001");
    expect(after!.status).toBe("failed");

    // Verification should NOT have been called
    expect(env.deps.obs.ofType("verification.started")).toHaveLength(0);
  });

  it("fails on timeout without calling verifier", async () => {
    const task = makeTask();
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    env.deps.executor = new MockExecutor({
      stop_reason: "timeout",
      output: "",
    });

    const pending = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, pending!);

    const after = await env.deps.repo.findById("TASK-001");
    expect(after!.status).toBe("failed");
    expect(env.deps.obs.ofType("verification.started")).toHaveLength(0);
  });

  it("emits task.failed event", async () => {
    env = await createE2EEnv({ verify: "false" });
    const task = makeTask();
    await seedTask(env, task, "pending");
    await commitAll(env, "seed: TASK-001 pending");
    await pushAll(env);

    env.deps.executor = new MockExecutor(makeFileWritingExecutor(env.workDir));

    const pending = await env.deps.repo.findById("TASK-001");
    await processTask(env.deps, pending!);

    const failed = env.deps.obs.ofType("task.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].task_id).toBe("TASK-001");
  });
});
