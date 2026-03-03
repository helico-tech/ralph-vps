// Doctor — independent health checks for the Ralph setup

import { join } from "path";
import { access } from "fs/promises";
import type { DoctorCheck } from "./client/types.js";
import { loadConfig } from "./orchestrator/config.js";
import type { TaskRepository } from "./ports/task-repository.js";
import type { SourceControl } from "./ports/source-control.js";
import { checkConsistency } from "./core/consistency.js";

export async function checkGitRepo(cwd: string): Promise<DoctorCheck> {
  try {
    await access(join(cwd, ".git"));
    return { name: "Git repository", passed: true, message: "OK" };
  } catch {
    return { name: "Git repository", passed: false, message: ".git directory not found" };
  }
}

export async function checkConfig(configPath: string): Promise<DoctorCheck> {
  try {
    await loadConfig(configPath);
    return { name: "Configuration", passed: true, message: "OK" };
  } catch (err) {
    return { name: "Configuration", passed: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function checkTaskDirs(tasksDir: string): Promise<DoctorCheck> {
  const required = ["pending", "active", "review", "done", "failed"];
  const missing: string[] = [];
  for (const dir of required) {
    try {
      await access(join(tasksDir, dir));
    } catch {
      missing.push(dir);
    }
  }
  if (missing.length === 0) {
    return { name: "Task directories", passed: true, message: "OK" };
  }
  return {
    name: "Task directories",
    passed: false,
    message: `missing: ${missing.join(", ")}`,
  };
}

export async function checkClaudeCli(): Promise<DoctorCheck> {
  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const version = (await new Response(proc.stdout).text()).trim();
      return { name: "Claude CLI", passed: true, message: version };
    }
    return { name: "Claude CLI", passed: false, message: `exit code ${exitCode}` };
  } catch {
    return { name: "Claude CLI", passed: false, message: "not found in PATH" };
  }
}

export async function checkTaskConsistency(
  repo: TaskRepository,
  git: SourceControl,
  branchPrefix: string,
): Promise<DoctorCheck> {
  try {
    const tasks = await repo.listAll();
    const branches = await git.listBranches();
    const report = checkConsistency(tasks, branches, branchPrefix);
    if (report.clean) {
      return { name: "Task consistency", passed: true, message: "OK" };
    }
    const messages = report.issues.map((i) => i.message);
    return { name: "Task consistency", passed: false, message: messages.join("; ") };
  } catch (err) {
    return { name: "Task consistency", passed: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function runDoctor(cwd: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const configPath = join(cwd, ".ralph", "config.json");
  const tasksDir = join(cwd, ".ralph", "tasks");

  checks.push(await checkGitRepo(cwd));
  checks.push(await checkConfig(configPath));
  checks.push(await checkTaskDirs(tasksDir));
  checks.push(await checkClaudeCli());

  // Consistency check only if config is valid
  if (checks[1].passed) {
    try {
      const config = await loadConfig(configPath);
      const { FsTaskRepository } = await import("./adapters/fs-task-repository.js");
      const { GitSourceControl } = await import("./adapters/git-source-control.js");
      const repo = new FsTaskRepository(tasksDir);
      const git = new GitSourceControl(cwd);
      checks.push(await checkTaskConsistency(repo, git, config.git.branch_prefix));
    } catch (err) {
      checks.push({
        name: "Task consistency",
        passed: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return checks;
}
