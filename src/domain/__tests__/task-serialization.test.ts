import { describe, expect, test } from "bun:test";
import { parseTask, serializeTask, parseFrontmatter } from "../task-serialization";
import { TaskValidationError } from "../../errors";

const VALID_TASK = `---
id: "20260302143045-add-user-auth"
title: "Add user auth"
status: pending
type: feature-dev
priority: 2
order: 0
depends_on: []
created: "2026-03-02T14:30:45.000Z"
---

## Description

Implement user authentication.

## Acceptance Criteria

- Users can log in
- Users can log out
`;

const MINIMAL_TASK = `---
id: "20260302-minimal"
title: "Minimal task"
created: "2026-03-02T00:00:00.000Z"
---

Just a body.
`;

const INVALID_TASK = `---
title: "Missing ID"
---

No id field.
`;

describe("parseFrontmatter", () => {
  test("extracts frontmatter as object", () => {
    const data = parseFrontmatter(VALID_TASK);
    expect(data.id).toBe("20260302143045-add-user-auth");
    expect(data.title).toBe("Add user auth");
  });
});

describe("parseTask", () => {
  test("parses valid task with all fields", () => {
    const task = parseTask(VALID_TASK, "tasks/test.md");
    expect(task.id).toBe("20260302143045-add-user-auth");
    expect(task.title).toBe("Add user auth");
    expect(task.status).toBe("pending");
    expect(task.type).toBe("feature-dev");
    expect(task.priority).toBe(2);
    expect(task.depends_on).toEqual([]);
    expect(task.filePath).toBe("tasks/test.md");
    expect(task.body).toContain("## Description");
    expect(task.body).toContain("Implement user authentication.");
  });

  test("parses minimal task with defaults", () => {
    const task = parseTask(MINIMAL_TASK, "tasks/minimal.md");
    expect(task.id).toBe("20260302-minimal");
    expect(task.status).toBe("pending");
    expect(task.type).toBe("feature-dev");
    expect(task.priority).toBe(2);
    expect(task.order).toBe(0);
    expect(task.depends_on).toEqual([]);
    expect(task.body).toBe("Just a body.");
  });

  test("throws TaskValidationError for invalid frontmatter", () => {
    expect(() => parseTask(INVALID_TASK, "tasks/bad.md")).toThrow(
      TaskValidationError
    );
  });
});

describe("serializeTask", () => {
  test("round-trips a parsed task", () => {
    const original = parseTask(VALID_TASK, "tasks/test.md");
    const serialized = serializeTask(original);
    const reparsed = parseTask(serialized, "tasks/test.md");

    expect(reparsed.id).toBe(original.id);
    expect(reparsed.title).toBe(original.title);
    expect(reparsed.status).toBe(original.status);
    expect(reparsed.type).toBe(original.type);
    expect(reparsed.priority).toBe(original.priority);
    expect(reparsed.body).toContain("Implement user authentication.");
  });

  test("preserves body content", () => {
    const task = parseTask(VALID_TASK, "tasks/test.md");
    const serialized = serializeTask(task);
    expect(serialized).toContain("## Description");
    expect(serialized).toContain("## Acceptance Criteria");
  });

  test("omits undefined optional fields", () => {
    const task = parseTask(MINIMAL_TASK, "tasks/min.md");
    const serialized = serializeTask(task);
    expect(serialized).not.toContain("parent");
    expect(serialized).not.toContain("reviews");
  });
});
