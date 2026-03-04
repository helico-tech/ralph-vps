// Crash recovery — moves orphaned active tasks back to pending or failed

import type { OrchestratorDeps } from "./loop.js";
import { transitionTask } from "../core/state-machine.js";

export async function recoverOrphanedTasks(deps: OrchestratorDeps): Promise<void> {
  const { repo, git, obs, config } = deps;

  const locations = await repo.locateAll();
  const orphans = locations.filter((loc) => loc.directory === "active");

  if (orphans.length === 0) return;

  const now = new Date().toISOString();
  const recovered: string[] = [];

  for (const { task } of orphans) {
    const branchName = `${config.git.branch_prefix}${task.id}`;
    const canRetry = task.retry_count < task.max_retries;
    const target = canRetry ? ("pending" as const) : ("failed" as const);

    const updated = transitionTask(task, target, now);
    await repo.transition(updated, "active", target);
    recovered.push(task.id);

    if (canRetry) {
      obs.emit({ type: "task.retried", task_id: task.id, timestamp: now, attempt: updated.retry_count });
    } else {
      obs.emit({ type: "task.failed", task_id: task.id, timestamp: now, reason: "crash recovery: retries exhausted" });
    }

    // Clean up stale branch — best effort
    try {
      const branches = await git.listBranches();
      if (branches.includes(branchName)) {
        await git.deleteBranch(branchName, { remote: true });
      }
    } catch {
      process.stderr.write(`[recovery] failed to delete branch ${branchName}\n`);
    }
  }

  // One atomic commit for all recovered tasks — stage only task files, not working tree debris
  await git.stageFiles([deps.tasksDir]);
  await git.commit(
    `ralph: crash recovery — ${recovered.length} task(s) returned to queue`,
  );
  const pushed = await git.push();
  if (!pushed) {
    process.stderr.write("[recovery] failed to push recovery commit\n");
  }
}
