// Config loader — reads .ralph/config.json, validates, applies defaults + env overrides

import type { RalphConfig } from "../core/types.js";
import { ConfigError, ERROR_CODES } from "../core/errors.js";

const DEFAULTS: RalphConfig = {
  version: 1,
  project: { name: "" },
  verify: "",
  task_defaults: {
    model: "claude-opus-4-5",
    max_turns: 50,
    timeout_seconds: 1800,
  },
  git: { main_branch: "main", branch_prefix: "ralph/" },
  execution: { permission_mode: "skip_all" },
};

export async function loadConfig(configPath: string): Promise<RalphConfig> {
  const file = Bun.file(configPath);
  if (!(await file.exists())) {
    throw new ConfigError(
      ERROR_CODES.CONFIG_NOT_FOUND,
      `Config file not found: ${configPath}`,
    );
  }

  let raw: string;
  try {
    raw = await file.text();
  } catch {
    throw new ConfigError(
      ERROR_CODES.CONFIG_NOT_FOUND,
      `Could not read config file: ${configPath}`,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigError(
      ERROR_CODES.CONFIG_INVALID,
      `Config file is not valid JSON: ${configPath}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(ERROR_CODES.CONFIG_INVALID, "Config must be a JSON object");
  }

  const config = mergeDefaults(DEFAULTS, parsed);

  // Validate required fields
  if (!config.project?.name) {
    throw new ConfigError(
      ERROR_CODES.CONFIG_MISSING_FIELD,
      "config.project.name is required",
    );
  }
  if (!config.verify) {
    throw new ConfigError(
      ERROR_CODES.CONFIG_MISSING_FIELD,
      "config.verify is required (e.g. 'bun test')",
    );
  }

  // Env var overrides
  if (process.env.RALPH_MODEL) {
    config.task_defaults.model = process.env.RALPH_MODEL;
  }
  if (process.env.RALPH_MAIN_BRANCH) {
    config.git.main_branch = process.env.RALPH_MAIN_BRANCH;
  }
  if (process.env.RALPH_PERMISSION_MODE) {
    config.execution.permission_mode = process.env.RALPH_PERMISSION_MODE;
  }

  return config;
}

/**
 * Shallow merge per top-level section. File values override defaults.
 */
function mergeSection<T extends Record<string, unknown>>(
  defaults: T,
  overrides: Record<string, unknown> | undefined,
): T {
  if (!overrides || typeof overrides !== "object") return defaults;
  return { ...defaults, ...overrides };
}

function mergeDefaults(defaults: RalphConfig, overrides: Record<string, unknown>): RalphConfig {
  return {
    version: (overrides.version as number) ?? defaults.version,
    project: mergeSection(defaults.project, overrides.project as Record<string, unknown>),
    verify: (overrides.verify as string) ?? defaults.verify,
    task_defaults: mergeSection(defaults.task_defaults, overrides.task_defaults as Record<string, unknown>),
    git: mergeSection(defaults.git, overrides.git as Record<string, unknown>),
    execution: mergeSection(defaults.execution, overrides.execution as Record<string, unknown>),
  };
}
