import { describe, expect, test } from "bun:test";
import {
  type CircuitBreakerConfig,
  type IterationResult,
  checkCircuitBreakers,
  initialLoopStatus,
  isProgress,
  updateLoopStatus,
} from "../loop";

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveErrors: 3,
  maxStallIterations: 5,
  maxCostUsd: 10,
  maxTokens: 1_000_000,
  maxIterations: 100,
};

const successResult: IterationResult = {
  success: true,
  taskId: "test-task",
  tokensUsed: 5000,
  costUsd: 0.05,
  durationMs: 30000,
  commitsMade: 1,
  filesChanged: 3,
};

const failResult: IterationResult = {
  success: false,
  taskId: "test-task",
  tokensUsed: 1000,
  costUsd: 0.01,
  durationMs: 5000,
  error: "Claude crashed",
  commitsMade: 0,
  filesChanged: 0,
};

describe("initialLoopStatus", () => {
  test("creates clean initial state", () => {
    const status = initialLoopStatus();
    expect(status.phase).toBe("idle");
    expect(status.iteration).toBe(0);
    expect(status.consecutiveErrors).toBe(0);
    expect(status.consecutiveStalls).toBe(0);
    expect(status.totalTokens).toBe(0);
    expect(status.totalCostUsd).toBe(0);
    expect(status.lastIterationAt).toBeNull();
    expect(status.currentTaskId).toBeNull();
  });
});

describe("checkCircuitBreakers", () => {
  test("returns null when nothing tripped", () => {
    const status = initialLoopStatus();
    expect(checkCircuitBreakers(status, DEFAULT_CONFIG)).toBeNull();
  });

  test("trips on max consecutive errors", () => {
    const status = { ...initialLoopStatus(), consecutiveErrors: 3 };
    expect(checkCircuitBreakers(status, DEFAULT_CONFIG)).toBe(
      "max_consecutive_errors"
    );
  });

  test("trips on max stall iterations", () => {
    const status = { ...initialLoopStatus(), consecutiveStalls: 5 };
    expect(checkCircuitBreakers(status, DEFAULT_CONFIG)).toBe(
      "max_stall_iterations"
    );
  });

  test("trips on max cost", () => {
    const status = { ...initialLoopStatus(), totalCostUsd: 10 };
    expect(checkCircuitBreakers(status, DEFAULT_CONFIG)).toBe("max_cost_usd");
  });

  test("trips on max tokens", () => {
    const status = { ...initialLoopStatus(), totalTokens: 1_000_000 };
    expect(checkCircuitBreakers(status, DEFAULT_CONFIG)).toBe("max_tokens");
  });

  test("trips on max iterations", () => {
    const status = { ...initialLoopStatus(), iteration: 100 };
    expect(checkCircuitBreakers(status, DEFAULT_CONFIG)).toBe("max_iterations");
  });

  test("disabled limit (0) never trips", () => {
    const disabledConfig: CircuitBreakerConfig = {
      maxConsecutiveErrors: 0,
      maxStallIterations: 0,
      maxCostUsd: 0,
      maxTokens: 0,
      maxIterations: 0,
    };
    const status = {
      ...initialLoopStatus(),
      consecutiveErrors: 999,
      totalCostUsd: 999,
      totalTokens: 999_999,
      iteration: 999,
    };
    expect(checkCircuitBreakers(status, disabledConfig)).toBeNull();
  });
});

describe("updateLoopStatus", () => {
  test("increments iteration on success", () => {
    const status = initialLoopStatus();
    const updated = updateLoopStatus(status, successResult);
    expect(updated.iteration).toBe(1);
    expect(updated.consecutiveErrors).toBe(0);
    expect(updated.totalTokens).toBe(5000);
    expect(updated.totalCostUsd).toBe(0.05);
  });

  test("increments consecutive errors on failure", () => {
    const status = initialLoopStatus();
    const updated = updateLoopStatus(status, failResult);
    expect(updated.consecutiveErrors).toBe(1);
  });

  test("resets consecutive errors on success", () => {
    const status = { ...initialLoopStatus(), consecutiveErrors: 2 };
    const updated = updateLoopStatus(status, successResult);
    expect(updated.consecutiveErrors).toBe(0);
  });

  test("accumulates tokens and cost", () => {
    let status = initialLoopStatus();
    status = updateLoopStatus(status, successResult);
    status = updateLoopStatus(status, successResult);
    expect(status.totalTokens).toBe(10000);
    expect(status.totalCostUsd).toBeCloseTo(0.10);
    expect(status.iteration).toBe(2);
  });
});

describe("isProgress", () => {
  test("failed result is not progress", () => {
    expect(isProgress(failResult)).toBe(false);
  });

  test("commits made is progress", () => {
    expect(isProgress(successResult)).toBe(true);
  });

  test("files changed is progress", () => {
    expect(
      isProgress({ ...successResult, commitsMade: 0, filesChanged: 1 })
    ).toBe(true);
  });

  test("long duration is progress", () => {
    expect(
      isProgress({
        ...successResult,
        commitsMade: 0,
        filesChanged: 0,
        durationMs: 10000,
      })
    ).toBe(true);
  });

  test("short no-change is not progress", () => {
    expect(
      isProgress({
        ...successResult,
        commitsMade: 0,
        filesChanged: 0,
        durationMs: 1000,
      })
    ).toBe(false);
  });

  test("custom minDuration respected", () => {
    expect(
      isProgress(
        {
          ...successResult,
          commitsMade: 0,
          filesChanged: 0,
          durationMs: 3000,
        },
        2000
      )
    ).toBe(true);
  });
});
