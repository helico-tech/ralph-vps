import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { ShellGitSynchronizer } from "../shell-git-synchronizer";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";

let tmpDir: string;
let bareDir: string;
let workDir: string;
let sync: ShellGitSynchronizer;

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  bareDir = join(tmpDir, "bare.git");
  workDir = join(tmpDir, "work");
  sync = new ShellGitSynchronizer();

  // Create bare repo
  await mkdir(bareDir, { recursive: true });
  git(bareDir, "init", "--bare");

  // Clone into work dir
  git(tmpDir, "clone", bareDir, "work");
  git(workDir, "config", "user.name", "Test");
  git(workDir, "config", "user.email", "test@test.com");

  // Create initial commit with .ralph/
  await mkdir(join(workDir, ".ralph/tasks"), { recursive: true });
  await Bun.write(join(workDir, ".ralph/project.json"), '{"name":"test"}');
  git(workDir, "add", ".");
  git(workDir, "commit", "-m", "initial");
  git(workDir, "push");
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

describe("ShellGitSynchronizer", () => {
  test("pull succeeds on clean repo", async () => {
    const result = await sync.pull(workDir);
    expect(result.success).toBe(true);
  });

  test("getCurrentHash returns valid hash", async () => {
    const hash = await sync.getCurrentHash(workDir);
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });

  test("isClean returns true when clean", async () => {
    expect(await sync.isClean(workDir)).toBe(true);
  });

  test("isClean returns false when .ralph modified", async () => {
    await Bun.write(join(workDir, ".ralph/tasks/test.md"), "modified");
    expect(await sync.isClean(workDir)).toBe(false);
  });

  test("commitAndPush stages and pushes .ralph changes", async () => {
    await Bun.write(
      join(workDir, ".ralph/tasks/new-task.md"),
      "---\nid: test\ntitle: Test\ncreated: 2026-03-02T00:00:00.000Z\n---\nBody"
    );

    const result = await sync.commitAndPush(workDir, "test commit");
    expect(result.success).toBe(true);

    // Verify pushed to bare repo
    const log = git(bareDir, "log", "--oneline", "-1");
    expect(log).toContain("test commit");
  });

  test("commitAndPush succeeds with nothing to commit", async () => {
    const result = await sync.commitAndPush(workDir, "nothing");
    expect(result.success).toBe(true);
  });
});
