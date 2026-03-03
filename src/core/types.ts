// Core types — pure domain, zero I/O imports

export type TaskStatus = "pending" | "active" | "review" | "done" | "failed";

export type TaskType =
  | "bugfix"
  | "feature"
  | "refactor"
  | "research"
  | "test"
  | "chore";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  priority: number;
  created_at: string;
  author: string;
  description: string;

  // Recommended but optional
  acceptance_criteria?: string[];
  files?: string[];
  constraints?: string[];

  // Execution config
  max_retries: number;
  retry_count: number;

  // Set by orchestrator on claim
  claimed_at?: string;

  // Set by orchestrator on completion
  cost_usd?: number;
  turns?: number;
  duration_s?: number;
  attempt?: number;
  branch?: string;
  completed_at?: string;

  // Forward-compatible: unknown frontmatter fields are preserved
  [key: string]: unknown;
}

export interface ExecutionPlan {
  prompt: string;
  model: string;
  max_turns: number;
  budget_usd: number;
  timeout_ms: number;
  system_prompt_file: string;
  permission_mode: string;
  working_directory: string;
}

export type StopReason =
  | "end_turn"
  | "max_turns"
  | "refusal"
  | "timeout"
  | "error";

export interface ExecutionResult {
  stop_reason: StopReason;
  cost_usd: number;
  turns: number;
  duration_s: number;
  output: string;
}

export interface VerificationResult {
  passed: boolean;
  skipped: boolean;
  output: string;
  command: string;
}

export interface PromptTemplate {
  name: string;
  content: string;
}

// Domain events — discriminated union
export type DomainEvent =
  | { type: "task.claimed"; task_id: string; timestamp: string }
  | { type: "task.completed"; task_id: string; timestamp: string; cost_usd: number; turns: number; duration_s: number }
  | { type: "task.failed"; task_id: string; timestamp: string; reason: string }
  | { type: "task.retried"; task_id: string; timestamp: string; attempt: number }
  | { type: "execution.started"; task_id: string; timestamp: string; model: string }
  | { type: "execution.completed"; task_id: string; timestamp: string; stop_reason: StopReason; cost_usd: number }
  | { type: "verification.started"; task_id: string; timestamp: string }
  | { type: "verification.completed"; task_id: string; timestamp: string; passed: boolean }
  | { type: "budget.exceeded"; task_id: string; timestamp: string; cost_usd: number; limit_usd: number }
  | { type: "orchestrator.started"; timestamp: string }
  | { type: "orchestrator.stopped"; timestamp: string; reason: string };

// Configuration
export interface RalphConfig {
  version: number;
  project: { name: string };
  verify: {
    test: string;
    build: string;
    lint: string;
  };
  task_defaults: {
    max_retries: number;
    model: string;
    max_turns: number;
    max_budget_usd: number;
    timeout_seconds: number;
  };
  exit_criteria: {
    require_tests: boolean;
    require_build: boolean;
    require_lint: boolean;
  };
  git: {
    main_branch: string;
    branch_prefix: string;
  };
  execution: {
    permission_mode: string;
  };
}

// Budget tracking
export interface CostSummary {
  today_usd: number;
  total_usd: number;
  task_count: number;
}

export interface BudgetLimits {
  daily_usd: number;
  per_task_usd: number;
}

// Consistency check results
export interface ConsistencyIssue {
  type: "orphaned_active" | "duplicate_id" | "missing_branch" | "invalid_status";
  task_id: string;
  message: string;
}

export interface ConsistencyReport {
  issues: ConsistencyIssue[];
  scanned_statuses: TaskStatus[];
  clean: boolean;
}
