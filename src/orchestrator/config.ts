// Config loader — reads .ralph/config.json, validates, applies defaults + env overrides

import type { RalphConfig } from "../core/types.js";
import { ConfigError, ERROR_CODES } from "../core/errors.js";

const DEFAULTS: RalphConfig = {
  version: 1,
  project: { name: "" },
  verify: { test: "", build: "", lint: "" },
  task_defaults: {
    max_retries: 2,
    model: "claude-opus-4-5",
    max_turns: 50,
    max_budget_usd: 5.0,
    timeout_seconds: 1800,
  },
  exit_criteria: {
    require_tests: true,
    require_build: false,
    require_lint: false,
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

  let parsed: unknown;
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

  const config = mergeDefaults(
    DEFAULTS,
    parsed as Record<string, unknown>,
  ) as RalphConfig;

  // Validate required fields
  if (!config.project?.name) {
    throw new ConfigError(
      ERROR_CODES.CONFIG_MISSING_FIELD,
      "config.project.name is required",
    );
  }
  if (!config.verify?.test) {
    throw new ConfigError(
      ERROR_CODES.CONFIG_MISSING_FIELD,
      "config.verify.test is required",
    );
  }
  if (config.task_defaults.max_retries < 0) {
    throw new ConfigError(
      ERROR_CODES.CONFIG_INVALID,
      "config.task_defaults.max_retries must be non-negative",
    );
  }
  if (typeof config.task_defaults.max_budget_usd !== "number" || config.task_defaults.max_budget_usd <= 0) {
    throw new ConfigError(
      ERROR_CODES.CONFIG_INVALID,
      "config.task_defaults.max_budget_usd must be a positive number",
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
function mergeDefaults(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const d = defaults[key];
    const o = overrides[key];
    if (
      typeof d === "object" && d !== null && !Array.isArray(d) &&
      typeof o === "object" && o !== null && !Array.isArray(o)
    ) {
      result[key] = { ...(d as object), ...(o as object) };
    } else if (o !== undefined) {
      result[key] = o;
    }
  }
  return result;
}
