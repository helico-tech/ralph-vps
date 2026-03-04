// Core types — pure domain, zero I/O imports

export type TaskStatus = "pending" | "active" | "done" | "failed";

export type TaskType = "feature" | "bugfix" | "review" | "fix";

export interface Task {
  // Frontmatter — user-authored
  id: string;
  type: TaskType;
  priority: number;
  parent_id?: string;

  // Frontmatter — orchestrator-set on completion
  commit_hash?: string;

  // Derived from filesystem directory — NOT serialized to frontmatter
  status: TaskStatus;

  // Markdown body
  description: string;

  // Forward-compatible: unknown frontmatter fields are preserved
  [key: string]: unknown;
}

export interface ExecutionPlan {
  prompt: string;
  model: string;
  max_turns: number;
  timeout_ms: number;
  system_prompt: string;
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
  output: string;
}

// Domain events
export type DomainEvent =
  | { type: "task.claimed"; task_id: string; timestamp: string }
  | { type: "task.completed"; task_id: string; timestamp: string; commit_hash?: string }
  | { type: "task.failed"; task_id: string; timestamp: string; reason: string }
  | { type: "task.spawned"; task_id: string; parent_id: string; timestamp: string; spawned_type: TaskType }
  | { type: "task.recovered"; task_id: string; timestamp: string }
  | { type: "branch.merged"; task_id: string; branch: string; timestamp: string }
  | { type: "execution.started"; task_id: string; timestamp: string; model: string }
  | { type: "execution.completed"; task_id: string; timestamp: string; stop_reason: StopReason }
  | { type: "verification.started"; task_id: string; timestamp: string }
  | { type: "verification.completed"; task_id: string; timestamp: string; passed: boolean }
  | { type: "orchestrator.started"; timestamp: string }
  | { type: "orchestrator.stopped"; timestamp: string; reason: string };

// Configuration
export interface RalphConfig {
  version: number;
  project: { name: string };
  verify: string;
  task_defaults: {
    model: string;
    max_turns: number;
    timeout_seconds: number;
  };
  git: {
    main_branch: string;
    branch_prefix: string;
  };
  execution: {
    permission_mode: string;
  };
}

// Task location — for recovery scans
export interface TaskLocation {
  task: Task;
  directory: TaskStatus;
}
