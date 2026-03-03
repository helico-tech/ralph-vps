// Filesystem-backed task repository
// Task files live in <basePath>/<status>/<task-id>.md

import { join } from "path";
import { readdir, unlink, mkdir } from "fs/promises";
import type { Task, TaskStatus, TaskLocation } from "../core/types.js";
import type { TaskRepository } from "../ports/task-repository.js";
import { parseTaskFile, serializeTaskFile } from "../core/task-file.js";
import { TaskError, ERROR_CODES } from "../core/errors.js";

const STATUSES: TaskStatus[] = ["pending", "active", "review", "done", "failed"];

export class FsTaskRepository implements TaskRepository {
  constructor(private readonly basePath: string) {}

  async listAll(): Promise<Task[]> {
    const results = await Promise.all(STATUSES.map((s) => this.listByStatus(s)));
    return results.flat();
  }

  async findById(id: string): Promise<Task | null> {
    for (const status of STATUSES) {
      const path = this.pathFor(id, status);
      const file = Bun.file(path);
      if (await file.exists()) {
        const content = await file.text();
        return parseTaskFile(content);
      }
    }
    return null;
  }

  async transition(task: Task, from: TaskStatus, to: TaskStatus): Promise<void> {
    const sourcePath = this.pathFor(task.id, from);
    const destPath = this.pathFor(task.id, to);

    // Ensure destination directory exists
    await mkdir(join(this.basePath, to), { recursive: true });

    // Enforce correct status in the written file regardless of caller
    const content = serializeTaskFile({ ...task, status: to });
    await Bun.write(destPath, content);

    // Then delete source
    try {
      await unlink(sourcePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async create(task: Task): Promise<void> {
    const existing = await this.findById(task.id);
    if (existing) {
      throw new TaskError(ERROR_CODES.DUPLICATE_ID, `Task '${task.id}' already exists`);
    }
    const destDir = join(this.basePath, "pending");
    await mkdir(destDir, { recursive: true });
    const content = serializeTaskFile({ ...task, status: "pending" });
    await Bun.write(join(destDir, `${task.id}.md`), content);
  }

  async locateAll(): Promise<TaskLocation[]> {
    const all = await Promise.all(
      STATUSES.map(async (status) => {
        const tasks = await this.listByStatus(status);
        return tasks.map((task) => ({ task, directory: status }));
      })
    );
    return all.flat();
  }

  private pathFor(taskId: string, status: TaskStatus): string {
    return join(this.basePath, status, `${taskId}.md`);
  }

  private async listByStatus(status: TaskStatus): Promise<Task[]> {
    const dir = join(this.basePath, status);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const tasks: Task[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await Bun.file(join(dir, file)).text();
      tasks.push(parseTaskFile(content));
    }
    return tasks;
  }
}
