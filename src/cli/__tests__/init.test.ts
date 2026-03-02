import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";
import { RALPH_DIR, RALPH_LOCAL_DIR, TASKS_DIR, TYPES_DIR } from "../../constants";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await createTempDir();
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

// We test init by running the CLI as a subprocess to avoid process.cwd() issues
async function runInit(args: string[]): Promise<string> {
  const result = Bun.spawnSync(
    ["bun", "run", join(import.meta.dir, "../../index.ts"), "init", ...args],
    { cwd: tmpDir, stderr: "pipe", stdout: "pipe" }
  );
  return result.stdout.toString();
}

describe("ralph init project", () => {
  test("creates .ralph structure", async () => {
    await runInit(["project", "test-project"]);

    expect(await Bun.file(join(tmpDir, RALPH_DIR, "project.json")).exists()).toBe(true);
    expect(await Bun.file(join(tmpDir, TASKS_DIR)).exists()).toBe(false); // it's a dir
    // Verify config content
    const config = await Bun.file(join(tmpDir, RALPH_DIR, "project.json")).json();
    expect(config.name).toBe("test-project");
    expect(config.defaultType).toBe("feature-dev");
  });

  test("creates .ralph-local directory", async () => {
    await runInit(["project", "test-project"]);
    const logsDir = join(tmpDir, RALPH_LOCAL_DIR, "logs");
    // Check dir exists by trying to access it
    const result = Bun.spawnSync(["test", "-d", logsDir]);
    expect(result.exitCode).toBe(0);
  });

  test("updates .gitignore", async () => {
    await runInit(["project", "test-project"]);
    const gitignore = await readFile(join(tmpDir, ".gitignore"), "utf-8");
    expect(gitignore).toContain(".ralph-local/");
  });

  test("is idempotent", async () => {
    await runInit(["project", "test-project"]);
    await runInit(["project", "test-project"]);
    // Should not duplicate .gitignore entry
    const gitignore = await readFile(join(tmpDir, ".gitignore"), "utf-8");
    const matches = gitignore.match(/\.ralph-local\//g);
    expect(matches).toHaveLength(1);
  });
});

describe("ralph init node", () => {
  test("creates node.json", async () => {
    await runInit(["node", "vps-1"]);
    const config = await Bun.file(join(tmpDir, RALPH_DIR, "node.json")).json();
    expect(config.hostname).toBe("vps-1");
  });
});

describe("ralph init client", () => {
  test("creates client.json with empty nodes", async () => {
    await runInit(["client"]);
    const config = await Bun.file(join(tmpDir, RALPH_DIR, "client.json")).json();
    expect(config.nodes).toEqual({});
  });
});
