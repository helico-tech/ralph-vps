import "./setup";
import { describe, expect, test } from "bun:test";
import { getTestKeyPath, sshCommand } from "../helpers/docker";

describe("SSH integration", () => {
  test("SSH connects successfully", async () => {
    const keyPath = await getTestKeyPath();
    const result = Bun.spawnSync(sshCommand("echo connected", keyPath), {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe("connected");
  });

  test("git is available", async () => {
    const keyPath = await getTestKeyPath();
    const result = Bun.spawnSync(sshCommand("git --version", keyPath), {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("git version");
  });

  test("tmux is available", async () => {
    const keyPath = await getTestKeyPath();
    const result = Bun.spawnSync(sshCommand("tmux -V", keyPath), {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("tmux");
  });
});
