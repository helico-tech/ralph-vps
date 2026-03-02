import { z } from "zod";

export const IterationLog = z.object({
  iteration: z.number().int().min(1),
  taskId: z.string(),
  taskTitle: z.string(),
  type: z.string(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().min(0),
  model: z.string().default("unknown"),
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  cacheReadTokens: z.number().int().min(0).default(0),
  cacheWriteTokens: z.number().int().min(0).default(0),
  toolCalls: z.number().int().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  commitsMade: z.number().int().min(0).default(0),
  filesChanged: z.number().int().min(0).default(0),
  success: z.boolean(),
  error: z.string().optional(),
  preCommitHash: z.string().optional(),
  postCommitHash: z.string().optional(),
});
export type IterationLog = z.infer<typeof IterationLog>;

export const DEFAULT_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
};

export function estimateCost(
  model: string,
  tokens: { input: number; output: number },
  pricing = DEFAULT_PRICING
): number {
  const rates = pricing[model];
  if (!rates) return 0;

  const inputCost = (tokens.input / 1_000_000) * rates.input;
  const outputCost = (tokens.output / 1_000_000) * rates.output;
  return inputCost + outputCost;
}

export interface AggregateStats {
  totalIterations: number;
  successfulIterations: number;
  failedIterations: number;
  totalTokens: number;
  totalCostUsd: number;
  totalDurationMs: number;
  totalCommits: number;
  totalFilesChanged: number;
  errorRate: number;
  avgDurationMs: number;
  avgTokensPerIteration: number;
}

export function aggregateStats(logs: IterationLog[]): AggregateStats {
  if (logs.length === 0) {
    return {
      totalIterations: 0,
      successfulIterations: 0,
      failedIterations: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
      totalCommits: 0,
      totalFilesChanged: 0,
      errorRate: 0,
      avgDurationMs: 0,
      avgTokensPerIteration: 0,
    };
  }

  const successful = logs.filter((l) => l.success).length;
  const totalTokens = logs.reduce(
    (sum, l) => sum + l.inputTokens + l.outputTokens,
    0
  );
  const totalCost = logs.reduce((sum, l) => sum + l.costUsd, 0);
  const totalDuration = logs.reduce((sum, l) => sum + l.durationMs, 0);
  const totalCommits = logs.reduce((sum, l) => sum + l.commitsMade, 0);
  const totalFiles = logs.reduce((sum, l) => sum + l.filesChanged, 0);

  return {
    totalIterations: logs.length,
    successfulIterations: successful,
    failedIterations: logs.length - successful,
    totalTokens,
    totalCostUsd: totalCost,
    totalDurationMs: totalDuration,
    totalCommits,
    totalFilesChanged: totalFiles,
    errorRate: (logs.length - successful) / logs.length,
    avgDurationMs: totalDuration / logs.length,
    avgTokensPerIteration: totalTokens / logs.length,
  };
}
