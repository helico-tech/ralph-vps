import { describe, expect, test } from "bun:test";
import {
  generateTaskId,
  parseTask,
  serializeTask,
  selectNextTask,
  transitionTask,
  initialLoopStatus,
  updateLoopStatus,
  checkCircuitBreakers,
  estimateCost,
  aggregateStats,
} from "../index";
import type { Task, CircuitBreakerConfig, IterationResult, IterationLog } from "../index";

describe("domain integration", () => {
  test("full lifecycle: create → parse → select → iterate → circuit break → cost", () => {
    // 1. Create tasks
    const now = new Date("2026-03-02T10:00:00.000Z");
    const id1 = generateTaskId("Setup database", now);
    const id2 = generateTaskId("Add user model", new Date("2026-03-02T10:00:01.000Z"));

    const task1Raw = `---
id: "${id1}"
title: "Setup database"
status: pending
type: feature-dev
priority: 1
order: 1
depends_on: []
created: "2026-03-02T10:00:00.000Z"
---

Create the database schema.
`;

    const task2Raw = `---
id: "${id2}"
title: "Add user model"
status: pending
type: feature-dev
priority: 1
order: 2
depends_on:
  - "${id1}"
created: "2026-03-02T10:00:01.000Z"
---

Add user model depending on database.
`;

    // 2. Parse tasks
    const task1 = parseTask(task1Raw, "tasks/task1.md");
    const task2 = parseTask(task2Raw, "tasks/task2.md");
    const tasks: Task[] = [task1, task2];

    // 3. Select next — should be task1 (task2 depends on it)
    const next = selectNextTask(tasks);
    expect(next?.id).toBe(id1);

    // 4. Transition to in_progress
    const started = transitionTask(next!, "in_progress");
    expect(started.status).toBe("in_progress");

    // 5. Simulate iteration
    let loopStatus = initialLoopStatus();
    const result: IterationResult = {
      success: true,
      taskId: id1,
      tokensUsed: 50000,
      costUsd: estimateCost("claude-sonnet-4-6", { input: 40000, output: 10000 }),
      durationMs: 120000,
      commitsMade: 3,
      filesChanged: 5,
    };
    loopStatus = updateLoopStatus(loopStatus, result);

    expect(loopStatus.iteration).toBe(1);
    expect(loopStatus.consecutiveErrors).toBe(0);

    // 6. Complete task1, now task2 should be selectable
    const completed = transitionTask(started, "completed");
    const updatedTasks: Task[] = [completed, task2];
    const next2 = selectNextTask(updatedTasks);
    expect(next2?.id).toBe(id2);

    // 7. Round-trip serialize
    const serialized = serializeTask(completed);
    const reparsed = parseTask(serialized, "tasks/task1.md");
    expect(reparsed.status).toBe("completed");

    // 8. Check circuit breakers — should not trip
    const config: CircuitBreakerConfig = {
      maxConsecutiveErrors: 3,
      maxStallIterations: 5,
      maxCostUsd: 100,
      maxTokens: 10_000_000,
      maxIterations: 50,
    };
    expect(checkCircuitBreakers(loopStatus, config)).toBeNull();

    // 9. Aggregate stats
    const log: IterationLog = {
      iteration: 1,
      taskId: id1,
      taskTitle: "Setup database",
      type: "feature-dev",
      startedAt: "2026-03-02T10:00:00.000Z",
      completedAt: "2026-03-02T10:02:00.000Z",
      durationMs: 120000,
      model: "claude-sonnet-4-6",
      inputTokens: 40000,
      outputTokens: 10000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: 25,
      costUsd: result.costUsd,
      commitsMade: 3,
      filesChanged: 5,
      success: true,
    };
    const stats = aggregateStats([log]);
    expect(stats.totalIterations).toBe(1);
    expect(stats.successfulIterations).toBe(1);
    expect(stats.totalCommits).toBe(3);
    expect(stats.errorRate).toBe(0);
  });
});
