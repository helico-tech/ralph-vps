import { describe, it, expect } from "bun:test";
import { parseTaskFile, serializeTaskFile } from "../../src/core/task-file.js";
import { TaskError } from "../../src/core/errors.js";

const FULL_TASK = `---
id: task-013
type: bugfix
priority: 50
---
## Description

The \`authenticate()\` function in \`src/auth.ts\` crashes with a TypeError
when \`user.email\` is null.
`;

const MINIMAL_TASK = `---
id: task-001
---
`;

describe("parseTaskFile", () => {
  it("parses a full task file with all fields", () => {
    const task = parseTaskFile(FULL_TASK);
    expect(task.id).toBe("task-013");
    expect(task.status).toBe("pending"); // placeholder
    expect(task.type).toBe("bugfix");
    expect(task.priority).toBe(50);
    expect(task.description).toContain("authenticate()");
    expect(task.description).toContain("TypeError");
  });

  it("parses a minimal task file with defaults", () => {
    const task = parseTaskFile(MINIMAL_TASK);
    expect(task.id).toBe("task-001");
    expect(task.status).toBe("pending");
    expect(task.type).toBe("feature");
    expect(task.priority).toBe(100);
    expect(task.description).toBe("");
  });

  it("throws on missing id", () => {
    expect(() => parseTaskFile("---\ntype: feature\n---\n")).toThrow(TaskError);
    expect(() => parseTaskFile("---\ntype: feature\n---\n")).toThrow("id");
  });

  it("throws on missing opening delimiter", () => {
    expect(() => parseTaskFile("id: task-001\n---\n")).toThrow(TaskError);
    expect(() => parseTaskFile("id: task-001\n---\n")).toThrow("must start with");
  });

  it("throws on missing closing delimiter", () => {
    expect(() => parseTaskFile("---\nid: task-001\n")).toThrow(TaskError);
    expect(() => parseTaskFile("---\nid: task-001\n")).toThrow("closing");
  });

  it("throws on malformed YAML", () => {
    expect(() => parseTaskFile("---\n: invalid: yaml: [[\n---\n")).toThrow(TaskError);
  });

  it("handles empty markdown body", () => {
    const task = parseTaskFile('---\nid: task-001\n---\n');
    expect(task.id).toBe("task-001");
    expect(task.description).toBe("");
  });

  it("parses commit_hash and parent_id", () => {
    const content = `---
id: task-002
type: review
parent_id: task-001
commit_hash: "abc123"
---
`;
    const task = parseTaskFile(content);
    expect(task.parent_id).toBe("task-001");
    expect(task.commit_hash).toBe("abc123");
  });

  it("requires parent_id for review type", () => {
    expect(() => parseTaskFile("---\nid: task-002\ntype: review\n---\n")).toThrow(TaskError);
    expect(() => parseTaskFile("---\nid: task-002\ntype: review\n---\n")).toThrow("parent_id");
  });

  it("requires parent_id for fix type", () => {
    expect(() => parseTaskFile("---\nid: task-002\ntype: fix\n---\n")).toThrow(TaskError);
    expect(() => parseTaskFile("---\nid: task-002\ntype: fix\n---\n")).toThrow("parent_id");
  });

  it("preserves unknown frontmatter fields (forward compatibility)", () => {
    const content = `---
id: task-001
custom_field: "hello"
nested:
  deep: true
---
`;
    const task = parseTaskFile(content);
    expect(task.id).toBe("task-001");
    expect(task.custom_field).toBe("hello");
    expect(task.nested).toEqual({ deep: true });
  });

  it("handles unicode in description", () => {
    const content = `---
id: task-001
---
Description with émojis 🎉 and ñ characters.
`;
    const task = parseTaskFile(content);
    expect(task.description).toContain("🎉");
    expect(task.description).toContain("ñ");
  });

  it("falls back to feature for unknown task type", () => {
    const task = parseTaskFile('---\nid: task-001\ntype: magic\n---\n');
    expect(task.type).toBe("feature");
  });

  it("handles priority as numeric type", () => {
    const task = parseTaskFile('---\nid: task-001\npriority: 50\n---\n');
    expect(task.priority).toBe(50);
    expect(typeof task.priority).toBe("number");
  });
});

describe("serializeTaskFile", () => {
  it("serializes a full task back to frontmatter + body", () => {
    const task = parseTaskFile(FULL_TASK);
    const serialized = serializeTaskFile(task);
    expect(serialized).toContain("---");
    expect(serialized).toContain("id:");
    expect(serialized).toContain("task-013");
    expect(serialized).toContain("authenticate()");
  });

  it("roundtrips: parse -> serialize -> parse preserves data", () => {
    const original = parseTaskFile(FULL_TASK);
    const serialized = serializeTaskFile(original);
    const reparsed = parseTaskFile(serialized);

    expect(reparsed.id).toBe(original.id);
    expect(reparsed.type).toBe(original.type);
    expect(reparsed.priority).toBe(original.priority);
  });

  it("serializes a minimal task", () => {
    const task = parseTaskFile(MINIMAL_TASK);
    const serialized = serializeTaskFile(task);
    expect(serialized).toContain("id:");
    expect(serialized).toContain("task-001");
  });

  it("does not include status in frontmatter", () => {
    const task = parseTaskFile(MINIMAL_TASK);
    const serialized = serializeTaskFile(task);
    expect(serialized).not.toContain("status:");
  });

  it("preserves unknown fields through roundtrip", () => {
    const content = `---
id: task-001
custom_field: "preserved"
---
`;
    const task = parseTaskFile(content);
    const serialized = serializeTaskFile(task);
    const reparsed = parseTaskFile(serialized);
    expect(reparsed.custom_field).toBe("preserved");
  });
});
