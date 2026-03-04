import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm, readdir, access } from "fs/promises";
import { tmpdir } from "os";
import { initProject } from "../../src/client/init-project.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ralph-init-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("initProject", () => {
  it("creates all task directories", async () => {
    await initProject(tempDir, { name: "test-project", testCmd: "bun test" });

    const statuses = ["pending", "active", "review", "done", "failed"];
    for (const status of statuses) {
      await access(join(tempDir, ".ralph", "tasks", status));
    }
  });

  it("creates config.json with provided values", async () => {
    await initProject(tempDir, { name: "my-app", testCmd: "npm test", mainBranch: "master" });

    const config = await Bun.file(join(tempDir, ".ralph", "config.json")).json();
    expect(config.project.name).toBe("my-app");
    expect(config.verify.test).toBe("npm test");
    expect(config.git.main_branch).toBe("master");
  });

  it("uses default main branch when not specified", async () => {
    await initProject(tempDir, { name: "test", testCmd: "bun test" });

    const config = await Bun.file(join(tempDir, ".ralph", "config.json")).json();
    expect(config.git.main_branch).toBe("main");
  });

  it("copies template files", async () => {
    await initProject(tempDir, { name: "test", testCmd: "bun test" });

    const templates = await readdir(join(tempDir, ".ralph", "templates"));
    expect(templates).toContain("default.md");
    expect(templates).toContain("bugfix.md");
    expect(templates).toContain("feature.md");
    // ralph-system.md should NOT be in templates/ — it goes to .ralph/ root
    expect(templates).not.toContain("ralph-system.md");
  });

  it("copies system prompt to .ralph/ root", async () => {
    await initProject(tempDir, { name: "test", testCmd: "bun test" });

    const content = await Bun.file(join(tempDir, ".ralph", "ralph-system.md")).text();
    expect(content).toContain("You are Ralph");
  });

  it("copies Claude Code skills", async () => {
    await initProject(tempDir, { name: "test", testCmd: "bun test" });

    const skills = ["ralph-task", "ralph-status", "ralph-review", "ralph-list"];
    for (const skill of skills) {
      const path = join(tempDir, ".claude", "skills", skill, "SKILL.md");
      const content = await Bun.file(path).text();
      expect(content).toContain("---");
      expect(content).toContain(`name: ${skill}`);
    }
  });

  it("reports created files", async () => {
    const result = await initProject(tempDir, { name: "test", testCmd: "bun test" });

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created).toContain(".ralph/config.json");
    expect(result.created).toContain(".ralph/ralph-system.md");
    expect(result.skipped.length).toBe(0);
  });

  it("skips existing files on re-run", async () => {
    await initProject(tempDir, { name: "test", testCmd: "bun test" });
    const result = await initProject(tempDir, { name: "test", testCmd: "bun test" });

    expect(result.created.length).toBe(0);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped).toContain(".ralph/config.json");
  });

  it("does not overwrite existing config", async () => {
    await initProject(tempDir, { name: "original", testCmd: "bun test" });
    await initProject(tempDir, { name: "overwritten", testCmd: "npm test" });

    const config = await Bun.file(join(tempDir, ".ralph", "config.json")).json();
    expect(config.project.name).toBe("original");
  });

  it("creates .gitkeep in empty task directories", async () => {
    await initProject(tempDir, { name: "test", testCmd: "bun test" });

    const gitkeep = Bun.file(join(tempDir, ".ralph", "tasks", "pending", ".gitkeep"));
    expect(await gitkeep.exists()).toBe(true);
  });
});
