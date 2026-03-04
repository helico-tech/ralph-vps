// Git source control adapter — shells out to git via Bun.spawn

import type { SourceControl } from "../ports/source-control.js";
import { GitError, ERROR_CODES } from "../core/errors.js";

export class GitSourceControl implements SourceControl {
  constructor(private readonly cwd: string) {}

  async pull(): Promise<void> {
    await this.git("pull", "--ff-only");
  }

  async commit(message: string): Promise<string> {
    await this.git("commit", "-m", message);
    const { stdout } = await this.git("rev-parse", "HEAD");
    return stdout;
  }

  async push(): Promise<boolean> {
    try {
      await this.git("push");
      return true;
    } catch {
      return false;
    }
  }

  async pushBranch(branch: string): Promise<boolean> {
    try {
      await this.git("push", "--set-upstream", "origin", branch);
      return true;
    } catch {
      return false;
    }
  }

  async createBranch(name: string): Promise<void> {
    await this.git("checkout", "-b", name);
  }

  async checkout(branch: string): Promise<void> {
    await this.git("checkout", branch);
  }

  async stageFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.git("add", "--", ...paths);
  }

  async stageTracked(): Promise<void> {
    await this.git("add", "-u");
  }

  async stageAll(): Promise<void> {
    await this.git("add", "-A");
  }

  async changedFiles(): Promise<string[]> {
    // Staged + unstaged + untracked files
    const { stdout: unstaged } = await this.git("diff", "--name-only", "HEAD");
    const { stdout: staged } = await this.git("diff", "--cached", "--name-only");
    const { stdout: untracked } = await this.git("ls-files", "--others", "--exclude-standard");
    const all = new Set([
      ...unstaged.split("\n").filter(Boolean),
      ...staged.split("\n").filter(Boolean),
      ...untracked.split("\n").filter(Boolean),
    ]);
    return [...all];
  }

  async deleteBranch(name: string, options?: { remote?: boolean }): Promise<void> {
    await this.git("branch", "-D", name);
    if (options?.remote) {
      try {
        await this.git("push", "origin", "--delete", name);
      } catch {
        // Remote branch may not exist — not fatal
      }
    }
  }

  async listBranches(): Promise<string[]> {
    const { stdout } = await this.git("branch", "--format=%(refname:short)");
    return stdout.split("\n").filter(Boolean);
  }

  async merge(branch: string, options?: { ffOnly?: boolean }): Promise<void> {
    const flag = options?.ffOnly ? "--ff-only" : "--no-ff";
    await this.git("merge", flag, branch, "-m", `Merge branch '${branch}'`);
  }

  async lastCommit(): Promise<{ sha: string; timestamp: string; message: string } | null> {
    try {
      const { stdout } = await this.git("log", "-1", "--format=%H%n%aI%n%s");
      const lines = stdout.split("\n");
      if (!lines[0]) return null;
      return { sha: lines[0], timestamp: lines[1], message: lines[2] };
    } catch {
      return null;
    }
  }

  // --- Private ---

  private async git(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    const proc = Bun.spawn(["git", ...args], {
      cwd: this.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      throw new GitError(
        ERROR_CODES.GIT_COMMAND_FAILED,
        `git ${args[0]} failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`
      );
    }

    return { stdout: stdout.trim(), stderr: stderr.trim() };
  }
}
