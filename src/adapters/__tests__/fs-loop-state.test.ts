import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { FsLoopState } from "../fs-loop-state";
import { initialLoopStatus } from "../../domain/loop";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";

let tmpDir: string;
let state: FsLoopState;

beforeEach(async () => {
  tmpDir = await createTempDir();
  state = new FsLoopState(tmpDir);
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

describe("FsLoopState", () => {
  test("returns initial status when no file exists", async () => {
    const status = await state.read();
    expect(status.phase).toBe("idle");
    expect(status.iteration).toBe(0);
  });

  test("write and read round-trip", async () => {
    const status = {
      ...initialLoopStatus(),
      iteration: 5,
      totalTokens: 50000,
      totalCostUsd: 0.50,
    };
    await state.write(status);

    const read = await state.read();
    expect(read.iteration).toBe(5);
    expect(read.totalTokens).toBe(50000);
    expect(read.totalCostUsd).toBe(0.50);
  });

  test("handles corrupted state file", async () => {
    const { join } = await import("node:path");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(tmpDir, ".ralph-local"), { recursive: true });
    await Bun.write(join(tmpDir, ".ralph-local/state.json"), "not json");

    const status = await state.read();
    expect(status.phase).toBe("idle");
    expect(status.iteration).toBe(0);
  });
});
