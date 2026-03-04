// E2E test helpers — real git repos, real filesystem, mock executor
//
// Creates a full Ralph environment in temp directories:
// - Bare remote repo (so push/pull work)
// - Working clone with .ralph/ structure, config, templates
// - Real FsTaskRepository + GitSourceControl
// - Mock executor, verifier, observability

import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FsTaskRepository } from "../../src/adapters/fs-task-repository.js";
import { GitSourceControl } from "../../src/adapters/git-source-control.js";
import { MockExecutor } from "../../src/adapters/mock/mock-executor.js";
import { MockVerifier } from "../../src/adapters/mock/mock-verifier.js";
import { MockObservability } from "../../src/adapters/mock/mock-observability.js";
import { serializeTaskFile } from "../../src/core/task-file.js";
import type { OrchestratorDeps } from "../../src/orchestrator/loop.js";
import type { Task, RalphConfig, ExecutionPlan, ExecutionResult } from "../../src/core/types.js";

export interface E2EDeps extends OrchestratorDeps {
  repo: FsTaskRepository;
  git: GitSourceControl;
  executor: MockExecutor;
  verifier: MockVerifier;
  obs: MockObservability;
}

export interface E2EEnv {
  remoteDir: string;
  workDir: string;
  deps: E2EDeps;
}

const TEST_CONFIG: RalphConfig = {
  version: 1,
  project: { name: "e2e-test" },
  verify: { test: "echo pass", build: "", lint: "" },
  task_defaults: {
    max_retries: 2,
    model: "opus",
    max_turns: 50,
    max_budget_usd: 5,
    timeout_seconds: 1800,
  },
  exit_criteria: { require_tests: true, require_build: false, require_lint: false },
  git: { main_branch: "main", branch_prefix: "ralph/" },
  execution: { permission_mode: "skip_all" },
};

/**
 * Shell out to run a command in a directory.
 */
export async function run(cwd: string, cmd: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Command failed (exit ${exitCode}): ${cmd}\nstderr: ${stderr}`);
  }
  return stdout.trim();
}

/**
 * Create a full E2E environment: bare remote, working clone, .ralph/ structure.
 */
export async function createE2EEnv(
  configOverrides: Partial<RalphConfig> = {},
  executorResult?: ExecutionResult | ((plan: ExecutionPlan) => ExecutionResult),
): Promise<E2EEnv> {
  // Create bare remote
  const remoteDir = await mkdtemp(join(tmpdir(), "ralph-e2e-remote-"));
  await run(remoteDir, "git init --bare -b main");

  // Clone to working dir
  const workDir = await mkdtemp(join(tmpdir(), "ralph-e2e-work-"));
  await rm(workDir, { recursive: true, force: true });
  await run(tmpdir(), `git clone "${remoteDir}" "${workDir}"`);
  await run(workDir, "git config user.email test@e2e.com");
  await run(workDir, "git config user.name E2ETest");

  // Create .ralph/ directory structure
  const tasksDir = join(workDir, ".ralph", "tasks");
  const statuses = ["pending", "active", "review", "done", "failed"];
  for (const status of statuses) {
    await mkdir(join(tasksDir, status), { recursive: true });
  }

  // Write config
  const config: RalphConfig = { ...TEST_CONFIG, ...configOverrides };
  await Bun.write(join(workDir, ".ralph", "config.json"), JSON.stringify(config, null, 2));

  // Write templates
  const templatesDir = join(workDir, ".ralph", "templates");
  await mkdir(templatesDir, { recursive: true });
  await Bun.write(join(templatesDir, "default.md"), "Task: {{title}}\n\n{{description}}");
  await Bun.write(join(templatesDir, "feature.md"), "Feature: {{title}}\n\n{{description}}");
  await Bun.write(join(templatesDir, "bugfix.md"), "Bugfix: {{title}}\n\n{{description}}");

  // Write system prompt
  await Bun.write(join(workDir, ".ralph", "ralph-system.md"), "You are Ralph.");

  // Initial commit and push
  await run(workDir, "git add -A && git commit -m 'init: e2e test setup'");
  await run(workDir, "git push -u origin main");

  // Build deps
  const repo = new FsTaskRepository(tasksDir);
  const git = new GitSourceControl(workDir);
  const executor = new MockExecutor(executorResult);
  const verifier = new MockVerifier();
  const obs = new MockObservability();

  const deps: E2EDeps = {
    repo,
    git,
    executor,
    verifier,
    obs,
    config,
    templatesDir,
    tasksDir: ".ralph/tasks",
    systemPromptPath: join(workDir, ".ralph", "ralph-system.md"),
  };

  return { remoteDir, workDir, deps };
}

/**
 * Clean up E2E environment.
 */
export async function cleanupE2EEnv(env: E2EEnv): Promise<void> {
  await rm(env.remoteDir, { recursive: true, force: true });
  await rm(env.workDir, { recursive: true, force: true });
}

/**
 * Create a task file directly on disk (bypassing the client).
 */
export async function seedTask(env: E2EEnv, task: Task, status: string): Promise<void> {
  const dir = join(env.workDir, ".ralph", "tasks", status);
  await mkdir(dir, { recursive: true });
  const content = serializeTaskFile({ ...task, status: status as Task["status"] });
  await Bun.write(join(dir, `${task.id}.md`), content);
}

/**
 * Stage and commit all changes.
 */
export async function commitAll(env: E2EEnv, message: string): Promise<void> {
  await run(env.workDir, `git add -A && git commit -m '${message}'`);
}

/**
 * Push changes to remote.
 */
export async function pushAll(env: E2EEnv): Promise<void> {
  await run(env.workDir, "git push");
}

/**
 * Create a mock executor that writes a file to the working directory.
 * This simulates Claude making changes on the feature branch.
 */
export function makeFileWritingExecutor(
  workDir: string,
  result?: Partial<ExecutionResult>,
): (plan: ExecutionPlan) => Promise<ExecutionResult> {
  return async (_plan: ExecutionPlan) => {
    await Bun.write(join(workDir, "agent-output.txt"), "Agent was here.\n");

    return {
      stop_reason: "end_turn",
      cost_usd: 0.05,
      turns: 5,
      duration_s: 30,
      output: "Done.",
      ...result,
    };
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-001",
    title: "E2E test task",
    status: "pending",
    type: "feature",
    priority: 100,
    created_at: "2026-03-03T12:00:00Z",
    author: "E2ETest",
    description: "Do the thing for E2E.",
    max_retries: 2,
    retry_count: 0,
    ...overrides,
  };
}
