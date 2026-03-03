import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { GitSourceControl } from "../../src/adapters/git-source-control.js";
import { GitError } from "../../src/core/errors.js";

let repoDir: string;
let git: GitSourceControl;

async function run(cwd: string, cmd: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Command failed: ${cmd}`);
  return stdout.trim();
}

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), "ralph-git-test-"));
  await run(repoDir, "git init -b main");
  await run(repoDir, "git config user.email test@test.com");
  await run(repoDir, "git config user.name Test");
  // Create initial commit so HEAD exists
  await Bun.write(join(repoDir, "README.md"), "# Test");
  await run(repoDir, "git add README.md && git commit -m 'init'");
  git = new GitSourceControl(repoDir);
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

describe("GitSourceControl — commit", () => {
  it("creates a commit and returns the SHA", async () => {
    await Bun.write(join(repoDir, "file.txt"), "hello");
    await git.stageFiles(["file.txt"]);
    const sha = await git.commit("test commit");
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("throws GitError when nothing is staged", async () => {
    await expect(git.commit("empty")).rejects.toThrow(GitError);
  });
});

describe("GitSourceControl — branches", () => {
  it("creates and checks out a new branch", async () => {
    await git.createBranch("feature/test");
    const branches = await git.listBranches();
    expect(branches).toContain("feature/test");
  });

  it("checkout switches to existing branch", async () => {
    await git.createBranch("branch-a");
    await git.checkout("main");
    // Should not throw — main exists after init
  });

  it("checkout throws on nonexistent branch", async () => {
    await expect(git.checkout("does-not-exist")).rejects.toThrow(GitError);
  });

  it("deleteBranch removes local branch", async () => {
    await git.createBranch("to-delete");
    await git.checkout("main");
    await git.deleteBranch("to-delete");
    const branches = await git.listBranches();
    expect(branches).not.toContain("to-delete");
  });
});

describe("GitSourceControl — stageFiles", () => {
  it("stages specific files", async () => {
    await Bun.write(join(repoDir, "a.txt"), "a");
    await Bun.write(join(repoDir, "b.txt"), "b");
    await git.stageFiles(["a.txt"]);
    const sha = await git.commit("staged a only");
    expect(sha).toBeTruthy();
  });

  it("is a no-op for empty array", async () => {
    // Should not throw
    await git.stageFiles([]);
  });
});

describe("GitSourceControl — stageTracked", () => {
  it("stages modifications to tracked files", async () => {
    await Bun.write(join(repoDir, "README.md"), "# Updated");
    await git.stageTracked();
    const sha = await git.commit("updated readme");
    expect(sha).toBeTruthy();
  });
});

describe("GitSourceControl — changedFiles", () => {
  it("returns list of changed files", async () => {
    await Bun.write(join(repoDir, "README.md"), "# Changed");
    const changed = await git.changedFiles();
    expect(changed).toContain("README.md");
  });

  it("returns empty array when nothing changed", async () => {
    const changed = await git.changedFiles();
    expect(changed).toHaveLength(0);
  });
});

describe("GitSourceControl — push (no remote)", () => {
  it("returns false when no remote is configured", async () => {
    await Bun.write(join(repoDir, "x.txt"), "x");
    await git.stageFiles(["x.txt"]);
    await git.commit("test");
    const ok = await git.push();
    expect(ok).toBe(false);
  });
});
