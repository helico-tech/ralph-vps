// Prompt builder — pure template interpolation, zero I/O

import type { Task, ExecutionPlan, RalphConfig } from "./types.js";

/**
 * Build a prompt string from a task and a template.
 * Template variables use {{variable}} syntax.
 */
export function buildPrompt(task: Task, template: string): string {
  let result = template;

  result = result.replace(/\{\{id\}\}/g, task.id);
  result = result.replace(/\{\{type\}\}/g, task.type);
  result = result.replace(/\{\{description\}\}/g, task.description || "No description provided.");
  result = result.replace(/\{\{priority\}\}/g, String(task.priority));

  result = result.replace(/\{\{parent_id\}\}/g, task.parent_id ?? "");

  return result.trim();
}

/**
 * Build a full execution plan from a task, template, config, and system prompt.
 */
export function buildExecutionPlan(
  task: Task,
  template: string,
  config: RalphConfig,
  systemPromptTemplate: string,
): ExecutionPlan {
  const system_prompt = systemPromptTemplate
    .replace(/\{\{project_name\}\}/g, config.project.name)
    .replace(/\{\{verify_command\}\}/g, config.verify);

  return {
    prompt: buildPrompt(task, template),
    model: config.task_defaults.model,
    max_turns: config.task_defaults.max_turns,
    timeout_ms: config.task_defaults.timeout_seconds * 1000,
    system_prompt,
    permission_mode: config.execution.permission_mode,
    working_directory: ".",
  };
}
