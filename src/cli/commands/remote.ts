import type { Command } from "commander";
import { SshRemoteExecutor } from "../../adapters/ssh-remote-executor";
import type { ClientConfig } from "../../domain/config";

export function registerRemoteCommands(
  program: Command,
  clientConfig: ClientConfig
): void {
  program
    .command("remote")
    .description("Execute a command on a remote node")
    .argument("<node>", "Node name")
    .argument("<command...>", "Command to execute")
    .action(async (node: string, command: string[]) => {
      const executor = new SshRemoteExecutor(clientConfig);

      try {
        const result = await executor.execute({ node, command });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        process.exit(result.exitCode);
      } catch (e) {
        console.error(String(e));
        process.exit(1);
      }
    });
}
