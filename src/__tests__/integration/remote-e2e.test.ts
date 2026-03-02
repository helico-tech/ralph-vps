import "./setup";
import { describe, expect, test } from "bun:test";
import { SshRemoteExecutor } from "../../adapters/ssh-remote-executor";
import { getTestKeyPath } from "../helpers/docker";
import type { ClientConfig } from "../../domain/config";
import { RemoteError } from "../../errors";

async function createExecutor(): Promise<SshRemoteExecutor> {
  const keyPath = await getTestKeyPath();
  const config: ClientConfig = {
    nodes: {
      "test-vps": {
        host: "localhost",
        user: "testuser",
        port: 2222,
        identityFile: keyPath,
      },
    },
  };
  return new SshRemoteExecutor(config);
}

describe("Remote control E2E (Docker)", () => {
  test("execute runs a command and returns stdout", async () => {
    const executor = await createExecutor();

    const result = await executor.execute({
      node: "test-vps",
      command: ["echo", "hello from remote"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello from remote");
  });

  test("execute with cwd runs command in specified directory", async () => {
    const executor = await createExecutor();

    const result = await executor.execute({
      node: "test-vps",
      command: ["pwd"],
      cwd: "/tmp",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp");
  });

  test("execute returns non-zero exit code for failing command", async () => {
    const executor = await createExecutor();

    const result = await executor.execute({
      node: "test-vps",
      command: ["false"],
    });

    expect(result.exitCode).not.toBe(0);
  });

  test("execute captures stderr", async () => {
    const executor = await createExecutor();

    const result = await executor.execute({
      node: "test-vps",
      command: ["echo oops >&2; exit 1"],
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("oops");
  });

  test("stream yields output lines", async () => {
    const executor = await createExecutor();

    const lines: string[] = [];
    for await (const line of executor.stream({
      node: "test-vps",
      command: ["seq", "1", "3"],
    })) {
      lines.push(line);
    }

    expect(lines).toEqual(["1", "2", "3"]);
  });

  test("execute can run git on remote", async () => {
    const executor = await createExecutor();

    const result = await executor.execute({
      node: "test-vps",
      command: ["git", "--version"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("git version");
  });

  test("execute can run tmux on remote", async () => {
    const executor = await createExecutor();

    const result = await executor.execute({
      node: "test-vps",
      command: ["tmux", "-V"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("tmux");
  });

  test("unknown node throws RemoteError", async () => {
    const executor = await createExecutor();

    expect(() =>
      executor.execute({
        node: "nonexistent",
        command: ["echo", "nope"],
      })
    ).toThrow(RemoteError);
  });
});
