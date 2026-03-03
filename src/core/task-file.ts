// Task file parser/serializer — pure functions, operates on strings only

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Task, TaskStatus, TaskType } from "./types.js";
import { TaskError, ERROR_CODES } from "./errors.js";

const VALID_STATUSES: TaskStatus[] = ["pending", "active", "review", "done", "failed"];
const VALID_TYPES: TaskType[] = ["bugfix", "feature", "refactor", "research", "test", "chore"];

const FRONTMATTER_DELIMITER = "---";

interface RawFrontmatter {
  [key: string]: unknown;
}

/**
 * Parse a task file (YAML frontmatter + Markdown body) into a Task object.
 * Throws TaskError for missing required fields or malformed content.
 */
export function parseTaskFile(content: string): Task {
  const { frontmatter, body } = splitFrontmatter(content);

  let parsed: RawFrontmatter;
  try {
    parsed = parseYaml(frontmatter) as RawFrontmatter;
  } catch (e) {
    throw new TaskError(
      ERROR_CODES.PARSE_ERROR,
      `Failed to parse YAML frontmatter: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new TaskError(ERROR_CODES.PARSE_ERROR, "Frontmatter must be a YAML mapping");
  }

  // Required field
  if (!parsed.title || typeof parsed.title !== "string") {
    throw new TaskError(ERROR_CODES.MISSING_FIELD, "Task file must have a 'title' field");
  }

  // Validate status if present
  const status = (parsed.status as string) ?? "pending";
  if (!VALID_STATUSES.includes(status as TaskStatus)) {
    throw new TaskError(
      ERROR_CODES.INVALID_TYPE,
      `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(", ")}`
    );
  }

  // Validate type if present — unknown types fall back to "feature"
  let type = (parsed.type as string) ?? "feature";
  if (!VALID_TYPES.includes(type as TaskType)) {
    type = "feature";
  }

  // Extract known fields, preserve unknown ones
  const {
    id,
    title,
    status: _status,
    type: _type,
    priority,
    created_at,
    author,
    acceptance_criteria,
    files,
    constraints,
    max_retries,
    retry_count,
    claimed_at,
    cost_usd,
    turns,
    duration_s,
    attempt,
    branch,
    completed_at,
    ...extra
  } = parsed;

  const task: Task = {
    id: asString(id, ""),
    title: asString(title, ""),
    status: status as TaskStatus,
    type: type as TaskType,
    priority: asNumber(priority, 100),
    created_at: asString(created_at, ""),
    author: asString(author, ""),
    description: body.trim(),
    max_retries: asNumber(max_retries, 2),
    retry_count: asNumber(retry_count, 0),
    ...extra,
  };

  // Optional fields — only set if present
  if (acceptance_criteria !== undefined) {
    task.acceptance_criteria = asStringArray(acceptance_criteria);
  }
  if (files !== undefined) {
    task.files = asStringArray(files);
  }
  if (constraints !== undefined) {
    task.constraints = asStringArray(constraints);
  }
  if (claimed_at !== undefined) task.claimed_at = asString(claimed_at, "");
  if (cost_usd !== undefined) task.cost_usd = asNumber(cost_usd, 0);
  if (turns !== undefined) task.turns = asNumber(turns, 0);
  if (duration_s !== undefined) task.duration_s = asNumber(duration_s, 0);
  if (attempt !== undefined) task.attempt = asNumber(attempt, 0);
  if (branch !== undefined) task.branch = asString(branch, "");
  if (completed_at !== undefined) task.completed_at = asString(completed_at, "");

  return task;
}

/**
 * Serialize a Task object back to a task file (YAML frontmatter + Markdown body).
 */
export function serializeTaskFile(task: Task): string {
  const { description, ...frontmatterFields } = task;

  // Build frontmatter object, omitting undefined values
  const fm: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatterFields)) {
    if (value !== undefined) {
      fm[key] = value;
    }
  }

  const yamlStr = stringifyYaml(fm, { lineWidth: 0 }).trimEnd();
  const body = description ? `\n${description}\n` : "\n";

  return `${FRONTMATTER_DELIMITER}\n${yamlStr}\n${FRONTMATTER_DELIMITER}\n${body}`;
}

// --- Internal helpers ---

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const trimmed = content.trim();

  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    throw new TaskError(
      ERROR_CODES.PARSE_ERROR,
      "Task file must start with '---' frontmatter delimiter"
    );
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIMITER.length);
  const closingIndex = afterFirst.indexOf(`\n${FRONTMATTER_DELIMITER}`);

  if (closingIndex === -1) {
    throw new TaskError(
      ERROR_CODES.PARSE_ERROR,
      "Task file missing closing '---' frontmatter delimiter"
    );
  }

  const frontmatter = afterFirst.slice(0, closingIndex);
  const body = afterFirst.slice(closingIndex + FRONTMATTER_DELIMITER.length + 1);

  return { frontmatter, body };
}

function asString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}
