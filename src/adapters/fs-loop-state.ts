import { join, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { LoopStatus } from "../domain/loop";
import { initialLoopStatus } from "../domain/loop";
import { STATE_FILE } from "../constants";

export class FsLoopState {
  constructor(private readonly projectRoot: string) {}

  private get statePath(): string {
    return join(this.projectRoot, STATE_FILE);
  }

  async read(): Promise<LoopStatus> {
    const file = Bun.file(this.statePath);
    if (!(await file.exists())) {
      return initialLoopStatus();
    }

    try {
      return await file.json();
    } catch {
      // Corrupted state file, start fresh
      return initialLoopStatus();
    }
  }

  async write(status: LoopStatus): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    await Bun.write(this.statePath, JSON.stringify(status, null, 2));
  }
}
