import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { checkConfig, checkTaskDirs } from "../../src/doctor.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ralph-doctor-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("checkConfig", () => {
  it("passes for valid config", async () => {
    const configPath = join(tmpDir, "config.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        version: 1,
        project: { name: "test" },
        verify: "bun test",
      }),
    );

    const result = await checkConfig(configPath);
    expect(result.passed).toBe(true);
    expect(result.name).toBe("Configuration");
  });

  it("fails for missing config", async () => {
    const result = await checkConfig(join(tmpDir, "nope.json"));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("fails for invalid config", async () => {
    const configPath = join(tmpDir, "bad.json");
    await Bun.write(configPath, "not json");

    const result = await checkConfig(configPath);
    expect(result.passed).toBe(false);
  });
});

describe("checkTaskDirs", () => {
  it("passes when all directories exist", async () => {
    const tasksDir = join(tmpDir, "tasks");
    for (const dir of ["pending", "active", "done", "failed"]) {
      await mkdir(join(tasksDir, dir), { recursive: true });
    }

    const result = await checkTaskDirs(tasksDir);
    expect(result.passed).toBe(true);
  });

  it("fails when directories are missing", async () => {
    const tasksDir = join(tmpDir, "tasks");
    await mkdir(join(tasksDir, "pending"), { recursive: true });

    const result = await checkTaskDirs(tasksDir);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("active");
  });

  it("fails when tasks dir does not exist", async () => {
    const result = await checkTaskDirs(join(tmpDir, "nonexistent"));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("pending");
  });
});
