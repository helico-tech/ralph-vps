// Agent executor port — runs Claude Code (or a mock) on a task prompt
// Implementations: src/adapters/claude-cli-executor.ts

import type { ExecutionPlan, ExecutionResult } from "../core/types.js";

export interface AgentExecutor {
  /** Execute the plan and return the result. Blocks until completion or timeout. */
  execute(plan: ExecutionPlan): Promise<ExecutionResult>;
}
