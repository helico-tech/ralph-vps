import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { FsTaskRepository } from "../fs-task-repository";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";
import type { Task } from "../../domain/task";

let tmpDir: string;
let repo: FsTaskRepository;

beforeEach(async () => {
  tmpDir = await createTempDir();
  repo = new FsTaskRepository(tmpDir);
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

const makeTask = (overrides: Partial<Task> = {}): Task => {
  const title = overrides.title ?? "Test Task";
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return {
    id: "20260302100000-test-task",
    title,
    status: "pending",
    type: "feature-dev",
    priority: 2,
    order: 0,
    depends_on: [],
    created: "2026-03-02T10:00:00.000Z",
    body: "This is the task body.",
    filePath: join(tmpDir, `.ralph/tasks/${slug}.md`),
    ...overrides,
  };
};

describe("FsTaskRepository", () => {
  test("list returns empty when no tasks", async () => {
    const tasks = await repo.list();
    expect(tasks).toEqual([]);
  });

  test("create and get round-trip", async () => {
    const task = makeTask();
    await repo.create(task);

    const retrieved = await repo.get(task.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(task.id);
    expect(retrieved!.title).toBe(task.title);
    expect(retrieved!.body).toBe(task.body);
  });

  test("list returns all tasks", async () => {
    await repo.create(makeTask({ id: "id-1", title: "First" }));
    await repo.create(makeTask({ id: "id-2", title: "Second" }));

    const tasks = await repo.list();
    expect(tasks).toHaveLength(2);
  });

  test("save updates existing task", async () => {
    const task = makeTask();
    await repo.create(task);

    const updated = { ...task, status: "in_progress" as const };
    await repo.save(updated);

    const retrieved = await repo.get(task.id);
    expect(retrieved!.status).toBe("in_progress");
  });

  test("delete removes task", async () => {
    const task = makeTask();
    await repo.create(task);
    expect(await repo.get(task.id)).not.toBeNull();

    await repo.delete(task.id);
    expect(await repo.get(task.id)).toBeNull();
  });

  test("creates tasks directory if missing", async () => {
    const tasks = await repo.list();
    expect(tasks).toEqual([]);
    // Directory should now exist — creating a task should work
    await repo.create(makeTask());
    expect(await repo.list()).toHaveLength(1);
  });
});
