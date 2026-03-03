import { describe, it, expect } from "bun:test";
import { ShellVerifier } from "../../src/adapters/shell-verifier.js";

const verifier = new ShellVerifier(".");

describe("ShellVerifier — skipped commands", () => {
  it("returns skipped for empty string", async () => {
    const result = await verifier.runTests("");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.command).toBe("");
  });

  it("returns skipped for whitespace-only command", async () => {
    const result = await verifier.runBuild("   ");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe("ShellVerifier — passing commands", () => {
  it("returns passed for exit 0", async () => {
    const result = await verifier.runTests("exit 0");
    expect(result.passed).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.command).toBe("exit 0");
  });

  it("captures stdout", async () => {
    const result = await verifier.runTests("echo hello");
    expect(result.passed).toBe(true);
    expect(result.output).toContain("hello");
  });
});

describe("ShellVerifier — failing commands", () => {
  it("returns failed for non-zero exit", async () => {
    const result = await verifier.runTests("exit 1");
    expect(result.passed).toBe(false);
    expect(result.skipped).toBe(false);
  });

  it("captures stderr", async () => {
    const result = await verifier.runBuild(">&2 echo oops && exit 1");
    expect(result.passed).toBe(false);
    expect(result.output).toContain("oops");
  });

  it("captures both stdout and stderr", async () => {
    const result = await verifier.runLint("echo out && >&2 echo err");
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });
});

describe("ShellVerifier — shell features", () => {
  it("handles pipes through sh -c", async () => {
    const result = await verifier.runTests("echo 'hello world' | grep hello");
    expect(result.passed).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("handles quoted arguments", async () => {
    const result = await verifier.runTests("echo 'has spaces'");
    expect(result.passed).toBe(true);
    expect(result.output).toContain("has spaces");
  });
});

describe("ShellVerifier — all three methods work", () => {
  it("runTests, runBuild, runLint all delegate correctly", async () => {
    const tests = await verifier.runTests("echo tests");
    const build = await verifier.runBuild("echo build");
    const lint = await verifier.runLint("echo lint");

    expect(tests.passed).toBe(true);
    expect(build.passed).toBe(true);
    expect(lint.passed).toBe(true);
    expect(tests.output).toContain("tests");
    expect(build.output).toContain("build");
    expect(lint.output).toContain("lint");
  });
});
