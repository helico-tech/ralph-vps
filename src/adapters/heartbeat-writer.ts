// Heartbeat writer — maintains .ralph/heartbeat.json

import { join } from "path";
import type { Observability } from "../ports/observability.js";
import type { DomainEvent } from "../core/types.js";

interface HeartbeatData {
  state: string;
  active_task: string | null;
  pid: number;
  updated_at: string;
}

export class HeartbeatWriter implements Observability {
  private readonly heartbeatPath: string;
  private activeTask: string | null = null;
  private state = "idle";

  constructor(ralphDir: string) {
    this.heartbeatPath = join(ralphDir, "heartbeat.json");
  }

  emit(event: DomainEvent): void {
    switch (event.type) {
      case "task.claimed":
        this.state = "active";
        this.activeTask = event.task_id;
        break;
      case "task.completed":
      case "task.failed":
        this.state = "idle";
        this.activeTask = null;
        break;
      case "orchestrator.stopped":
        this.state = "stopped";
        this.activeTask = null;
        break;
    }

    const data: HeartbeatData = {
      state: this.state,
      active_task: this.activeTask,
      pid: process.pid,
      updated_at: new Date().toISOString(),
    };

    // Fire-and-forget
    void Bun.write(this.heartbeatPath, JSON.stringify(data, null, 2)).catch(() => {});
  }
}
