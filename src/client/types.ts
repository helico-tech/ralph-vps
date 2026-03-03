// Client types — shared across CLI commands

import type { TaskRepository } from "../ports/task-repository.js";
import type { SourceControl } from "../ports/source-control.js";
import type { RalphConfig, TaskStatus } from "../core/types.js";

export interface ClientDeps {
  repo: TaskRepository;
  git: SourceControl;
  config: RalphConfig;
  tasksDir: string; // relative to git root, e.g. ".ralph/tasks"
}

export interface StatusReport {
  counts: Record<TaskStatus, number>;
  total: number;
  active_task: { id: string; title: string; claimed_at: string } | null;
  last_commit: { sha: string; timestamp: string; message: string } | null;
}

export interface DoctorCheck {
  name: string;
  passed: boolean;
  message: string;
}
