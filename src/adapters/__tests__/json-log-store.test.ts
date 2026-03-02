import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { JsonLogStore } from "../json-log-store";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";
import type { IterationLog } from "../../domain/log";

let tmpDir: string;
let store: JsonLogStore;

beforeEach(async () => {
  tmpDir = await createTempDir();
  store = new JsonLogStore(tmpDir);
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

const makeLog = (overrides: Partial<IterationLog> = {}): IterationLog => ({
  iteration: 1,
  taskId: "20260302-test",
  taskTitle: "Test Task",
  type: "feature-dev",
  startedAt: "2026-03-02T10:00:00.000Z",
  completedAt: "2026-03-02T10:01:00.000Z",
  durationMs: 60000,
  model: "claude-sonnet-4-6",
  inputTokens: 10000,
  outputTokens: 2000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: 15,
  costUsd: 0.06,
  commitsMade: 1,
  filesChanged: 3,
  success: true,
  ...overrides,
});

describe("JsonLogStore", () => {
  test("write and listAll round-trip", async () => {
    const log = makeLog();
    await store.write(log);

    const all = await store.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].taskId).toBe("20260302-test");
    expect(all[0].iteration).toBe(1);
  });

  test("readLatest returns last N logs", async () => {
    await store.write(makeLog({ iteration: 1, startedAt: "2026-03-02T10:00:00.000Z" }));
    await store.write(makeLog({ iteration: 2, startedAt: "2026-03-02T10:01:00.000Z" }));
    await store.write(makeLog({ iteration: 3, startedAt: "2026-03-02T10:02:00.000Z" }));

    const latest = await store.readLatest(2);
    expect(latest).toHaveLength(2);
    expect(latest[0].iteration).toBe(2);
    expect(latest[1].iteration).toBe(3);
  });

  test("readByIteration finds specific iteration", async () => {
    await store.write(makeLog({ iteration: 1 }));
    await store.write(makeLog({ iteration: 2, startedAt: "2026-03-02T10:01:00.000Z" }));

    const log = await store.readByIteration(2);
    expect(log).not.toBeNull();
    expect(log!.iteration).toBe(2);
  });

  test("readByIteration returns null for missing", async () => {
    const log = await store.readByIteration(99);
    expect(log).toBeNull();
  });

  test("listAll returns empty for new store", async () => {
    const all = await store.listAll();
    expect(all).toEqual([]);
  });

  test("creates logs directory if missing", async () => {
    await store.write(makeLog());
    // No error means dir was created
    const all = await store.listAll();
    expect(all).toHaveLength(1);
  });
});
