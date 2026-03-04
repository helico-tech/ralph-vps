// Doctor — independent health checks for the Ralph setup

import { join } from "path";
import { access } from "fs/promises";
import type { DoctorCheck } from "./client/types.js";
import { loadConfig } from "./orchestrator/config.js";

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
  const required = ["pending", "active", "done", "failed"];
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

export async function runDoctor(cwd: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const configPath = join(cwd, ".ralph", "config.json");
  const tasksDir = join(cwd, ".ralph", "tasks");

  checks.push(await checkGitRepo(cwd));
  checks.push(await checkConfig(configPath));
  checks.push(await checkTaskDirs(tasksDir));
  checks.push(await checkClaudeCli());

  return checks;
}
