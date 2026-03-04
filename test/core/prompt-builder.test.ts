import { describe, it, expect } from "bun:test";
import { buildPrompt, buildExecutionPlan } from "../../src/core/prompt-builder.js";
import type { Task, RalphConfig } from "../../src/core/types.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Fix the auth bug",
    status: "pending",
    type: "bugfix",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "Arjan",
    description: "The auth function crashes on null email.",
    max_retries: 2,
    retry_count: 0,
    acceptance_criteria: ["Tests pass", "No null crashes"],
    files: ["src/auth.ts", "test/auth.test.ts"],
    constraints: ["Do not modify User model"],
    ...overrides,
  };
}

const SIMPLE_TEMPLATE = `## Task: {{title}}

{{description}}

### Acceptance Criteria
{{#acceptance_criteria}}
- {{.}}
{{/acceptance_criteria}}

### Files
{{#files}}
- {{.}}
{{/files}}

### Constraints
{{#constraints}}
- {{.}}
{{/constraints}}`;

const VARIABLE_ONLY_TEMPLATE = `Task: {{title}} ({{id}})
Type: {{type}}
Author: {{author}}
Priority: {{priority}}
Criteria: {{acceptance_criteria}}
Files: {{files}}
Constraints: {{constraints}}`;

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    version: 1,
    project: { name: "test-project" },
    verify: { test: "bun test", build: "", lint: "" },
    task_defaults: {
      max_retries: 2,
      model: "opus",
      max_turns: 50,
      max_budget_usd: 5.0,
      timeout_seconds: 1800,
    },
    exit_criteria: { require_tests: true, require_build: false, require_lint: false },
    git: { main_branch: "main", branch_prefix: "ralph/" },
    execution: { permission_mode: "skip_all" },
    ...overrides,
  };
}

describe("buildPrompt", () => {
  it("interpolates all simple variables", () => {
    const task = makeTask();
    const result = buildPrompt(task, VARIABLE_ONLY_TEMPLATE);
    expect(result).toContain("Task: Fix the auth bug (task-001)");
    expect(result).toContain("Type: bugfix");
    expect(result).toContain("Author: Arjan");
    expect(result).toContain("Priority: 100");
  });

  it("interpolates array blocks", () => {
    const task = makeTask();
    const result = buildPrompt(task, SIMPLE_TEMPLATE);
    expect(result).toContain("- Tests pass");
    expect(result).toContain("- No null crashes");
    expect(result).toContain("- src/auth.ts");
    expect(result).toContain("- test/auth.test.ts");
    expect(result).toContain("- Do not modify User model");
  });

  it("injects fallback for missing acceptance_criteria", () => {
    const task = makeTask({ acceptance_criteria: undefined });
    const result = buildPrompt(task, SIMPLE_TEMPLATE);
    expect(result).toContain("The described change works correctly and all tests pass");
  });

  it("removes entire files section when no files", () => {
    const task = makeTask({ files: undefined });
    const result = buildPrompt(task, SIMPLE_TEMPLATE);
    expect(result).not.toContain("### Files");
    expect(result).not.toContain("{{files}}");
    expect(result).not.toContain("{{#files}}");
  });

  it("removes entire constraints section when no constraints", () => {
    const task = makeTask({ constraints: undefined });
    const result = buildPrompt(task, SIMPLE_TEMPLATE);
    expect(result).not.toContain("### Constraints");
    expect(result).not.toContain("{{constraints}}");
    expect(result).not.toContain("{{#constraints}}");
  });

  it("handles empty description", () => {
    const task = makeTask({ description: "" });
    const result = buildPrompt(task, "{{description}}");
    expect(result).toContain("No description provided.");
  });

  it("produces no template variable artifacts", () => {
    const task = makeTask();
    const result = buildPrompt(task, SIMPLE_TEMPLATE);
    expect(result).not.toContain("{{");
    expect(result).not.toContain("}}");
  });

  it("handles simple {{variable}} syntax for arrays", () => {
    const task = makeTask();
    const result = buildPrompt(task, VARIABLE_ONLY_TEMPLATE);
    expect(result).toContain("- Tests pass");
    expect(result).toContain("- src/auth.ts");
  });

  it("removes block without heading when no heading precedes it", () => {
    const template = "Before\n{{#files}}\n- {{.}}\n{{/files}}\nAfter";
    const task = makeTask({ files: undefined });
    const result = buildPrompt(task, template);
    expect(result).toContain("Before");
    expect(result).toContain("After");
    expect(result).not.toContain("{{");
  });
});

describe("buildExecutionPlan", () => {
  it("creates an execution plan with interpolated system prompt", () => {
    const task = makeTask();
    const config = makeConfig();
    const systemPrompt = "You are Ralph. Project: {{project_name}}. Test: {{test_command}}.";
    const plan = buildExecutionPlan(task, SIMPLE_TEMPLATE, config, systemPrompt);

    expect(plan.model).toBe("opus");
    expect(plan.max_turns).toBe(50);
    expect(plan.budget_usd).toBe(5.0);
    expect(plan.timeout_ms).toBe(1800000);
    expect(plan.system_prompt).toBe("You are Ralph. Project: test-project. Test: bun test.");
    expect(plan.permission_mode).toBe("skip_all");
    expect(plan.prompt).toContain("Fix the auth bug");
  });

  it("uses config values for execution parameters", () => {
    const config = makeConfig({
      task_defaults: {
        max_retries: 3,
        model: "sonnet",
        max_turns: 25,
        max_budget_usd: 2.0,
        timeout_seconds: 900,
      },
    });
    const plan = buildExecutionPlan(makeTask(), SIMPLE_TEMPLATE, config, "");

    expect(plan.model).toBe("sonnet");
    expect(plan.max_turns).toBe(25);
    expect(plan.budget_usd).toBe(2.0);
    expect(plan.timeout_ms).toBe(900000);
  });

  it("interpolates project name and test command into system prompt", () => {
    const config = makeConfig({
      project: { name: "my-app" },
      verify: { test: "npm test", build: "", lint: "" },
    });
    const systemPrompt = "Project: {{project_name}}\nTest: {{test_command}}";
    const plan = buildExecutionPlan(makeTask(), SIMPLE_TEMPLATE, config, systemPrompt);

    expect(plan.system_prompt).toBe("Project: my-app\nTest: npm test");
  });
});
