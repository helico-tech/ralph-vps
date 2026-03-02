import type { Task } from "../domain/task";

export interface TaskRepository {
  list(): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  save(task: Task): Promise<void>;
  create(task: Task): Promise<void>;
  delete(id: string): Promise<void>;
}
