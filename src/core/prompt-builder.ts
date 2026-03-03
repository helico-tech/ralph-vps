// Prompt builder — pure template interpolation, zero I/O

import type { Task, ExecutionPlan, RalphConfig } from "./types.js";

const DEFAULT_ACCEPTANCE = "The described change works correctly and all tests pass.";

/**
 * Build a prompt string from a task and a template.
 * Template variables use {{variable}} syntax.
 * Array variables use {{#variable}} ... {{/variable}} block syntax.
 */
export function buildPrompt(task: Task, template: string): string {
  let result = template;

  // Simple variable interpolation
  result = result.replace(/\{\{id\}\}/g, task.id);
  result = result.replace(/\{\{title\}\}/g, task.title);
  result = result.replace(/\{\{type\}\}/g, task.type);
  result = result.replace(/\{\{description\}\}/g, task.description || "No description provided.");
  result = result.replace(/\{\{priority\}\}/g, String(task.priority));
  result = result.replace(/\{\{author\}\}/g, task.author);

  // Acceptance criteria
  const criteria = task.acceptance_criteria?.length
    ? task.acceptance_criteria
    : [DEFAULT_ACCEPTANCE];
  result = interpolateArray(result, "acceptance_criteria", criteria);

  // Files
  if (task.files?.length) {
    result = interpolateArray(result, "files", task.files);
  } else {
    result = removeBlock(result, "files", "No specific files targeted.");
  }

  // Constraints
  if (task.constraints?.length) {
    result = interpolateArray(result, "constraints", task.constraints);
  } else {
    result = removeBlock(result, "constraints", "");
  }

  return result.trim();
}

/**
 * Build a full execution plan from a task, template, and config.
 * Wraps buildPrompt and adds execution parameters.
 */
export function buildExecutionPlan(
  task: Task,
  template: string,
  config: RalphConfig,
): ExecutionPlan {
  return {
    prompt: buildPrompt(task, template),
    model: config.task_defaults.model,
    max_turns: config.task_defaults.max_turns,
    budget_usd: config.task_defaults.max_budget_usd,
    timeout_ms: config.task_defaults.timeout_seconds * 1000,
    system_prompt_file: ".ralph/ralph-system.md",
    permission_mode: config.execution.permission_mode,
    working_directory: ".",
  };
}

// --- Internal helpers ---

/**
 * Replace a {{#name}}...{{/name}} block with an array of items,
 * each line prefixed with "- ".
 */
function interpolateArray(template: string, name: string, items: string[]): string {
  const blockRegex = new RegExp(
    `\\{\\{#${name}\\}\\}([\\s\\S]*?)\\{\\{/${name}\\}\\}`,
    "g"
  );

  const replaced = template.replace(blockRegex, (_match, inner: string) => {
    return items
      .map((item) => inner.replace(/\{\{\.\}\}/g, item).trim())
      .join("\n");
  });

  // If block syntax was found and replaced, we're done
  if (replaced !== template) {
    return replaced;
  }

  // Otherwise replace the simple {{name}} variable
  const simpleRegex = new RegExp(`\\{\\{${name}\\}\\}`, "g");
  return template.replace(simpleRegex, items.map((item) => `- ${item}`).join("\n"));
}

/**
 * Remove a {{#name}}...{{/name}} block or replace {{name}} with a fallback.
 */
function removeBlock(template: string, name: string, fallback: string): string {
  const blockRegex = new RegExp(
    `\\{\\{#${name}\\}\\}[\\s\\S]*?\\{\\{/${name}\\}\\}`,
    "g"
  );

  const replaced = template.replace(blockRegex, fallback);

  if (replaced !== template) {
    return replaced;
  }

  const simpleRegex = new RegExp(`\\{\\{${name}\\}\\}`, "g");
  return template.replace(simpleRegex, fallback);
}
