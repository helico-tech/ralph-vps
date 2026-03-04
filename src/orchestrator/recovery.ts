// Crash recovery — moves orphaned active tasks back to pending

import type { OrchestratorDeps } from "./loop.js";
import { resolveBranchName } from "../core/next-task.js";

export async function recoverOrphanedTasks(deps: OrchestratorDeps): Promise<void> {
  const { repo, git, obs, config } = deps;

  const locations = await repo.locateAll();
  const orphans = locations.filter((loc) => loc.directory === "active");

  if (orphans.length === 0) return;

  const now = new Date().toISOString();
  const recovered: string[] = [];

  for (const { task } of orphans) {
    const branchName = resolveBranchName(task, config.git.branch_prefix);

    // Recovery is an admin operation — bypass state machine
    const updated = { ...task, status: "pending" as const };
    await repo.transition(updated, "active", "pending");
    recovered.push(task.id);

    obs.emit({ type: "task.recovered", task_id: task.id, timestamp: now });

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

  await git.stageFiles([deps.tasksDir]);
  await git.commit(
    `ralph: crash recovery — ${recovered.length} task(s) returned to queue`,
  );
  const pushed = await git.push();
  if (!pushed) {
    process.stderr.write("[recovery] failed to push recovery commit\n");
  }
}
