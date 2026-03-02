export class RalphError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RalphError";
  }
}

export class TaskValidationError extends RalphError {
  constructor(message: string, public readonly field?: string, cause?: unknown) {
    super(message, cause);
    this.name = "TaskValidationError";
  }
}

export class ConfigError extends RalphError {
  constructor(message: string, public readonly configPath?: string, cause?: unknown) {
    super(message, cause);
    this.name = "ConfigError";
  }
}

export class EnvironmentError extends RalphError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "EnvironmentError";
  }
}

export class GitError extends RalphError {
  constructor(message: string, public readonly command?: string, cause?: unknown) {
    super(message, cause);
    this.name = "GitError";
  }
}

export class RemoteError extends RalphError {
  constructor(message: string, public readonly node?: string, cause?: unknown) {
    super(message, cause);
    this.name = "RemoteError";
  }
}
