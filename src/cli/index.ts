import { Command } from "commander";
import type { EnvironmentType } from "../ports/config-provider";
import { FsConfigProvider } from "../adapters/fs-config-provider";
import { registerVersionCommand } from "./commands/version";
import { registerInitCommand } from "./commands/init";
import { registerTaskCommands } from "./commands/task";
import { registerLoopCommands } from "./commands/loop";
import { registerRemoteCommands } from "./commands/remote";
import { registerNodeCommands } from "./commands/node";
import { registerSyncCommand } from "./commands/sync";
import { registerLogCommands } from "./commands/log";
import { registerMigrateCommand } from "./commands/migrate";

export async function createProgram(): Promise<Command> {
  const pkg = await Bun.file(new URL("../../package.json", import.meta.url)).json();
  const program = new Command();

  program
    .name("ralph")
    .description("Ralph — autonomous Claude Code loop manager")
    .version(pkg.version);

  // Detect environment
  const configProvider = new FsConfigProvider();
  const env = await configProvider.detectEnvironment();

  // Register commands available in all environments
  registerVersionCommand(program, configProvider, pkg.version);
  registerInitCommand(program);

  // Register project-level commands when in a project
  const projectRoot = await configProvider.getProjectRoot();
  if (projectRoot) {
    registerTaskCommands(program, projectRoot);
    registerLoopCommands(program, projectRoot);
    registerSyncCommand(program, projectRoot);
    registerLogCommands(program, projectRoot);
    registerMigrateCommand(program, projectRoot);
  }

  // Register client-level commands
  if (env === "client" && projectRoot) {
    const clientConfig = await configProvider.loadClientConfig(projectRoot);
    if (clientConfig) {
      registerRemoteCommands(program, clientConfig);
      registerNodeCommands(program, projectRoot);
    }
  }

  return program;
}

export async function detectAndWire(): Promise<{
  env: EnvironmentType;
  projectRoot: string | null;
}> {
  const configProvider = new FsConfigProvider();
  const env = await configProvider.detectEnvironment();
  const projectRoot = await configProvider.getProjectRoot();
  return { env, projectRoot };
}
