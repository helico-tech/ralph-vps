import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../../src/orchestrator/config.js";
import { ConfigError } from "../../src/core/errors.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "ralph-config-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.RALPH_MODEL;
  delete process.env.RALPH_MAIN_BRANCH;
  delete process.env.RALPH_PERMISSION_MODE;
});

async function writeConfig(obj: unknown): Promise<string> {
  const path = join(tmpDir, "config.json");
  await Bun.write(path, JSON.stringify(obj));
  return path;
}

const MINIMAL_CONFIG = {
  version: 1,
  project: { name: "test-project" },
  verify: "bun test",
};

describe("loadConfig — happy path", () => {
  it("loads config with all fields", async () => {
    const path = await writeConfig({
      version: 1,
      project: { name: "my-project" },
      verify: "bun test",
      task_defaults: {
        model: "claude-sonnet-4-5",
        max_turns: 100,
        timeout_seconds: 3600,
      },
      git: { main_branch: "develop", branch_prefix: "auto/" },
      execution: { permission_mode: "default" },
    });

    const config = await loadConfig(path);

    expect(config.project.name).toBe("my-project");
    expect(config.verify).toBe("bun test");
    expect(config.task_defaults.model).toBe("claude-sonnet-4-5");
    expect(config.git.main_branch).toBe("develop");
    expect(config.git.branch_prefix).toBe("auto/");
    expect(config.execution.permission_mode).toBe("default");
  });

  it("applies defaults for missing optional fields", async () => {
    const path = await writeConfig(MINIMAL_CONFIG);
    const config = await loadConfig(path);

    expect(config.task_defaults.model).toBe("claude-opus-4-5");
    expect(config.task_defaults.max_turns).toBe(50);
    expect(config.task_defaults.timeout_seconds).toBe(1800);
    expect(config.git.main_branch).toBe("main");
    expect(config.git.branch_prefix).toBe("ralph/");
  });
});

describe("loadConfig — validation", () => {
  it("throws CONFIG_NOT_FOUND for missing file", async () => {
    const path = join(tmpDir, "nope.json");
    try {
      await loadConfig(path);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).code).toBe("CONFIG_NOT_FOUND");
    }
  });

  it("throws CONFIG_INVALID for non-JSON", async () => {
    const path = join(tmpDir, "bad.json");
    await Bun.write(path, "not json {{{");
    try {
      await loadConfig(path);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).code).toBe("CONFIG_INVALID");
    }
  });

  it("throws CONFIG_INVALID for non-object JSON", async () => {
    const path = join(tmpDir, "arr.json");
    await Bun.write(path, "[1,2,3]");
    try {
      await loadConfig(path);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).code).toBe("CONFIG_INVALID");
    }
  });

  it("throws CONFIG_MISSING_FIELD when project.name is missing", async () => {
    const path = await writeConfig({ version: 1, verify: "bun test" });
    try {
      await loadConfig(path);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).code).toBe("CONFIG_MISSING_FIELD");
      expect((err as ConfigError).message).toContain("project.name");
    }
  });

  it("throws CONFIG_MISSING_FIELD when verify is missing", async () => {
    const path = await writeConfig({ version: 1, project: { name: "x" } });
    try {
      await loadConfig(path);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).code).toBe("CONFIG_MISSING_FIELD");
      expect((err as ConfigError).message).toContain("verify");
    }
  });
});

describe("loadConfig — env var overrides", () => {
  it("RALPH_MODEL overrides task_defaults.model", async () => {
    process.env.RALPH_MODEL = "claude-haiku-3-5";
    const path = await writeConfig(MINIMAL_CONFIG);
    const config = await loadConfig(path);
    expect(config.task_defaults.model).toBe("claude-haiku-3-5");
  });

  it("RALPH_MAIN_BRANCH overrides git.main_branch", async () => {
    process.env.RALPH_MAIN_BRANCH = "develop";
    const path = await writeConfig(MINIMAL_CONFIG);
    const config = await loadConfig(path);
    expect(config.git.main_branch).toBe("develop");
  });

  it("RALPH_PERMISSION_MODE overrides execution.permission_mode", async () => {
    process.env.RALPH_PERMISSION_MODE = "default";
    const path = await writeConfig(MINIMAL_CONFIG);
    const config = await loadConfig(path);
    expect(config.execution.permission_mode).toBe("default");
  });
});
