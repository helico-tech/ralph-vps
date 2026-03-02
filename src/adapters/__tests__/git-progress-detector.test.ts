import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { GitProgressDetector } from "../git-progress-detector";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";

let tmpDir: string;
let detector: GitProgressDetector;

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  detector = new GitProgressDetector();

  // Initialize a test git repo
  git(tmpDir, "init");
  git(tmpDir, "config", "user.name", "Test");
  git(tmpDir, "config", "user.email", "test@test.com");

  // Initial commit
  await Bun.write(join(tmpDir, "README.md"), "# Test");
  git(tmpDir, "add", ".");
  git(tmpDir, "commit", "-m", "initial");
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

describe("GitProgressDetector", () => {
  test("records pre-state with commit hash", async () => {
    const state = await detector.recordPreState(tmpDir);
    expect(state.commitHash).toMatch(/^[a-f0-9]{40}$/);
    expect(state.taskFileHashes).toEqual({});
  });

  test("detects no progress when nothing changed", async () => {
    const preState = await detector.recordPreState(tmpDir);
    const result = await detector.detectProgress(tmpDir, preState);
    expect(result.commitsMade).toBe(0);
    expect(result.filesChanged).toBe(0);
    expect(result.isDirty).toBe(false);
  });

  test("detects commits made", async () => {
    const preState = await detector.recordPreState(tmpDir);

    // Make a commit
    await Bun.write(join(tmpDir, "new-file.ts"), "export const x = 1;");
    git(tmpDir, "add", ".");
    git(tmpDir, "commit", "-m", "add new file");

    const result = await detector.detectProgress(tmpDir, preState);
    expect(result.commitsMade).toBe(1);
    expect(result.filesChanged).toBe(1);
    expect(result.isDirty).toBe(false);
    expect(result.newCommitHash).not.toBe(preState.commitHash);
  });

  test("detects dirty tree", async () => {
    const preState = await detector.recordPreState(tmpDir);
    await Bun.write(join(tmpDir, "uncommitted.ts"), "dirty");

    const result = await detector.detectProgress(tmpDir, preState);
    expect(result.isDirty).toBe(true);
  });

  test("records task file hashes", async () => {
    await mkdir(join(tmpDir, ".ralph/tasks"), { recursive: true });
    await Bun.write(join(tmpDir, ".ralph/tasks/task-1.md"), "---\nid: test\n---\nBody");
    git(tmpDir, "add", ".");
    git(tmpDir, "commit", "-m", "add task");

    const state = await detector.recordPreState(tmpDir);
    expect(Object.keys(state.taskFileHashes)).toHaveLength(1);
    expect(state.taskFileHashes["task-1.md"]).toBeDefined();
  });
});
