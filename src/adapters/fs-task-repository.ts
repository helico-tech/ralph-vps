import { join } from "node:path";
import { readdir, mkdir, unlink } from "node:fs/promises";
import type { Task } from "../domain/task";
import { parseTask, serializeTask } from "../domain/task-serialization";
import type { TaskRepository } from "../ports/task-repository";
import { TASKS_DIR, TASK_FILE_EXTENSION } from "../constants";
import { slugify } from "../domain/task";

export class FsTaskRepository implements TaskRepository {
  constructor(private readonly projectRoot: string) {}

  private get tasksDir(): string {
    return join(this.projectRoot, TASKS_DIR);
  }

  private taskFilePath(task: Task): string {
    return join(this.tasksDir, `${slugify(task.title)}${TASK_FILE_EXTENSION}`);
  }

  async list(): Promise<Task[]> {
    await this.ensureDir();
    let files: string[];
    try {
      files = await readdir(this.tasksDir);
    } catch {
      return [];
    }

    const mdFiles = files.filter((f) => f.endsWith(TASK_FILE_EXTENSION));
    const tasks: Task[] = [];

    for (const file of mdFiles) {
      const filePath = join(this.tasksDir, file);
      const raw = await Bun.file(filePath).text();
      tasks.push(parseTask(raw, filePath));
    }

    return tasks;
  }

  async get(id: string): Promise<Task | null> {
    const tasks = await this.list();
    return tasks.find((t) => t.id === id) ?? null;
  }

  async save(task: Task): Promise<void> {
    await this.ensureDir();
    const content = serializeTask(task);
    await Bun.write(task.filePath, content);
  }

  async create(task: Task): Promise<void> {
    await this.ensureDir();
    const filePath = task.filePath || this.taskFilePath(task);
    const taskWithPath = { ...task, filePath };
    const content = serializeTask(taskWithPath);
    await Bun.write(filePath, content);
  }

  async delete(id: string): Promise<void> {
    const task = await this.get(id);
    if (task) {
      await unlink(task.filePath);
    }
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.tasksDir, { recursive: true });
  }
}
