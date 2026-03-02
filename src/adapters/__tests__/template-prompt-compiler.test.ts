import { describe, expect, test } from "bun:test";
import { TemplatePromptCompiler } from "../template-prompt-compiler";
import type { Task } from "../../domain/task";
import type { CompileContext } from "../../ports/prompt-compiler";

const task: Task = {
  id: "20260302-test",
  title: "Add auth",
  status: "pending",
  type: "feature-dev",
  priority: 2,
  order: 0,
  depends_on: [],
  created: "2026-03-02T00:00:00.000Z",
  body: "Implement user authentication with JWT.",
  filePath: "test.md",
};

const context: CompileContext = {
  iteration: 3,
  projectName: "my-app",
};

describe("TemplatePromptCompiler", () => {
  const compiler = new TemplatePromptCompiler();

  test("compiles template with all placeholders", () => {
    const template = `# {{TASK_TITLE}}
Type: {{TASK_TYPE}}
Project: {{PROJECT_NAME}}
Iteration: {{ITERATION}}

{{TASK_BODY}}

Previous errors: {{PREVIOUS_ERRORS}}`;

    const result = compiler.compile(task, template, context);
    expect(result.prompt).toContain("# Add auth");
    expect(result.prompt).toContain("Type: feature-dev");
    expect(result.prompt).toContain("Project: my-app");
    expect(result.prompt).toContain("Iteration: 3");
    expect(result.prompt).toContain("Implement user authentication with JWT.");
    expect(result.prompt).toContain("Previous errors: None");
  });

  test("falls back to default template when empty", () => {
    const result = compiler.compile(task, "", context);
    expect(result.prompt).toContain("Implement user authentication with JWT.");
  });

  test("includes previous errors when provided", () => {
    const contextWithErrors: CompileContext = {
      ...context,
      previousErrors: ["Test failed: auth.test.ts", "Type error in user.ts"],
    };
    const template = "Errors: {{PREVIOUS_ERRORS}}";
    const result = compiler.compile(task, template, contextWithErrors);
    expect(result.prompt).toContain("Test failed: auth.test.ts");
    expect(result.prompt).toContain("Type error in user.ts");
  });

  test("returns correct flags", () => {
    const result = compiler.compile(task, "{{TASK_BODY}}", context);
    expect(result.flags).toContain("--verbose");
    expect(result.flags).toContain("--output-format");
    expect(result.flags).toContain("stream-json");
  });
});
