import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { FsTypeResolver } from "../fs-type-resolver";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";

let tmpDir: string;
let resolver: FsTypeResolver;

beforeEach(async () => {
  tmpDir = await createTempDir();
  resolver = new FsTypeResolver(tmpDir);
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

describe("FsTypeResolver", () => {
  test("resolves built-in types", async () => {
    const type = await resolver.resolve("feature-dev");
    expect(type).not.toBeNull();
    expect(type!.name).toBe("feature-dev");
    expect(type!.promptTemplate).toContain("{{TASK_TITLE}}");
    expect(type!.taskTemplate).toContain("Description");
  });

  test("lists built-in types", async () => {
    const types = await resolver.listTypes();
    expect(types).toContain("feature-dev");
    expect(types).toContain("bug-fix");
    expect(types).toContain("research");
    expect(types).toContain("review");
  });

  test("returns null for unknown type", async () => {
    const type = await resolver.resolve("nonexistent");
    expect(type).toBeNull();
  });

  test("project types override built-in", async () => {
    const typeDir = join(tmpDir, ".ralph/types/feature-dev");
    await mkdir(typeDir, { recursive: true });
    await Bun.write(join(typeDir, "prompt.md"), "Custom prompt for {{TASK_TITLE}}");
    await Bun.write(join(typeDir, "template.md"), "Custom template");

    const type = await resolver.resolve("feature-dev");
    expect(type).not.toBeNull();
    expect(type!.promptTemplate).toBe("Custom prompt for {{TASK_TITLE}}");
    expect(type!.taskTemplate).toBe("Custom template");
  });
});
