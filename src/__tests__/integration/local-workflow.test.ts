import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTempDir, cleanupTempDir } from "../helpers";
import { FsTaskRepository } from "../../adapters/fs-task-repository";
import { PriorityTaskSelector } from "../../adapters/priority-task-selector";
import { FsTypeResolver } from "../../adapters/fs-type-resolver";
import { JsonLogStore } from "../../adapters/json-log-store";
import { generateTaskId, slugify, transitionTask } from "../../domain/task";
import { aggregateStats } from "../../domain/log";
import type { Task } from "../../domain/task";
import { TASKS_DIR, RALPH_DIR } from "../../constants";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await createTempDir();
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

// Simulate `ralph init project`
async function initProject(dir: string, name: string) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(dir, ".ralph/tasks"), { recursive: true });
  await mkdir(join(dir, ".ralph/types"), { recursive: true });
  await mkdir(join(dir, ".ralph-local/logs"), { recursive: true });
  await Bun.write(
    join(dir, ".ralph/project.json"),
    JSON.stringify({ name, defaultType: "feature-dev", reviewAfterCompletion: true })
  );
}

describe("Local workflow E2E", () => {
  test("full flow: init → add tasks → list → next → complete → next picks correctly → log stats", async () => {
    // 1. Init project
    await initProject(tmpDir, "test-project");

    // 2. Verify type resolver works
    const typeResolver = new FsTypeResolver(tmpDir);
    const types = await typeResolver.listTypes();
    expect(types).toContain("feature-dev");
    expect(types).toContain("bug-fix");

    // 3. Add tasks
    const repo = new FsTaskRepository(tmpDir);

    const now1 = new Date("2026-03-02T10:00:00.000Z");
    const task1: Task = {
      id: generateTaskId("Setup database", now1),
      title: "Setup database",
      status: "pending",
      type: "feature-dev",
      priority: 1,
      order: 1,
      depends_on: [],
      created: now1.toISOString(),
      body: "Create the database schema.",
      filePath: join(tmpDir, TASKS_DIR, `${slugify("Setup database")}.md`),
    };

    const now2 = new Date("2026-03-02T10:00:01.000Z");
    const task2: Task = {
      id: generateTaskId("Add user model", now2),
      title: "Add user model",
      status: "pending",
      type: "feature-dev",
      priority: 1,
      order: 2,
      depends_on: [task1.id],
      created: now2.toISOString(),
      body: "Add user model on top of database.",
      filePath: join(tmpDir, TASKS_DIR, `${slugify("Add user model")}.md`),
    };

    await repo.create(task1);
    await repo.create(task2);

    // 4. List
    const all = await repo.list();
    expect(all).toHaveLength(2);

    // 5. Next should select task1 (task2 depends on it)
    const selector = new PriorityTaskSelector();
    const next = selector.selectNext(all);
    expect(next?.id).toBe(task1.id);

    // 6. Complete task1
    const started = transitionTask(next!, "in_progress");
    const completed = transitionTask(started, "completed");
    await repo.save(completed);

    // 7. Next should now pick task2
    const updated = await repo.list();
    const next2 = selector.selectNext(updated);
    expect(next2?.id).toBe(task2.id);

    // 8. Log stats should be empty (no iterations run)
    const logStore = new JsonLogStore(tmpDir);
    const stats = aggregateStats(await logStore.listAll());
    expect(stats.totalIterations).toBe(0);
  });
});
