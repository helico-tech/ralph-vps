import { describe, expect, test } from "bun:test";
import {
  type Task,
  TaskFrontmatter,
  areDependenciesMet,
  generateTaskId,
  isValidTransition,
  slugify,
  transitionTask,
} from "../task";

describe("slugify", () => {
  test("converts title to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("strips special characters", () => {
    expect(slugify("Fix bug #123: crash on startup!")).toBe(
      "fix-bug-123-crash-on-startup"
    );
  });

  test("trims leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  test("collapses multiple hyphens", () => {
    expect(slugify("a   b   c")).toBe("a-b-c");
  });

  test("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });

  test("handles empty string", () => {
    expect(slugify("")).toBe("");
  });
});

describe("generateTaskId", () => {
  test("produces timestamp-slug format", () => {
    const now = new Date("2026-03-02T14:30:45.000Z");
    const id = generateTaskId("Add user auth", now);
    expect(id).toBe("20260302143045-add-user-auth");
  });

  test("uses current time when no date provided", () => {
    const id = generateTaskId("Test task");
    expect(id).toMatch(/^\d{14}-test-task$/);
  });
});

describe("isValidTransition", () => {
  test("pending → in_progress is valid", () => {
    expect(isValidTransition("pending", "in_progress")).toBe(true);
  });

  test("pending → cancelled is valid", () => {
    expect(isValidTransition("pending", "cancelled")).toBe(true);
  });

  test("pending → completed is invalid", () => {
    expect(isValidTransition("pending", "completed")).toBe(false);
  });

  test("in_progress → completed is valid", () => {
    expect(isValidTransition("in_progress", "completed")).toBe(true);
  });

  test("in_progress → pending is valid (un-start)", () => {
    expect(isValidTransition("in_progress", "pending")).toBe(true);
  });

  test("completed → anything is invalid", () => {
    expect(isValidTransition("completed", "pending")).toBe(false);
    expect(isValidTransition("completed", "in_progress")).toBe(false);
  });

  test("cancelled → pending is valid (reopen)", () => {
    expect(isValidTransition("cancelled", "pending")).toBe(true);
  });
});

describe("transitionTask", () => {
  const baseTask: Task = {
    id: "20260302-test",
    title: "Test",
    status: "pending",
    type: "feature-dev",
    priority: 2,
    order: 0,
    depends_on: [],
    created: "2026-03-02T00:00:00.000Z",
    body: "",
    filePath: "test.md",
  };

  test("transitions valid state", () => {
    const updated = transitionTask(baseTask, "in_progress");
    expect(updated.status).toBe("in_progress");
    expect(updated.title).toBe("Test"); // preserves other fields
  });

  test("throws on invalid transition", () => {
    expect(() => transitionTask(baseTask, "completed")).toThrow(
      "Invalid transition"
    );
  });

  test("returns new object (immutable)", () => {
    const updated = transitionTask(baseTask, "in_progress");
    expect(updated).not.toBe(baseTask);
    expect(baseTask.status).toBe("pending");
  });
});

describe("areDependenciesMet", () => {
  const makeTask = (overrides: Partial<Task>): Task => ({
    id: "test",
    title: "Test",
    status: "pending",
    type: "feature-dev",
    priority: 2,
    order: 0,
    depends_on: [],
    created: "2026-03-02T00:00:00.000Z",
    body: "",
    filePath: "test.md",
    ...overrides,
  });

  test("returns true when no dependencies", () => {
    const task = makeTask({});
    expect(areDependenciesMet(task, [])).toBe(true);
  });

  test("returns true when all deps completed", () => {
    const dep = makeTask({ id: "dep-1", status: "completed" });
    const task = makeTask({ depends_on: ["dep-1"] });
    expect(areDependenciesMet(task, [dep, task])).toBe(true);
  });

  test("returns false when dep is pending", () => {
    const dep = makeTask({ id: "dep-1", status: "pending" });
    const task = makeTask({ depends_on: ["dep-1"] });
    expect(areDependenciesMet(task, [dep, task])).toBe(false);
  });

  test("returns false when dep is in_progress", () => {
    const dep = makeTask({ id: "dep-1", status: "in_progress" });
    const task = makeTask({ depends_on: ["dep-1"] });
    expect(areDependenciesMet(task, [dep, task])).toBe(false);
  });

  test("returns false when dep doesn't exist", () => {
    const task = makeTask({ depends_on: ["nonexistent"] });
    expect(areDependenciesMet(task, [task])).toBe(false);
  });
});

describe("TaskFrontmatter schema", () => {
  test("validates complete frontmatter", () => {
    const result = TaskFrontmatter.safeParse({
      id: "20260302-test",
      title: "Test task",
      status: "pending",
      type: "feature-dev",
      priority: 2,
      order: 0,
      depends_on: [],
      created: "2026-03-02T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  test("applies defaults", () => {
    const result = TaskFrontmatter.parse({
      id: "20260302-test",
      title: "Test",
      created: "2026-03-02T00:00:00.000Z",
    });
    expect(result.status).toBe("pending");
    expect(result.type).toBe("feature-dev");
    expect(result.priority).toBe(2);
    expect(result.order).toBe(0);
    expect(result.depends_on).toEqual([]);
  });

  test("rejects invalid priority", () => {
    const result = TaskFrontmatter.safeParse({
      id: "test",
      title: "Test",
      created: "2026-03-02T00:00:00.000Z",
      priority: 5,
    });
    expect(result.success).toBe(false);
  });

  test("rejects missing required fields", () => {
    const result = TaskFrontmatter.safeParse({ title: "Test" });
    expect(result.success).toBe(false);
  });
});
