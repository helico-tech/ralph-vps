// Review task — approve (merge + done) or reject (re-queue or fail)

import { join } from "path";
import type { Task } from "../core/types.js";
import type { ClientDeps } from "./types.js";
import { transitionTask } from "../core/state-machine.js";
import { TaskError, GitError, ERROR_CODES } from "../core/errors.js";

export type ReviewDecision = "approve" | "reject";

export interface ReviewOptions {
  decision: ReviewDecision;
  reason?: string;
}

export async function reviewTask(deps: ClientDeps, taskId: string, options: ReviewOptions): Promise<Task> {
  const { repo, git, config, tasksDir } = deps;

  const task = await repo.findById(taskId);
  if (!task) {
    throw new TaskError(ERROR_CODES.TASK_NOT_FOUND, `Task '${taskId}' not found`);
  }
  if (task.status !== "review") {
    throw new TaskError(
      ERROR_CODES.INVALID_TRANSITION,
      `Task '${taskId}' is not in review (status: ${task.status})`,
    );
  }

  const now = new Date().toISOString();
  const branchName = task.branch ?? `${config.git.branch_prefix}${taskId}`;

  await git.checkout(config.git.main_branch);
  await git.pull();

  if (options.decision === "approve") {
    // Merge feature branch into main — abort on conflict
    try {
      await git.merge(branchName);
    } catch (err) {
      // Abort the failed merge to leave working tree clean
      try {
        await git.checkout(config.git.main_branch);
      } catch { /* best effort cleanup */ }
      throw new GitError(
        ERROR_CODES.GIT_MERGE_CONFLICT,
        `Failed to merge '${branchName}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Move task to done
    const updated = transitionTask(task, "done", now);
    await repo.transition(updated, "review", "done");

    // Stage both the deletion and creation
    await git.stageFiles([
      join(tasksDir, "review", `${taskId}.md`),
      join(tasksDir, "done", `${taskId}.md`),
    ]);
    await git.commit(`ralph(${taskId}): approved`);

    const pushed = await git.push();
    if (!pushed) {
      throw new GitError(ERROR_CODES.GIT_PUSH_FAILED, `Failed to push after approving '${taskId}'`);
    }

    // Clean up feature branch
    try {
      await git.deleteBranch(branchName, { remote: true });
    } catch { /* best effort */ }

    return updated;
  } else {
    // Reject — re-queue or fail
    const canRetry = task.retry_count < task.max_retries;
    const target = canRetry ? ("pending" as const) : ("failed" as const);
    const updated = transitionTask(task, target, now);
    await repo.transition(updated, "review", target);

    await git.stageFiles([
      join(tasksDir, "review", `${taskId}.md`),
      join(tasksDir, target, `${taskId}.md`),
    ]);
    await git.commit(`ralph(${taskId}): rejected — ${options.reason ?? "no reason given"}`);

    const pushed = await git.push();
    if (!pushed) {
      throw new GitError(ERROR_CODES.GIT_PUSH_FAILED, `Failed to push after rejecting '${taskId}'`);
    }

    // Clean up feature branch
    try {
      await git.deleteBranch(branchName, { remote: true });
    } catch { /* best effort */ }

    return updated;
  }
}
