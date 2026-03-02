import type { IterationLog } from "../domain/log";

export interface LogStore {
  write(log: IterationLog): Promise<void>;
  readLatest(count?: number): Promise<IterationLog[]>;
  readByIteration(iteration: number): Promise<IterationLog | null>;
  listAll(): Promise<IterationLog[]>;
}
