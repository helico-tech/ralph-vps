import { describe, it, expect } from "bun:test";
import { buildPrompt, buildExecutionPlan } from "../../src/core/prompt-builder.js";
import type { Task, RalphConfig } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    status: "pending",
    type: "bugfix",
    priority: 100,
    description: "The auth function crashes on null email.",
    ...overrides,
  };
}

const SIMPLE_TEMPLATE = `## Task: {{id}}

{{description}}

Type: {{type}}
Priority: {{priority}}`;

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    version: 1,
    project: { name: "test-project" },
    verify: "bun test",
    task_defaults: {
      model: "opus",
      max_turns: 50,
      timeout_seconds: 1800,
    },
    git: { main_branch: "main", branch_prefix: "ralph/" },
    execution: { permission_mode: "skip_all" },
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("interpolates all simple variables", () => {
    const task = makeTask();
    const template = "Task: {{id}} Type: {{type}} Priority: {{priority}}";
    const result = buildPrompt(task, template);
    expect(result).toContain("Task: task-001");
    expect(result).toContain("Type: bugfix");
    expect(result).toContain("Priority: 100");
  });

  it("interpolates description", () => {
    const task = makeTask();
    const result = buildPrompt(task, "{{description}}");
    expect(result).toContain("auth function crashes");
  });

  it("handles empty description", () => {
    const task = makeTask({ description: "" });
    const result = buildPrompt(task, "{{description}}");
    expect(result).toContain("No description provided.");
  });

  it("interpolates parent_id when present", () => {
    const task = makeTask({ parent_id: "task-000" });
    const result = buildPrompt(task, "Parent: {{parent_id}}");
    expect(result).toContain("Parent: task-000");
  });

  it("produces no template variable artifacts for known fields", () => {
    const task = makeTask();
    const result = buildPrompt(task, SIMPLE_TEMPLATE);
    expect(result).not.toContain("{{id}}");
    expect(result).not.toContain("{{type}}");
    expect(result).not.toContain("{{description}}");
    expect(result).not.toContain("{{priority}}");
  });
});

describe("buildExecutionPlan", () => {
  it("creates an execution plan with interpolated system prompt", () => {
    const task = makeTask();
    const config = makeConfig();
    const systemPrompt = "You are Ralph. Project: {{project_name}}. Verify: {{verify_command}}.";
    const plan = buildExecutionPlan(task, SIMPLE_TEMPLATE, config, systemPrompt);

    expect(plan.model).toBe("opus");
    expect(plan.max_turns).toBe(50);
    expect(plan.timeout_ms).toBe(1800000);
    expect(plan.system_prompt).toBe("You are Ralph. Project: test-project. Verify: bun test.");
    expect(plan.permission_mode).toBe("skip_all");
    expect(plan.prompt).toContain("task-001");
  });

  it("uses config values for execution parameters", () => {
    const config = makeConfig({
      task_defaults: {
        model: "sonnet",
        max_turns: 25,
        timeout_seconds: 900,
      },
    });
    const plan = buildExecutionPlan(makeTask(), SIMPLE_TEMPLATE, config, "");

    expect(plan.model).toBe("sonnet");
    expect(plan.max_turns).toBe(25);
    expect(plan.timeout_ms).toBe(900000);
  });

  it("interpolates project name and verify command into system prompt", () => {
    const config = makeConfig({
      project: { name: "my-app" },
      verify: "npm test",
    });
    const systemPrompt = "Project: {{project_name}}\nVerify: {{verify_command}}";
    const plan = buildExecutionPlan(makeTask(), SIMPLE_TEMPLATE, config, systemPrompt);

    expect(plan.system_prompt).toBe("Project: my-app\nVerify: npm test");
  });
});
