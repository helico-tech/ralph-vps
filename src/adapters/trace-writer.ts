// Trace writer — per-task trace files + append-only index
// Both use JSONL (append-only) to avoid read-modify-write race conditions

import { join } from "path";
import { appendFile, mkdir } from "fs/promises";
import type { Observability } from "../ports/observability.js";
import type { DomainEvent } from "../core/types.js";

export class TraceWriter implements Observability {
  private readonly tracesDir: string;
  private readonly indexPath: string;
  private initialized = false;

  constructor(tracesDir: string) {
    this.tracesDir = tracesDir;
    this.indexPath = join(tracesDir, "index.jsonl");
  }

  emit(event: DomainEvent): void {
    // Fire-and-forget — never block the orchestrator
    void this.write(event).catch(() => {
      // Swallow errors — observability must not crash the loop
    });
  }

  private async write(event: DomainEvent): Promise<void> {
    if (!this.initialized) {
      await mkdir(this.tracesDir, { recursive: true });
      this.initialized = true;
    }

    const line = JSON.stringify(event) + "\n";

    // Append to global index
    await appendFile(this.indexPath, line);

    // Append to per-task trace file (JSONL — no read-modify-write)
    if ("task_id" in event) {
      const tracePath = join(this.tracesDir, `${event.task_id}.jsonl`);
      await appendFile(tracePath, line);
    }
  }
}
