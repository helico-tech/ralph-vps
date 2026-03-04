// Main orchestrator loop — poll, claim, execute, verify, transition

import { join } from "path";
import type { TaskRepository } from "../ports/task-repository.js";
import type { SourceControl } from "../ports/source-control.js";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { Verifier } from "../ports/verifier.js";
import type { Observability } from "../ports/observability.js";
import type { RalphConfig, Task } from "../core/types.js";
import { transitionTask } from "../core/state-machine.js";
import { pickNextTask } from "../core/queue.js";
import { calculateCosts, canClaimTask } from "../core/budget.js";
import { buildExecutionPlan } from "../core/prompt-builder.js";
import { isShuttingDown } from "./shutdown.js";

export interface OrchestratorDeps {
  repo: TaskRepository;
  git: SourceControl;
  executor: AgentExecutor;
  verifier: Verifier;
  obs: Observability;
  config: RalphConfig;
  templatesDir: string;
  tasksDir: string; // relative to git root, e.g. ".ralph/tasks"
  systemPromptPath: string; // absolute path to ralph-system.md
  pollIntervalMs?: number;
}

const SKIP_VERIFY_REASONS = new Set(["refusal", "timeout", "error"]);

export async function processTask(deps: OrchestratorDeps, task: Task): Promise<void> {
  const { repo, git, executor, verifier, obs, config, templatesDir, tasksDir } = deps;
  const now = () => new Date().toISOString();
  const branchName = `${config.git.branch_prefix}${task.id}`;

  // --- CLAIM ---
  const claimed = transitionTask(task, "active", now());
  await repo.transition(claimed, "pending", "active");
  await git.stageFiles([tasksDir]);
  await git.commit(`ralph(${task.id}): claimed`);

  const pushed = await git.push();
  if (!pushed) {
    // Push conflict — another instance claimed, or we're behind. Revert and push.
    const reverted = transitionTask(claimed, "pending", now());
    await repo.transition(reverted, "active", "pending");
    await git.stageFiles([tasksDir]);
    await git.commit(`ralph(${task.id}): claim reverted — push conflict`);
    try { await git.push(); } catch { /* best effort — next pull will reconcile */ }
    return;
  }

  obs.emit({ type: "task.claimed", task_id: task.id, timestamp: now() });

  // Everything after claim is wrapped so that any uncaught exception
  // still transitions the task out of active/ (via failTask).
  try {
    // --- EXECUTE ---
    // Clean up stale branch from previous attempt
    try {
      const branches = await git.listBranches();
      if (branches.includes(branchName)) {
        await git.deleteBranch(branchName, { remote: false });
      }
    } catch { /* best effort */ }

    await git.createBranch(branchName);

    const [template, systemPromptTemplate] = await Promise.all([
      loadTemplate(task.type, templatesDir),
      Bun.file(deps.systemPromptPath).text(),
    ]);
    const plan = buildExecutionPlan(task, template, config, systemPromptTemplate);

    obs.emit({ type: "execution.started", task_id: task.id, timestamp: now(), model: plan.model });

    const result = await executor.execute(plan);

    obs.emit({
      type: "execution.completed",
      task_id: task.id,
      timestamp: now(),
      stop_reason: result.stop_reason,
      cost_usd: result.cost_usd,
    });

    // --- VERIFY ---
    if (SKIP_VERIFY_REASONS.has(result.stop_reason)) {
      await git.checkout(config.git.main_branch);
      await failTask(deps, claimed, `execution stop reason: ${result.stop_reason}`);
      return;
    }

    obs.emit({ type: "verification.started", task_id: task.id, timestamp: now() });

    const [tests, build, lint] = await Promise.all([
      verifier.runTests(config.verify.test),
      verifier.runBuild(config.verify.build),
      verifier.runLint(config.verify.lint),
    ]);

    const { exit_criteria } = config;
    const passed =
      (!exit_criteria.require_tests || tests.passed || tests.skipped) &&
      (!exit_criteria.require_build || build.passed || build.skipped) &&
      (!exit_criteria.require_lint || lint.passed || lint.skipped);

    obs.emit({ type: "verification.completed", task_id: task.id, timestamp: now(), passed });

    // --- TRANSITION ---
    if (passed) {
      // Commit agent work on feature branch and push it
      const changed = await git.changedFiles();
      if (changed.length > 0) {
        await git.stageAll();
        await git.commit(`ralph(${task.id}): work complete`);
      }
      await git.pushBranch(branchName);

      // Switch back to main and move task to review
      await git.checkout(config.git.main_branch);

      const completed = {
        ...transitionTask(claimed, "review", now()),
        cost_usd: result.cost_usd,
        turns: result.turns,
        duration_s: result.duration_s,
        branch: branchName,
      };
      await repo.transition(completed, "active", "review");
      await git.stageFiles([tasksDir]);
      await git.commit(`ralph(${task.id}): completed — awaiting review`);
      await git.push();

      obs.emit({
        type: "task.completed",
        task_id: task.id,
        timestamp: now(),
        cost_usd: result.cost_usd,
        turns: result.turns,
        duration_s: result.duration_s,
      });
    } else {
      await git.checkout(config.git.main_branch);
      await failTask(deps, claimed, "verification failed");
    }
  } catch (err) {
    // Uncaught exception after claim — ensure task doesn't stay stuck in active/
    try {
      await git.checkout(config.git.main_branch);
    } catch { /* best effort */ }
    await failTask(deps, claimed, err instanceof Error ? err.message : String(err));
  }
}

async function failTask(
  deps: OrchestratorDeps,
  task: Task,
  reason: string,
): Promise<void> {
  const { repo, git, obs, config, tasksDir } = deps;
  const now = new Date().toISOString();
  const branchName = `${config.git.branch_prefix}${task.id}`;

  const canRetry = task.retry_count < task.max_retries;
  const target = canRetry ? ("pending" as const) : ("failed" as const);
  const updated = transitionTask(task, target, now);

  await repo.transition(updated, "active", target);
  await git.stageFiles([tasksDir]);
  await git.commit(`ralph(${task.id}): ${canRetry ? "retrying" : "failed"} — ${reason}`);
  await git.push();

  // Clean up stale branch
  try {
    const branches = await git.listBranches();
    if (branches.includes(branchName)) {
      await git.deleteBranch(branchName, { remote: true });
    }
  } catch { /* best effort */ }

  if (canRetry) {
    obs.emit({ type: "task.retried", task_id: task.id, timestamp: now, attempt: updated.retry_count });
  } else {
    obs.emit({ type: "task.failed", task_id: task.id, timestamp: now, reason });
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
      const now = new Date().toISOString();
      const costs = calculateCosts(allTasks, now);
      const limits = { daily_usd: 0, per_task_usd: config.task_defaults.max_budget_usd };

      const next = pickNextTask(allTasks);

      if (!next) {
        await sleep(pollMs);
        continue;
      }

      if (!canClaimTask(costs, limits, config.task_defaults.max_budget_usd)) {
        obs.emit({
          type: "budget.exceeded",
          task_id: next.id,
          timestamp: now,
          cost_usd: costs.today_usd,
          limit_usd: config.task_defaults.max_budget_usd,
        });
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
