#!/usr/bin/env bun
// CLI entry point — commander-based interface for Ralph

import { Command } from "commander";
import { join } from "path";
import { FsTaskRepository } from "./adapters/fs-task-repository.js";
import { GitSourceControl } from "./adapters/git-source-control.js";
import { loadConfig } from "./orchestrator/config.js";
import { createTask } from "./client/create-task.js";
import { listTasks } from "./client/list-tasks.js";
import { reviewTask } from "./client/review-task.js";
import { getStatus } from "./client/status.js";
import { formatTaskTable, formatStatus, formatDoctorResults } from "./client/format.js";
import { runDoctor } from "./doctor.js";
import type { ClientDeps } from "./client/types.js";
import type { TaskStatus, TaskType } from "./core/types.js";

const program = new Command();

program
  .name("ralph")
  .description("Autonomous coding agent — git-based task queue")
  .version("0.1.0");

// --- ralph start ---
program
  .command("start")
  .description("Start the orchestrator loop")
  .action(async () => {
    try {
      const { registerShutdownHandlers } = await import("./orchestrator/shutdown.js");
      const { recoverOrphanedTasks } = await import("./orchestrator/recovery.js");
      const { runLoop } = await import("./orchestrator/loop.js");
      const { CompositeObservability } = await import("./adapters/composite-observability.js");
      const { TraceWriter } = await import("./adapters/trace-writer.js");
      const { ConsoleLogger } = await import("./adapters/console-logger.js");
      const { ClaudeCliExecutor } = await import("./adapters/claude-cli-executor.js");
      const { ShellVerifier } = await import("./adapters/shell-verifier.js");

      const cwd = process.cwd();
      const config = await loadConfig(join(cwd, ".ralph", "config.json"));
      const repo = new FsTaskRepository(join(cwd, ".ralph", "tasks"));
      const git = new GitSourceControl(cwd);
      const obs = new CompositeObservability([
        new TraceWriter(join(cwd, ".ralph", "traces")),
        new ConsoleLogger(),
      ]);
      const executor = new ClaudeCliExecutor();
      const verifier = new ShellVerifier(cwd);

      const deps = { repo, git, executor, verifier, obs, config, templatesDir: join(cwd, ".ralph", "templates") };

      registerShutdownHandlers();
      await recoverOrphanedTasks(deps);
      await runLoop(deps);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// --- ralph task ---
const taskCmd = program.command("task").description("Manage tasks");

taskCmd
  .command("create")
  .description("Create a new task")
  .requiredOption("-t, --title <title>", "Task title")
  .option("--type <type>", "Task type (feature, bugfix, refactor, research, test, chore)", "feature")
  .option("--priority <n>", "Priority — lower is higher (default: 100)", "100")
  .option("-d, --description <text>", "Task description", "")
  .option("--author <name>", "Author name")
  .action(async (opts) => {
    try {
      const deps = await buildClientDeps();
      const task = await createTask(deps, {
        title: opts.title,
        type: opts.type as TaskType,
        priority: parseInt(opts.priority, 10),
        description: opts.description,
        author: opts.author,
      });
      console.log(`Created ${task.id}: ${task.title}`);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

taskCmd
  .command("list")
  .description("List all tasks")
  .option("-s, --status <status>", "Filter by status")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    try {
      const deps = await buildClientDeps();
      const tasks = await listTasks(deps.repo, {
        status: opts.status as TaskStatus | undefined,
      });
      if (opts.json) {
        console.log(JSON.stringify(tasks, null, 2));
      } else {
        console.log(formatTaskTable(tasks));
      }
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// --- ralph review ---
program
  .command("review <id>")
  .description("Review a completed task")
  .option("--approve", "Approve the task (merge + done)")
  .option("--reject", "Reject the task (re-queue or fail)")
  .option("--reason <text>", "Rejection reason")
  .action(async (id: string, opts) => {
    try {
      if (opts.approve && opts.reject) {
        process.stderr.write("Error: --approve and --reject are mutually exclusive\n");
        process.exit(1);
      }
      if (!opts.approve && !opts.reject) {
        process.stderr.write("Error: must specify --approve or --reject\n");
        process.exit(1);
      }
      const deps = await buildClientDeps();
      const decision = opts.approve ? "approve" as const : "reject" as const;
      const task = await reviewTask(deps, id, { decision, reason: opts.reason });
      const verb = decision === "approve" ? "approved" : "rejected";
      console.log(`Task ${id}: ${verb} (now ${task.status})`);
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// --- ralph status ---
program
  .command("status")
  .description("Show system status")
  .option("--json", "Output as JSON")
  .action(async (opts) => {
    try {
      const deps = await buildClientDeps();
      const report = await getStatus(deps.repo, deps.git);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatStatus(report));
      }
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

// --- ralph doctor ---
program
  .command("doctor")
  .description("Run health checks")
  .action(async () => {
    const results = await runDoctor(process.cwd());
    console.log(formatDoctorResults(results));
    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) process.exit(1);
  });

// --- Shared setup ---

async function buildClientDeps(): Promise<ClientDeps> {
  const cwd = process.cwd();
  const tasksDir = join(".ralph", "tasks");
  const config = await loadConfig(join(cwd, ".ralph", "config.json"));
  return {
    repo: new FsTaskRepository(join(cwd, tasksDir)),
    git: new GitSourceControl(cwd),
    config,
    tasksDir,
  };
}

program.parse();
