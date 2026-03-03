// Mock executor — configurable results, records all calls

import type { AgentExecutor } from "../../ports/agent-executor.js";
import type { ExecutionPlan, ExecutionResult } from "../../core/types.js";

const DEFAULT_RESULT: ExecutionResult = {
  stop_reason: "end_turn",
  cost_usd: 0.01,
  turns: 3,
  duration_s: 10,
  output: "Task completed successfully.",
};

export class MockExecutor implements AgentExecutor {
  readonly calls: ExecutionPlan[] = [];

  constructor(
    private readonly result: ExecutionResult | ((plan: ExecutionPlan) => ExecutionResult) = DEFAULT_RESULT
  ) {}

  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.calls.push(plan);
    return typeof this.result === "function" ? this.result(plan) : { ...this.result };
  }
}
