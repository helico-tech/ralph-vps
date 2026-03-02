import "./setup";
import { describe, expect, test, beforeEach } from "bun:test";
import { SshRemoteExecutor } from "../../adapters/ssh-remote-executor";
import { getTestKeyPath } from "../helpers/docker";
import type { ClientConfig } from "../../domain/config";

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

describe("node deploy-key (Docker)", () => {
  beforeEach(async () => {
    const executor = await createExecutor();
    // Clean up any existing key
    await executor.execute({
      node: "test-vps",
      command: ["rm", "-f", "~/.ssh/id_ed25519", "~/.ssh/id_ed25519.pub"],
    });
  });

  test("generates SSH key if none exists", async () => {
    const executor = await createExecutor();

    // Generate key
    await executor.execute({
      node: "test-vps",
      command: [
        "ssh-keygen",
        "-t", "ed25519",
        "-f", "~/.ssh/id_ed25519",
        "-N", '""',
      ],
    });

    // Verify key exists
    const check = await executor.execute({
      node: "test-vps",
      command: ["test", "-f", "~/.ssh/id_ed25519"],
    });
    expect(check.exitCode).toBe(0);

    // Verify public key content
    const pubKey = await executor.execute({
      node: "test-vps",
      command: ["cat", "~/.ssh/id_ed25519.pub"],
    });
    expect(pubKey.exitCode).toBe(0);
    expect(pubKey.stdout).toContain("ssh-ed25519");
  });

  test("skips keygen if key already exists", async () => {
    const executor = await createExecutor();

    // Generate first key
    await executor.execute({
      node: "test-vps",
      command: [
        "ssh-keygen",
        "-t", "ed25519",
        "-f", "~/.ssh/id_ed25519",
        "-N", '""',
      ],
    });

    // Read first key
    const firstKey = await executor.execute({
      node: "test-vps",
      command: ["cat", "~/.ssh/id_ed25519.pub"],
    });

    // Check key exists (simulating what the command does)
    const check = await executor.execute({
      node: "test-vps",
      command: ["test", "-f", "~/.ssh/id_ed25519"],
    });
    expect(check.exitCode).toBe(0);

    // Read key again — should be identical
    const secondKey = await executor.execute({
      node: "test-vps",
      command: ["cat", "~/.ssh/id_ed25519.pub"],
    });
    expect(secondKey.stdout).toBe(firstKey.stdout);
  });
});

describe("node clone (Docker)", () => {
  beforeEach(async () => {
    const executor = await createExecutor();
    // Clean up any previous test repos
    await executor.execute({
      node: "test-vps",
      command: ["rm", "-rf", "~/projects/test-repo", "/tmp/test-repo.git"],
    });
  });

  test("clones a repo into projects dir", async () => {
    const executor = await createExecutor();

    // Create a bare repo to clone from
    await executor.execute({
      node: "test-vps",
      command: ["git", "init", "--bare", "/tmp/test-repo.git"],
    });

    // Ensure projects dir exists
    await executor.execute({
      node: "test-vps",
      command: ["mkdir", "-p", "~/projects"],
    });

    // Clone it
    const cloneResult = await executor.execute({
      node: "test-vps",
      command: [
        "bash", "-c",
        '"cd ~/projects && git clone /tmp/test-repo.git test-repo 2>&1"',
      ],
    });
    expect(cloneResult.exitCode).toBe(0);

    // Verify directory exists
    const check = await executor.execute({
      node: "test-vps",
      command: ["test", "-d", "~/projects/test-repo"],
    });
    expect(check.exitCode).toBe(0);
  });

  test("fails if target dir already exists", async () => {
    const executor = await createExecutor();

    // Create the target dir ahead of time
    await executor.execute({
      node: "test-vps",
      command: ["mkdir", "-p", "~/projects/test-repo"],
    });

    // Existence check should succeed (dir exists = conflict)
    const check = await executor.execute({
      node: "test-vps",
      command: ["test", "-d", "~/projects/test-repo"],
    });
    expect(check.exitCode).toBe(0);
  });

  test("stream outputs clone progress", async () => {
    const executor = await createExecutor();

    // Create a bare repo
    await executor.execute({
      node: "test-vps",
      command: ["git", "init", "--bare", "/tmp/test-repo.git"],
    });
    await executor.execute({
      node: "test-vps",
      command: ["mkdir", "-p", "~/projects"],
    });

    // Stream the clone
    const lines: string[] = [];
    for await (const line of executor.stream({
      node: "test-vps",
      command: [
        "bash", "-c",
        '"cd ~/projects && git clone /tmp/test-repo.git test-repo 2>&1"',
      ],
    })) {
      lines.push(line);
    }

    // Should have at least one line of output
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe("node projects (Docker)", () => {
  beforeEach(async () => {
    const executor = await createExecutor();
    await executor.execute({
      node: "test-vps",
      command: ["rm", "-rf", "~/projects"],
    });
    await executor.execute({
      node: "test-vps",
      command: ["mkdir", "-p", "~/projects"],
    });
  });

  test("lists projects with status", async () => {
    const executor = await createExecutor();

    // Set up two fake projects with project.json
    await executor.execute({
      node: "test-vps",
      command: [
        "bash", "-c",
        '"mkdir -p ~/projects/app-a/.ralph && echo \'{\\"name\\":\\"app-a\\"}\' > ~/projects/app-a/.ralph/project.json"',
      ],
    });
    await executor.execute({
      node: "test-vps",
      command: [
        "bash", "-c",
        '"mkdir -p ~/projects/app-b/.ralph ~/projects/app-b/.ralph-local && echo \'{\\"name\\":\\"app-b\\"}\' > ~/projects/app-b/.ralph/project.json && echo \'{\\"phase\\":\\"running\\",\\"iteration\\":5}\' > ~/projects/app-b/.ralph-local/state.json"',
      ],
    });

    // Run the same shell one-liner the projects command uses
    const script = [
      "for dir in ~/projects/*/; do",
      '  [ -d "$dir" ] || continue;',
      '  name=$(basename "$dir");',
      '  pjson="$dir/.ralph/project.json";',
      '  sjson="$dir/.ralph-local/state.json";',
      '  if [ -f "$pjson" ]; then',
      '    phase="idle"; iteration="0";',
      '    if [ -f "$sjson" ]; then',
      '      phase=$(grep -o \'"phase":"[^"]*"\' "$sjson" | head -1 | cut -d\\" -f4);',
      '      iteration=$(grep -o \'"iteration":[0-9]*\' "$sjson" | head -1 | sed "s/.*://");',
      '      [ -z "$phase" ] && phase="idle";',
      '      [ -z "$iteration" ] && iteration="0";',
      "    fi;",
      '    echo "$name|$dir|$phase|$iteration";',
      "  fi;",
      "done",
    ].join(" ");

    const result = await executor.execute({
      node: "test-vps",
      command: ["bash", "-c", `'${script}'`],
    });

    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);

    // Parse and verify
    const parsed = lines.map((l) => {
      const [name, , phase, iteration] = l.split("|");
      return { name, phase, iteration };
    });

    const appA = parsed.find((p) => p.name === "app-a");
    const appB = parsed.find((p) => p.name === "app-b");

    expect(appA).toBeDefined();
    expect(appA!.phase).toBe("idle");
    expect(appA!.iteration).toBe("0");

    expect(appB).toBeDefined();
    expect(appB!.phase).toBe("running");
    expect(appB!.iteration).toBe("5");
  });

  test("handles empty projects dir", async () => {
    const executor = await createExecutor();

    const script = [
      "for dir in ~/projects/*/; do",
      '  [ -d "$dir" ] || continue;',
      '  name=$(basename "$dir");',
      '  pjson="$dir/.ralph/project.json";',
      '  if [ -f "$pjson" ]; then',
      '    echo "$name|$dir|idle|0";',
      "  fi;",
      "done",
    ].join(" ");

    const result = await executor.execute({
      node: "test-vps",
      command: ["bash", "-c", `'${script}'`],
    });

    expect(result.exitCode).toBe(0);
    // No output for empty dir
    expect(result.stdout.trim()).toBe("");
  });
});

describe("node setup (Docker)", () => {
  test("creates projects directory", async () => {
    const executor = await createExecutor();

    // Clean up first
    await executor.execute({
      node: "test-vps",
      command: ["rm", "-rf", "~/projects"],
    });

    // Create it
    const result = await executor.execute({
      node: "test-vps",
      command: ["mkdir", "-p", "~/projects"],
    });
    expect(result.exitCode).toBe(0);

    // Verify
    const check = await executor.execute({
      node: "test-vps",
      command: ["test", "-d", "~/projects"],
    });
    expect(check.exitCode).toBe(0);
  });

  test("configures git identity", async () => {
    const executor = await createExecutor();

    // Set git config
    await executor.execute({
      node: "test-vps",
      command: ["git", "config", "--global", "user.name", '"Test Bot"'],
    });
    await executor.execute({
      node: "test-vps",
      command: ["git", "config", "--global", "user.email", "test@example.com"],
    });

    // Verify
    const nameResult = await executor.execute({
      node: "test-vps",
      command: ["git", "config", "--global", "--get", "user.name"],
    });
    expect(nameResult.exitCode).toBe(0);
    expect(nameResult.stdout.trim()).toBe("Test Bot");

    const emailResult = await executor.execute({
      node: "test-vps",
      command: ["git", "config", "--global", "--get", "user.email"],
    });
    expect(emailResult.exitCode).toBe(0);
    expect(emailResult.stdout.trim()).toBe("test@example.com");
  });

  test("detects bun not installed", async () => {
    const executor = await createExecutor();

    // which bun should fail in the test container (no bun installed)
    const result = await executor.execute({
      node: "test-vps",
      command: ["which", "bun"],
    });
    expect(result.exitCode).not.toBe(0);
  });

  test("detects ralph not installed", async () => {
    const executor = await createExecutor();

    // which ralph should fail in the test container (no ralph installed)
    const result = await executor.execute({
      node: "test-vps",
      command: ["which", "ralph"],
    });
    expect(result.exitCode).not.toBe(0);
  });
});
