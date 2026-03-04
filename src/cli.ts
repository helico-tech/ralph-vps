#!/usr/bin/env bun
// CLI entry point — commander-based interface for Ralph

import { Command } from "commander";
import { join } from "path";
import { FsTaskRepository } from "./adapters/fs-task-repository.js";
import { GitSourceControl } from "./adapters/git-source-control.js";
import { loadConfig } from "./orchestrator/config.js";
import { createTask } from "./client/create-task.js";
import { listTasks } from "./client/list-tasks.js";
import { getStatus } from "./client/status.js";
import { formatTaskTable, formatStatus, formatDoctorResults } from "./client/format.js";
import { runDoctor } from "./doctor.js";
import type { ClientDeps } from "./client/types.js";
import type { TaskType } from "./core/types.js";

const program = new Command();

program
  .name("ralph")
  .description("Autonomous coding agent — git-based task queue")
  .version("0.1.0");

// --- ralph init ---
program
  .command("init")
  .description("Initialize Ralph in the current project")
  .requiredOption("-n, --name <name>", "Project name")
  .requiredOption("--test <cmd>", "Test command (e.g. 'bun test', 'npm test')")
  .option("--main-branch <branch>", "Main branch name", "main")
  .action(async (opts) => {
    try {
      const { initProject } = await import("./client/init-project.js");
      const result = await initProject(process.cwd(), {
        name: opts.name,
        testCmd: opts.test,
        mainBranch: opts.mainBranch,
      });
      if (result.created.length > 0) {
        console.log("Created:");
        for (const f of result.created) console.log(`  + ${f}`);
      }
      if (result.skipped.length > 0) {
        console.log("Skipped (already exist):");
        for (const f of result.skipped) console.log(`  - ${f}`);
      }
      console.log("\nRalph initialized. Run 'ralph doctor' to verify.");
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

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

      const cwd = process.cwd();
      const config = await loadConfig(join(cwd, ".ralph", "config.json"));
      const repo = new FsTaskRepository(join(cwd, ".ralph", "tasks"));
      const git = new GitSourceControl(cwd);
      const obs = new CompositeObservability([
        new TraceWriter(join(cwd, ".ralph", "traces")),
        new ConsoleLogger(),
      ]);
      const executor = new ClaudeCliExecutor();

      const deps = {
        repo, git, executor, obs, config,
        templatesDir: join(cwd, ".ralph", "templates"),
        tasksDir: ".ralph/tasks",
        systemPromptPath: join(cwd, ".ralph", "ralph-system.md"),
      };

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
  .requiredOption("-d, --description <text>", "Task description")
  .option("--type <type>", "Task type (feature, bugfix)", "feature")
  .option("--priority <n>", "Priority — lower is higher (default: 100)", "100")
  .action(async (opts) => {
    try {
      const deps = await buildClientDeps();
      const task = await createTask(deps, {
        type: opts.type as TaskType,
        priority: parseInt(opts.priority, 10),
        description: opts.description,
      });
      console.log(`Created ${task.id} (${task.type}, priority ${task.priority})`);
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
        status: opts.status as any,
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
