import { describe, it, expect } from "bun:test";
import { parseTaskFile, serializeTaskFile } from "../../src/core/task-file.js";
import { TaskError } from "../../src/core/errors.js";

const FULL_TASK = `---
id: task-013
title: "Fix null check in authenticate()"
status: pending
type: bugfix
priority: 50
created_at: "2026-03-03T14:00:00Z"
author: "Arjan"
acceptance_criteria:
  - "authenticate() handles null email without crashing"
  - "All existing tests pass"
  - "New test covers the null email case"
files:
  - src/auth.ts
  - test/auth.test.ts
constraints:
  - "Do not modify the User model"
max_retries: 2
---
## Description

The \`authenticate()\` function in \`src/auth.ts\` crashes with a TypeError
when \`user.email\` is null.
`;

const MINIMAL_TASK = `---
title: "Fix the bug"
---
`;

describe("parseTaskFile", () => {
  it("parses a full task file with all fields", () => {
    const task = parseTaskFile(FULL_TASK);
    expect(task.id).toBe("task-013");
    expect(task.title).toBe("Fix null check in authenticate()");
    expect(task.status).toBe("pending");
    expect(task.type).toBe("bugfix");
    expect(task.priority).toBe(50);
    expect(task.created_at).toBe("2026-03-03T14:00:00Z");
    expect(task.author).toBe("Arjan");
    expect(task.acceptance_criteria).toEqual([
      "authenticate() handles null email without crashing",
      "All existing tests pass",
      "New test covers the null email case",
    ]);
    expect(task.files).toEqual(["src/auth.ts", "test/auth.test.ts"]);
    expect(task.constraints).toEqual(["Do not modify the User model"]);
    expect(task.max_retries).toBe(2);
    expect(task.description).toContain("authenticate()");
    expect(task.description).toContain("TypeError");
  });

  it("parses a minimal task file with defaults", () => {
    const task = parseTaskFile(MINIMAL_TASK);
    expect(task.title).toBe("Fix the bug");
    expect(task.status).toBe("pending");
    expect(task.type).toBe("feature");
    expect(task.priority).toBe(100);
    expect(task.max_retries).toBe(2);
    expect(task.retry_count).toBe(0);
    expect(task.id).toBe("");
    expect(task.author).toBe("");
    expect(task.description).toBe("");
  });

  it("throws on missing title", () => {
    expect(() => parseTaskFile("---\nid: task-001\n---\n")).toThrow(TaskError);
    expect(() => parseTaskFile("---\nid: task-001\n---\n")).toThrow("title");
  });

  it("throws on missing opening delimiter", () => {
    expect(() => parseTaskFile("title: Fix the bug\n---\n")).toThrow(TaskError);
    expect(() => parseTaskFile("title: Fix the bug\n---\n")).toThrow("must start with");
  });

  it("throws on missing closing delimiter", () => {
    expect(() => parseTaskFile("---\ntitle: Fix the bug\n")).toThrow(TaskError);
    expect(() => parseTaskFile("---\ntitle: Fix the bug\n")).toThrow("closing");
  });

  it("throws on malformed YAML", () => {
    expect(() => parseTaskFile("---\n: invalid: yaml: [[\n---\n")).toThrow(TaskError);
  });

  it("handles empty markdown body", () => {
    const task = parseTaskFile('---\ntitle: "Empty body"\n---\n');
    expect(task.title).toBe("Empty body");
    expect(task.description).toBe("");
  });

  it("parses completion fields", () => {
    const content = `---
title: "Done task"
cost_usd: 1.23
turns: 12
duration_s: 145
attempt: 1
branch: ralph/task-001
completed_at: "2026-03-03T15:00:00Z"
---
`;
    const task = parseTaskFile(content);
    expect(task.cost_usd).toBe(1.23);
    expect(task.turns).toBe(12);
    expect(task.duration_s).toBe(145);
    expect(task.attempt).toBe(1);
    expect(task.branch).toBe("ralph/task-001");
    expect(task.completed_at).toBe("2026-03-03T15:00:00Z");
  });

  it("preserves unknown frontmatter fields (forward compatibility)", () => {
    const content = `---
title: "Future task"
custom_field: "hello"
nested:
  deep: true
---
`;
    const task = parseTaskFile(content);
    expect(task.title).toBe("Future task");
    expect(task.custom_field).toBe("hello");
    expect(task.nested).toEqual({ deep: true });
  });

  it("handles unicode in title and description", () => {
    const content = `---
title: "Fix the 日本語 endpoint"
---
Description with émojis 🎉 and ñ characters.
`;
    const task = parseTaskFile(content);
    expect(task.title).toBe("Fix the 日本語 endpoint");
    expect(task.description).toContain("🎉");
    expect(task.description).toContain("ñ");
  });

  it("validates status field", () => {
    expect(() =>
      parseTaskFile('---\ntitle: "Bad status"\nstatus: unknown\n---\n')
    ).toThrow("Invalid status");
  });

  it("falls back to feature for unknown task type", () => {
    const task = parseTaskFile('---\ntitle: "Unknown type"\ntype: magic\n---\n');
    expect(task.type).toBe("feature");
  });

  it("accepts acceptance_criteria as single string", () => {
    const content = `---
title: "Single criterion"
acceptance_criteria: "Tests pass"
---
`;
    const task = parseTaskFile(content);
    expect(task.acceptance_criteria).toEqual(["Tests pass"]);
  });

  it("handles priority as numeric type", () => {
    const task = parseTaskFile('---\ntitle: "Priority test"\npriority: 50\n---\n');
    expect(task.priority).toBe(50);
    expect(typeof task.priority).toBe("number");
  });
});

describe("serializeTaskFile", () => {
  it("serializes a full task back to frontmatter + body", () => {
    const task = parseTaskFile(FULL_TASK);
    const serialized = serializeTaskFile(task);
    expect(serialized).toContain("---");
    expect(serialized).toContain("title:");
    expect(serialized).toContain("Fix null check in authenticate()");
    expect(serialized).toContain("authenticate()");
  });

  it("roundtrips: parse -> serialize -> parse preserves data", () => {
    const original = parseTaskFile(FULL_TASK);
    const serialized = serializeTaskFile(original);
    const reparsed = parseTaskFile(serialized);

    expect(reparsed.id).toBe(original.id);
    expect(reparsed.title).toBe(original.title);
    expect(reparsed.status).toBe(original.status);
    expect(reparsed.type).toBe(original.type);
    expect(reparsed.priority).toBe(original.priority);
    expect(reparsed.acceptance_criteria).toEqual(original.acceptance_criteria);
    expect(reparsed.files).toEqual(original.files);
    expect(reparsed.constraints).toEqual(original.constraints);
    expect(reparsed.max_retries).toBe(original.max_retries);
  });

  it("serializes a minimal task", () => {
    const task = parseTaskFile(MINIMAL_TASK);
    const serialized = serializeTaskFile(task);
    expect(serialized).toContain("title:");
    expect(serialized).toContain("Fix the bug");
  });

  it("omits undefined optional fields", () => {
    const task = parseTaskFile(MINIMAL_TASK);
    const serialized = serializeTaskFile(task);
    expect(serialized).not.toContain("acceptance_criteria");
    expect(serialized).not.toContain("files:");
    expect(serialized).not.toContain("constraints");
    expect(serialized).not.toContain("cost_usd");
  });

  it("preserves unknown fields through roundtrip", () => {
    const content = `---
title: "Future task"
custom_field: "preserved"
---
`;
    const task = parseTaskFile(content);
    const serialized = serializeTaskFile(task);
    const reparsed = parseTaskFile(serialized);
    expect(reparsed.custom_field).toBe("preserved");
  });
});
