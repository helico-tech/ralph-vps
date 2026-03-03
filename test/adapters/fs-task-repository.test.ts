import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FsTaskRepository } from "../../src/adapters/fs-task-repository.js";
import { serializeTaskFile } from "../../src/core/task-file.js";
import type { Task, TaskStatus } from "../../src/core/types.js";

const STATUSES: TaskStatus[] = ["pending", "active", "review", "done", "failed"];

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-001",
    title: "Test task",
    status: "pending",
    type: "feature",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "Arjan",
    description: "A test task.",
    max_retries: 2,
    retry_count: 0,
    ...overrides,
  };
}

let basePath: string;
let repo: FsTaskRepository;

beforeEach(async () => {
  basePath = await mkdtemp(join(tmpdir(), "ralph-test-"));
  for (const s of STATUSES) {
    await mkdir(join(basePath, s), { recursive: true });
  }
  repo = new FsTaskRepository(basePath);
});

afterEach(async () => {
  await rm(basePath, { recursive: true, force: true });
});

async function writeTask(task: Task, status: TaskStatus): Promise<void> {
  const content = serializeTaskFile(task);
  await Bun.write(join(basePath, status, `${task.id}.md`), content);
}

describe("FsTaskRepository — listAll", () => {
  it("returns empty array when all directories are empty", async () => {
    const tasks = await repo.listAll();
    expect(tasks).toHaveLength(0);
  });

  it("returns tasks from all status directories", async () => {
    await writeTask(makeTask({ id: "t1", status: "pending" }), "pending");
    await writeTask(makeTask({ id: "t2", status: "active" }), "active");
    await writeTask(makeTask({ id: "t3", status: "done" }), "done");

    const tasks = await repo.listAll();
    expect(tasks).toHaveLength(3);
    const ids = tasks.map((t) => t.id).sort();
    expect(ids).toEqual(["t1", "t2", "t3"]);
  });

  it("ignores non-md files", async () => {
    await writeTask(makeTask({ id: "t1", status: "pending" }), "pending");
    await Bun.write(join(basePath, "pending", ".DS_Store"), "junk");

    const tasks = await repo.listAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
  });
});

describe("FsTaskRepository — findById", () => {
  it("finds a task by id across status directories", async () => {
    await writeTask(makeTask({ id: "t1", status: "review" }), "review");

    const task = await repo.findById("t1");
    expect(task).not.toBeNull();
    expect(task!.id).toBe("t1");
  });

  it("returns null for nonexistent task", async () => {
    const task = await repo.findById("does-not-exist");
    expect(task).toBeNull();
  });
});

describe("FsTaskRepository — transition", () => {
  it("moves task file from one status to another", async () => {
    const task = makeTask({ id: "t1", status: "pending" });
    await writeTask(task, "pending");

    const updated = { ...task, status: "active" as TaskStatus, claimed_at: "2026-03-03T14:00:00Z" };
    await repo.transition(updated, "pending", "active");

    // Source should be gone
    const sourceExists = await Bun.file(join(basePath, "pending", "t1.md")).exists();
    expect(sourceExists).toBe(false);

    // Destination should exist with updated content
    const destExists = await Bun.file(join(basePath, "active", "t1.md")).exists();
    expect(destExists).toBe(true);

    // Verify content is the updated task
    const found = await repo.findById("t1");
    expect(found!.status).toBe("active");
  });

  it("creates destination directory if it does not exist", async () => {
    // Remove the "review" directory
    await rm(join(basePath, "review"), { recursive: true });

    // Task still has status "active" — transition() must enforce to="review"
    const task = makeTask({ id: "t1", status: "active" });
    await writeTask(task, "active");

    await repo.transition(task, "active", "review");
    const found = await repo.findById("t1");
    expect(found).not.toBeNull();
    expect(found!.status).toBe("review");
  });

  it("enforces destination status in file regardless of task.status", async () => {
    // Caller passes task with old status — transition must still write correct status
    const task = makeTask({ id: "t1", status: "pending" });
    await writeTask(task, "pending");

    await repo.transition(task, "pending", "active");
    const found = await repo.findById("t1");
    expect(found!.status).toBe("active");
  });
});

describe("FsTaskRepository — locateAll", () => {
  it("returns tasks paired with their directory status", async () => {
    await writeTask(makeTask({ id: "t1", status: "pending" }), "pending");
    await writeTask(makeTask({ id: "t2", status: "active" }), "active");

    const locations = await repo.locateAll();
    expect(locations).toHaveLength(2);

    const t1Loc = locations.find((l) => l.task.id === "t1");
    expect(t1Loc!.directory).toBe("pending");

    const t2Loc = locations.find((l) => l.task.id === "t2");
    expect(t2Loc!.directory).toBe("active");
  });
});

describe("FsTaskRepository — roundtrip", () => {
  it("write then read preserves task data", async () => {
    const task = makeTask({
      id: "t1",
      title: "Roundtrip test",
      acceptance_criteria: ["Tests pass", "No crashes"],
      files: ["src/foo.ts"],
      constraints: ["Do not break things"],
    });
    await writeTask(task, "pending");

    const found = await repo.findById("t1");
    expect(found!.title).toBe("Roundtrip test");
    expect(found!.acceptance_criteria).toEqual(["Tests pass", "No crashes"]);
    expect(found!.files).toEqual(["src/foo.ts"]);
    expect(found!.constraints).toEqual(["Do not break things"]);
  });
});
