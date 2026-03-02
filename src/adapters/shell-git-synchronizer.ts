import type { GitSynchronizer, SyncResult } from "../ports/git-synchronizer";
import { RALPH_DIR } from "../constants";
import { GitError } from "../errors";

export class ShellGitSynchronizer implements GitSynchronizer {
  async pull(cwd: string): Promise<SyncResult> {
    const result = Bun.spawnSync(
      ["git", "pull", "--rebase"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString();
      return {
        success: false,
        error: `git pull --rebase failed (exit ${result.exitCode})`,
        conflictDetails: stderr,
      };
    }

    return { success: true };
  }

  async commitAndPush(cwd: string, message: string): Promise<SyncResult> {
    // Stage .ralph/ changes only
    const addResult = Bun.spawnSync(
      ["git", "add", RALPH_DIR],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (addResult.exitCode !== 0) {
      return {
        success: false,
        error: `git add failed: ${addResult.stderr.toString()}`,
      };
    }

    // Check if there's anything to commit
    const statusResult = Bun.spawnSync(
      ["git", "diff", "--cached", "--quiet"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (statusResult.exitCode === 0) {
      // Nothing staged, nothing to commit
      return { success: true };
    }

    // Commit
    const commitResult = Bun.spawnSync(
      ["git", "commit", "-m", message],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (commitResult.exitCode !== 0) {
      return {
        success: false,
        error: `git commit failed: ${commitResult.stderr.toString()}`,
      };
    }

    // Push
    const pushResult = Bun.spawnSync(
      ["git", "push"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (pushResult.exitCode !== 0) {
      return {
        success: false,
        error: `git push failed: ${pushResult.stderr.toString()}`,
      };
    }

    return { success: true };
  }

  async isClean(cwd: string): Promise<boolean> {
    const result = Bun.spawnSync(
      ["git", "status", "--porcelain", RALPH_DIR],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    return result.stdout.toString().trim().length === 0;
  }

  async getCurrentHash(cwd: string): Promise<string> {
    const result = Bun.spawnSync(
      ["git", "rev-parse", "HEAD"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );

    if (result.exitCode !== 0) {
      throw new GitError("git rev-parse HEAD failed", "rev-parse");
    }

    return result.stdout.toString().trim();
  }
}
