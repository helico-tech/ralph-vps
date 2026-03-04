// Error types — pure domain, zero I/O imports

export class TaskError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TaskError";
    this.code = code;
  }
}

export class GitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GitError";
    this.code = code;
  }
}

export class ExecutionError extends Error {
  readonly code: string;
  readonly timeout: boolean;

  constructor(code: string, message: string, timeout = false) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
    this.timeout = timeout;
  }
}

export class ConfigError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConfigError";
    this.code = code;
  }
}

// Error codes
export const ERROR_CODES = {
  // TaskError
  INVALID_TRANSITION: "INVALID_TRANSITION",
  PARSE_ERROR: "PARSE_ERROR",
  MISSING_FIELD: "MISSING_FIELD",
  INVALID_TYPE: "INVALID_TYPE",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  DUPLICATE_ID: "DUPLICATE_ID",

  // GitError
  GIT_PUSH_FAILED: "GIT_PUSH_FAILED",
  GIT_PULL_FAILED: "GIT_PULL_FAILED",
  GIT_BRANCH_EXISTS: "GIT_BRANCH_EXISTS",
  GIT_BRANCH_NOT_FOUND: "GIT_BRANCH_NOT_FOUND",
  GIT_MERGE_CONFLICT: "GIT_MERGE_CONFLICT",
  GIT_COMMAND_FAILED: "GIT_COMMAND_FAILED",

  // ExecutionError
  EXECUTION_TIMEOUT: "EXECUTION_TIMEOUT",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  CLAUDE_NOT_FOUND: "CLAUDE_NOT_FOUND",
  INVALID_OUTPUT: "INVALID_OUTPUT",

  // ConfigError
  CONFIG_NOT_FOUND: "CONFIG_NOT_FOUND",
  CONFIG_INVALID: "CONFIG_INVALID",
  CONFIG_MISSING_FIELD: "CONFIG_MISSING_FIELD",
} as const;
