// Mock executor — configurable results, records all calls

import type { AgentExecutor } from "../../ports/agent-executor.js";
import type { ExecutionPlan, ExecutionResult } from "../../core/types.js";

const DEFAULT_RESULT: ExecutionResult = {
  stop_reason: "end_turn",
  output: "Task completed successfully.",
};

export class MockExecutor implements AgentExecutor {
  readonly calls: ExecutionPlan[] = [];

  constructor(
    private readonly result: ExecutionResult | ((plan: ExecutionPlan) => ExecutionResult | Promise<ExecutionResult>) = DEFAULT_RESULT,
  ) {}

  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.calls.push(plan);
    return typeof this.result === "function" ? await this.result(plan) : { ...this.result };
  }
}
