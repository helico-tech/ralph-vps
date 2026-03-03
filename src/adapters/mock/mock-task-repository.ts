// Mock task repository — in-memory, no filesystem

import type { Task, TaskStatus, TaskLocation } from "../../core/types.js";
import type { TaskRepository } from "../../ports/task-repository.js";
import { TaskError, ERROR_CODES } from "../../core/errors.js";

export class MockTaskRepository implements TaskRepository {
  private readonly tasks = new Map<string, { task: Task; directory: TaskStatus }>();

  /** Seed the repository with a task in a specific directory. */
  seed(task: Task, directory?: TaskStatus): void {
    this.tasks.set(task.id, { task, directory: directory ?? task.status });
  }

  async listAll(): Promise<Task[]> {
    return [...this.tasks.values()].map((e) => ({ ...e.task }));
  }

  async findById(id: string): Promise<Task | null> {
    const entry = this.tasks.get(id);
    return entry ? { ...entry.task } : null;
  }

  async transition(task: Task, _from: TaskStatus, to: TaskStatus): Promise<void> {
    this.tasks.set(task.id, { task: { ...task, status: to }, directory: to });
  }

  async locateAll(): Promise<TaskLocation[]> {
    return [...this.tasks.values()].map((e) => ({
      task: { ...e.task },
      directory: e.directory,
    }));
  }

  async create(task: Task): Promise<void> {
    if (this.tasks.has(task.id)) {
      throw new TaskError(ERROR_CODES.DUPLICATE_ID, `Task '${task.id}' already exists`);
    }
    this.tasks.set(task.id, { task: { ...task, status: "pending" }, directory: "pending" });
  }
}
