import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ProgressDetector, PreState, ProgressResult } from "../ports/progress-detector";
import { TASKS_DIR } from "../constants";

export class GitProgressDetector implements ProgressDetector {
  async recordPreState(cwd: string): Promise<PreState> {
    const commitHash = await gitRevParse(cwd);
    const taskFileHashes = await hashTaskFiles(cwd);
    return { commitHash, taskFileHashes };
  }

  async detectProgress(cwd: string, preState: PreState): Promise<ProgressResult> {
    const newCommitHash = await gitRevParse(cwd);

    // Count commits since pre-state
    let commitsMade = 0;
    if (newCommitHash !== preState.commitHash) {
      commitsMade = await countCommitsBetween(cwd, preState.commitHash, newCommitHash);
    }

    // Count changed files
    const filesChanged = await countChangedFiles(cwd, preState.commitHash);

    // Check dirty tree
    const isDirty = await isTreeDirty(cwd);

    return { commitsMade, filesChanged, isDirty, newCommitHash };
  }
}

async function gitRevParse(cwd: string): Promise<string> {
  const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.stdout.toString().trim();
}

async function countCommitsBetween(
  cwd: string,
  from: string,
  to: string
): Promise<number> {
  const proc = Bun.spawnSync(
    ["git", "rev-list", "--count", `${from}..${to}`],
    { cwd, stdout: "pipe", stderr: "pipe" }
  );
  const count = parseInt(proc.stdout.toString().trim(), 10);
  return isNaN(count) ? 0 : count;
}

async function countChangedFiles(cwd: string, since: string): Promise<number> {
  const proc = Bun.spawnSync(
    ["git", "diff", "--name-only", since, "HEAD"],
    { cwd, stdout: "pipe", stderr: "pipe" }
  );
  const output = proc.stdout.toString().trim();
  if (!output) return 0;
  return output.split("\n").length;
}

async function isTreeDirty(cwd: string): Promise<boolean> {
  const proc = Bun.spawnSync(
    ["git", "status", "--porcelain"],
    { cwd, stdout: "pipe", stderr: "pipe" }
  );
  return proc.stdout.toString().trim().length > 0;
}

async function hashTaskFiles(cwd: string): Promise<Record<string, string>> {
  const tasksDir = join(cwd, TASKS_DIR);
  const hashes: Record<string, string> = {};

  try {
    const files = await readdir(tasksDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const content = await Bun.file(join(tasksDir, file)).text();
        hashes[file] = createHash("sha256").update(content).digest("hex").slice(0, 16);
      }
    }
  } catch {
    // No tasks dir yet
  }

  return hashes;
}
