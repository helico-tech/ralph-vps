export type LoopPhase =
  | "idle"
  | "pulling"
  | "selecting"
  | "compiling"
  | "executing"
  | "collecting"
  | "pushing";

export interface LoopStatus {
  phase: LoopPhase;
  iteration: number;
  consecutiveErrors: number;
  consecutiveStalls: number;
  totalTokens: number;
  totalCostUsd: number;
  startedAt: string;
  lastIterationAt: string | null;
  currentTaskId: string | null;
}

export interface CircuitBreakerConfig {
  maxConsecutiveErrors: number;
  maxStallIterations: number;
  maxCostUsd: number;
  maxTokens: number;
  maxIterations: number;
}

export interface IterationResult {
  success: boolean;
  taskId: string | null;
  tokensUsed: number;
  costUsd: number;
  durationMs: number;
  error?: string;
  commitsMade: number;
  filesChanged: number;
}

export type CircuitBreakerTrip =
  | "max_consecutive_errors"
  | "max_stall_iterations"
  | "max_cost_usd"
  | "max_tokens"
  | "max_iterations";

export function initialLoopStatus(): LoopStatus {
  return {
    phase: "idle",
    iteration: 0,
    consecutiveErrors: 0,
    consecutiveStalls: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    startedAt: new Date().toISOString(),
    lastIterationAt: null,
    currentTaskId: null,
  };
}

export function checkCircuitBreakers(
  status: LoopStatus,
  config: CircuitBreakerConfig,
  lastResult?: IterationResult
): CircuitBreakerTrip | null {
  if (
    config.maxConsecutiveErrors > 0 &&
    status.consecutiveErrors >= config.maxConsecutiveErrors
  ) {
    return "max_consecutive_errors";
  }

  if (
    config.maxStallIterations > 0 &&
    status.consecutiveStalls >= config.maxStallIterations
  ) {
    return "max_stall_iterations";
  }

  if (config.maxCostUsd > 0 && status.totalCostUsd >= config.maxCostUsd) {
    return "max_cost_usd";
  }

  if (config.maxTokens > 0 && status.totalTokens >= config.maxTokens) {
    return "max_tokens";
  }

  if (config.maxIterations > 0 && status.iteration >= config.maxIterations) {
    return "max_iterations";
  }

  return null;
}

export function updateLoopStatus(
  status: LoopStatus,
  result: IterationResult
): LoopStatus {
  const isStall = !isProgress(result);

  return {
    ...status,
    iteration: status.iteration + 1,
    consecutiveErrors: result.success
      ? 0
      : status.consecutiveErrors + 1,
    consecutiveStalls: isStall
      ? status.consecutiveStalls + 1
      : 0,
    totalTokens: status.totalTokens + result.tokensUsed,
    totalCostUsd: status.totalCostUsd + result.costUsd,
    lastIterationAt: new Date().toISOString(),
    currentTaskId: result.taskId,
  };
}

export function isProgress(
  result: IterationResult,
  minDurationMs = 5000
): boolean {
  if (!result.success) return false;
  if (result.commitsMade > 0) return true;
  if (result.filesChanged > 0) return true;
  if (result.durationMs >= minDurationMs) return true;
  return false;
}
