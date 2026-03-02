import { describe, expect, test } from "bun:test";
import {
  type IterationLog,
  aggregateStats,
  estimateCost,
  DEFAULT_PRICING,
} from "../log";

describe("estimateCost", () => {
  test("calculates cost for known model", () => {
    const cost = estimateCost("claude-sonnet-4-6", {
      input: 100_000,
      output: 10_000,
    });
    // (100k / 1M) * 3.0 + (10k / 1M) * 15.0 = 0.3 + 0.15 = 0.45
    expect(cost).toBeCloseTo(0.45);
  });

  test("returns 0 for unknown model", () => {
    const cost = estimateCost("gpt-5-turbo", {
      input: 100_000,
      output: 10_000,
    });
    expect(cost).toBe(0);
  });

  test("accepts custom pricing", () => {
    const pricing = { "custom-model": { input: 1.0, output: 2.0 } };
    const cost = estimateCost("custom-model", { input: 1_000_000, output: 1_000_000 }, pricing);
    expect(cost).toBeCloseTo(3.0);
  });

  test("handles zero tokens", () => {
    const cost = estimateCost("claude-sonnet-4-6", { input: 0, output: 0 });
    expect(cost).toBe(0);
  });
});

describe("aggregateStats", () => {
  const makeLog = (overrides: Partial<IterationLog>): IterationLog => ({
    iteration: 1,
    taskId: "test",
    taskTitle: "Test",
    type: "feature-dev",
    startedAt: "2026-03-02T00:00:00.000Z",
    completedAt: "2026-03-02T00:01:00.000Z",
    durationMs: 60000,
    model: "claude-sonnet-4-6",
    inputTokens: 10000,
    outputTokens: 2000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: 15,
    costUsd: 0.06,
    commitsMade: 1,
    filesChanged: 3,
    success: true,
    ...overrides,
  });

  test("returns zeros for empty array", () => {
    const stats = aggregateStats([]);
    expect(stats.totalIterations).toBe(0);
    expect(stats.errorRate).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
  });

  test("aggregates single log", () => {
    const stats = aggregateStats([makeLog({})]);
    expect(stats.totalIterations).toBe(1);
    expect(stats.successfulIterations).toBe(1);
    expect(stats.failedIterations).toBe(0);
    expect(stats.totalTokens).toBe(12000);
    expect(stats.totalCostUsd).toBeCloseTo(0.06);
    expect(stats.totalCommits).toBe(1);
    expect(stats.totalFilesChanged).toBe(3);
    expect(stats.errorRate).toBe(0);
  });

  test("aggregates multiple logs with errors", () => {
    const logs = [
      makeLog({}),
      makeLog({ iteration: 2, success: false, error: "boom", commitsMade: 0 }),
      makeLog({ iteration: 3, costUsd: 0.10 }),
    ];
    const stats = aggregateStats(logs);
    expect(stats.totalIterations).toBe(3);
    expect(stats.successfulIterations).toBe(2);
    expect(stats.failedIterations).toBe(1);
    expect(stats.errorRate).toBeCloseTo(1 / 3);
    expect(stats.totalCostUsd).toBeCloseTo(0.22);
    expect(stats.avgDurationMs).toBe(60000);
    expect(stats.avgTokensPerIteration).toBe(12000);
  });
});
