// Main orchestrator loop — poll, claim, execute, verify, transition, follow-ups

import { join } from "path";
import type { TaskRepository } from "../ports/task-repository.js";
import type { SourceControl } from "../ports/source-control.js";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { Observability } from "../ports/observability.js";
import type { RalphConfig, Task } from "../core/types.js";
import { transitionTask } from "../core/state-machine.js";
import { pickNextTask } from "../core/queue.js";
import { buildExecutionPlan } from "../core/prompt-builder.js";
import { buildNextTasks, resolveBranchName } from "../core/next-task.js";
import { generateNextId } from "../core/id.js";
import { isShuttingDown } from "./shutdown.js";

export interface OrchestratorDeps {
  repo: TaskRepository;
  git: SourceControl;
  executor: AgentExecutor;
  obs: Observability;
  config: RalphConfig;
  templatesDir: string;
  tasksDir: string;
  systemPromptPath: string;
  pollIntervalMs?: number;
}

const SKIP_VERIFY_REASONS = new Set(["refusal", "timeout", "error"]);

export async function processTask(deps: OrchestratorDeps, task: Task): Promise<void> {
  const { repo, git, executor, obs, config, templatesDir, tasksDir } = deps;
  const now = () => new Date().toISOString();
  const branchName = resolveBranchName(task, config.git.branch_prefix);

  // --- CLAIM ---
  const claimed = transitionTask(task, "active");
  await repo.transition(claimed, "pending", "active");
  await git.stageFiles([tasksDir]);
  await git.commit(`ralph(${task.id}): claimed`);

  const pushed = await git.push();
  if (!pushed) {
    // Claim-revert is an admin operation — bypass state machine
    const reverted = { ...claimed, status: "pending" as const };
    await repo.transition(reverted, "active", "pending");
    await git.stageFiles([tasksDir]);
    await git.commit(`ralph(${task.id}): claim reverted — push conflict`);
    try { await git.push(); } catch { /* best effort */ }
    return;
  }

  obs.emit({ type: "task.claimed", task_id: task.id, timestamp: now() });

  try {
    // --- EXECUTE ---
    // For feature/bugfix: create new branch. For review/fix: checkout existing branch.
    if (task.type === "feature" || task.type === "bugfix") {
      try {
        const branches = await git.listBranches();
        if (branches.includes(branchName)) {
          await git.deleteBranch(branchName, { remote: false });
        }
      } catch { /* best effort */ }
      await git.createBranch(branchName);
    } else {
      await git.checkout(branchName);
    }

    const template = await loadTemplate(task.type, templatesDir);
    const systemPrompt = await Bun.file(deps.systemPromptPath).text();
    const plan = buildExecutionPlan(task, template, config, systemPrompt);

    obs.emit({ type: "execution.started", task_id: task.id, timestamp: now(), model: plan.model });

    const result = await executor.execute(plan);

    obs.emit({
      type: "execution.completed",
      task_id: task.id,
      timestamp: now(),
      stop_reason: result.stop_reason,
    });

    // --- VERIFY ---
    if (SKIP_VERIFY_REASONS.has(result.stop_reason)) {
      await git.checkout(config.git.main_branch);
      await failTask(deps, claimed, `execution stop reason: ${result.stop_reason}`);
      return;
    }

    obs.emit({ type: "verification.started", task_id: task.id, timestamp: now() });
    const verifyPassed = await runVerify(config.verify, process.cwd());
    obs.emit({ type: "verification.completed", task_id: task.id, timestamp: now(), passed: verifyPassed });

    // --- TRANSITION + FOLLOW-UPS ---
    if (verifyPassed) {
      // Commit work on feature branch
      const changed = await git.changedFiles();
      let commitHash: string | undefined;
      if (changed.length > 0) {
        await git.stageAll();
        commitHash = await git.commit(`ralph(${task.id}): work complete`);
      } else {
        const last = await git.lastCommit();
        commitHash = last?.sha;
      }

      const branchPushed = await git.pushBranch(branchName);
      if (!branchPushed) {
        await git.checkout(config.git.main_branch);
        await failTask(deps, claimed, `failed to push branch ${branchName}`);
        return;
      }
      await git.checkout(config.git.main_branch);

      // Complete task with commit hash
      const completed = { ...transitionTask(claimed, "done"), commit_hash: commitHash };
      await repo.transition(completed, "active", "done");

      obs.emit({ type: "task.completed", task_id: task.id, timestamp: now(), commit_hash: commitHash });

      // Determine follow-ups
      const allTasks = await repo.listAll();
      const nextId = generateNextId(allTasks);
      const { followUps, shouldMerge } = buildNextTasks(completed, true, nextId);

      if (shouldMerge) {
        await git.merge(branchName);
        await git.deleteBranch(branchName, { remote: true });
        obs.emit({ type: "branch.merged", task_id: task.id, branch: branchName, timestamp: now() });
      }

      for (const followUp of followUps) {
        await repo.create(followUp);
        obs.emit({ type: "task.spawned", task_id: followUp.id, parent_id: task.id, timestamp: now(), spawned_type: followUp.type });
      }

      await git.stageFiles([tasksDir]);
      await git.commit(`ralph(${task.id}): done${followUps.length ? ` → ${followUps.map((t) => t.id).join(", ")}` : ""}`);
      await git.push();
    } else {
      await git.checkout(config.git.main_branch);

      // Check if failed task should spawn follow-ups (review fail → fix)
      const allTasks = await repo.listAll();
      const nextId = generateNextId(allTasks);
      const { followUps } = buildNextTasks(task, false, nextId);

      await failTask(deps, claimed, "verification failed");

      for (const followUp of followUps) {
        await repo.create(followUp);
        obs.emit({ type: "task.spawned", task_id: followUp.id, parent_id: task.id, timestamp: now(), spawned_type: followUp.type });
      }

      if (followUps.length > 0) {
        await git.stageFiles([tasksDir]);
        await git.commit(`ralph(${task.id}): spawned ${followUps.map((t) => t.id).join(", ")}`);
        await git.push();
      }
    }
  } catch (err) {
    try { await git.checkout(config.git.main_branch); } catch { /* best effort */ }
    await failTask(deps, claimed, err instanceof Error ? err.message : String(err));
  }
}

async function failTask(deps: OrchestratorDeps, task: Task, reason: string): Promise<void> {
  const { repo, git, obs, tasksDir } = deps;
  const now = new Date().toISOString();
  const updated = transitionTask(task, "failed");

  await repo.transition(updated, "active", "failed");
  await git.stageFiles([tasksDir]);
  await git.commit(`ralph(${task.id}): failed — ${reason}`);
  await git.push();

  obs.emit({ type: "task.failed", task_id: task.id, timestamp: now, reason });
}

async function runVerify(command: string, cwd: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) return true;

  try {
    const proc = Bun.spawn(["sh", "-c", trimmed], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function runLoop(deps: OrchestratorDeps): Promise<void> {
  const { repo, git, obs, config } = deps;
  const pollMs = deps.pollIntervalMs ?? 30_000;

  obs.emit({ type: "orchestrator.started", timestamp: new Date().toISOString() });

  while (!isShuttingDown()) {
    try {
      await git.checkout(config.git.main_branch);
      await git.pull();

      const allTasks = await repo.listAll();
      const next = pickNextTask(allTasks);

      if (!next) {
        await sleep(pollMs);
        continue;
      }

      await processTask(deps, next);
    } catch (err) {
      process.stderr.write(
        `[ralph] loop error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      await sleep(pollMs);
    }
  }

  obs.emit({ type: "orchestrator.stopped", timestamp: new Date().toISOString(), reason: "shutdown" });
}

async function loadTemplate(taskType: string, templatesDir: string): Promise<string> {
  const candidates = [
    join(templatesDir, `${taskType}.md`),
    join(templatesDir, "default.md"),
  ];
  for (const path of candidates) {
    const file = Bun.file(path);
    if (await file.exists()) {
      return file.text();
    }
  }
  throw new Error(`No template found for task type '${taskType}' in ${templatesDir}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
