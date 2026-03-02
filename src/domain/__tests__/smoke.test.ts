import { describe, expect, test } from "bun:test";
import { RALPH_DIR, TASKS_DIR } from "../../constants";
import { RalphError } from "../../errors";

describe("smoke tests", () => {
  test("constants are defined", () => {
    expect(RALPH_DIR).toBe(".ralph");
    expect(TASKS_DIR).toBe(".ralph/tasks");
  });

  test("RalphError is throwable with cause", () => {
    const cause = new Error("root cause");
    const err = new RalphError("something broke", cause);
    expect(err.message).toBe("something broke");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("RalphError");
    expect(err).toBeInstanceOf(Error);
  });
});
