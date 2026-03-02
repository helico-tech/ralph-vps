import type {
  RemoteExecutor,
  RemoteExecuteOptions,
  RemoteExecuteResult,
} from "../ports/remote-executor";
import type { ClientConfig } from "../domain/config";
import { RemoteError } from "../errors";

export class SshRemoteExecutor implements RemoteExecutor {
  constructor(private readonly clientConfig: ClientConfig) {}

  async execute(options: RemoteExecuteOptions): Promise<RemoteExecuteResult> {
    const sshArgs = this.buildSshArgs(options);

    const proc = Bun.spawnSync(["ssh", ...sshArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  }

  async *stream(options: RemoteExecuteOptions): AsyncIterable<string> {
    const sshArgs = this.buildSshArgs(options);

    const proc = Bun.spawn(["ssh", ...sshArgs], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          yield line;
        }
      }

      if (buffer.length > 0) {
        yield buffer;
      }
    } finally {
      reader.releaseLock();
    }

    await proc.exited;
  }

  private buildSshArgs(options: RemoteExecuteOptions): string[] {
    const nodeConfig = this.clientConfig.nodes[options.node];
    if (!nodeConfig) {
      throw new RemoteError(`Unknown node: ${options.node}`, options.node);
    }

    const args: string[] = [
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      "-p", String(nodeConfig.port),
    ];

    if (nodeConfig.identityFile) {
      args.push("-i", nodeConfig.identityFile);
    }

    args.push(`${nodeConfig.user}@${nodeConfig.host}`);

    if (options.cwd) {
      args.push(`cd ${options.cwd} &&`);
    }

    args.push(...options.command);

    return args;
  }
}
