// Task repository port — reads and writes task files
// Implementations: src/adapters/fs-task-repository.ts

import type { Task, TaskStatus, TaskLocation } from "../core/types.js";

export interface TaskRepository {
  /** Return all tasks across every status directory. */
  listAll(): Promise<Task[]>;

  /** Find a single task by id. Returns null if not found. */
  findById(id: string): Promise<Task | null>;

  /**
   * Move a task from one status directory to another.
   * Writes updated content to the destination, then deletes the source.
   * Write order: destination first, then delete source (safe on crash).
   * The caller (orchestrator) handles git staging and commits.
   */
  transition(task: Task, from: TaskStatus, to: TaskStatus): Promise<void>;

  /** Return every task paired with its on-disk status directory. */
  locateAll(): Promise<TaskLocation[]>;
}
