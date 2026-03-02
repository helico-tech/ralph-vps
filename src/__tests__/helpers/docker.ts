import { join } from "node:path";

const ROOT_DIR = join(import.meta.dir, "../../..");

export async function startTestVps(): Promise<void> {
  const proc = Bun.spawnSync(
    ["docker", "compose", "-f", "docker-compose.test.yml", "up", "-d", "--build"],
    { cwd: ROOT_DIR, stderr: "pipe", stdout: "pipe" }
  );
  if (proc.exitCode !== 0) {
    throw new Error(`Failed to start test VPS: ${proc.stderr.toString()}`);
  }
  await waitForSsh();
}

export async function stopTestVps(): Promise<void> {
  Bun.spawnSync(
    ["docker", "compose", "-f", "docker-compose.test.yml", "down", "-v"],
    { cwd: ROOT_DIR, stderr: "pipe", stdout: "pipe" }
  );
}

export async function waitForSsh(
  maxAttempts = 30,
  delayMs = 1000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const result = Bun.spawnSync([
      "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "ConnectTimeout=2",
      "-i", await getTestKeyPath(),
      "-p", "2222",
      "testuser@localhost",
      "echo", "connected",
    ], { stderr: "pipe", stdout: "pipe" });

    if (result.exitCode === 0) return;
    await Bun.sleep(delayMs);
  }
  throw new Error("SSH connection timed out");
}

export async function getTestKeyPath(): Promise<string> {
  // Extract the test key from the container
  const keyPath = join(ROOT_DIR, ".ralph-local/test-ssh-key");
  const proc = Bun.spawnSync(
    ["docker", "compose", "-f", "docker-compose.test.yml", "cp", "test-vps:/tmp/test-ssh-key", keyPath],
    { cwd: ROOT_DIR, stderr: "pipe", stdout: "pipe" }
  );
  if (proc.exitCode !== 0) {
    throw new Error("Failed to extract test SSH key");
  }
  // Fix permissions
  Bun.spawnSync(["chmod", "600", keyPath]);
  return keyPath;
}

export function sshCommand(cmd: string, keyPath: string): string[] {
  return [
    "ssh",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-i", keyPath,
    "-p", "2222",
    "testuser@localhost",
    cmd,
  ];
}
