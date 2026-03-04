// Task file parser/serializer — pure functions, operates on strings only

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { Task, TaskType } from "./types.js";
import { TaskError, ERROR_CODES } from "./errors.js";

const VALID_TYPES: TaskType[] = ["feature", "bugfix", "review", "fix"];

const FRONTMATTER_DELIMITER = "---";

/**
 * Parse a task file (YAML frontmatter + Markdown body) into a Task object.
 * Status is NOT read from frontmatter — it is set by the caller based on
 * which directory the file was found in.
 */
export function parseTaskFile(content: string): Task {
  const { frontmatter, body } = splitFrontmatter(content);

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(frontmatter) as Record<string, unknown>;
  } catch (e) {
    throw new TaskError(
      ERROR_CODES.PARSE_ERROR,
      `Failed to parse YAML frontmatter: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object") {
    throw new TaskError(ERROR_CODES.PARSE_ERROR, "Frontmatter must be a YAML mapping");
  }

  if (!parsed.id || typeof parsed.id !== "string") {
    throw new TaskError(ERROR_CODES.MISSING_FIELD, "Task file must have an 'id' field");
  }

  // Validate type — unknown types fall back to "feature"
  let type = (parsed.type as string) ?? "feature";
  if (!VALID_TYPES.includes(type as TaskType)) {
    type = "feature";
  }

  // Extract known fields, preserve unknown ones
  const { id, type: _type, priority, parent_id, commit_hash, status: _status, ...extra } = parsed;

  // Validate parent_id is present for review/fix tasks
  if ((type === "review" || type === "fix") && !parent_id) {
    throw new TaskError(
      ERROR_CODES.MISSING_FIELD,
      `Task type '${type}' requires a 'parent_id' field`,
    );
  }

  const task: Task = {
    ...extra,
    id: String(id),
    type: type as TaskType,
    priority: asNumber(priority, 100),
    status: "pending", // placeholder — caller overrides with directory-based status
    description: body.trim(),
  };

  if (parent_id !== undefined) task.parent_id = String(parent_id);
  if (commit_hash !== undefined) task.commit_hash = String(commit_hash);

  return task;
}

/**
 * Serialize a Task object back to a task file (YAML frontmatter + Markdown body).
 * Status is NOT written to frontmatter — the directory is the source of truth.
 */
export function serializeTaskFile(task: Task): string {
  const { description, status: _status, ...frontmatterFields } = task;

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
      "Task file must start with '---' frontmatter delimiter",
    );
  }

  const afterFirst = trimmed.slice(FRONTMATTER_DELIMITER.length);
  const closingIndex = afterFirst.indexOf(`\n${FRONTMATTER_DELIMITER}`);

  if (closingIndex === -1) {
    throw new TaskError(
      ERROR_CODES.PARSE_ERROR,
      "Task file missing closing '---' frontmatter delimiter",
    );
  }

  const frontmatter = afterFirst.slice(0, closingIndex);
  const body = afterFirst.slice(closingIndex + FRONTMATTER_DELIMITER.length + 1);

  return { frontmatter, body };
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}
