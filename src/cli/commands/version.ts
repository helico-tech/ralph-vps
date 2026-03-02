import type { Command } from "commander";
import type { ConfigProvider } from "../../ports/config-provider";

export function registerVersionCommand(
  program: Command,
  configProvider: ConfigProvider,
  version: string
): void {
  program
    .command("version")
    .description("Show version and environment info")
    .action(async () => {
      const env = await configProvider.detectEnvironment();
      const projectRoot = await configProvider.getProjectRoot();

      console.log(`ralph v${version}`);
      console.log(`Environment: ${env ?? "none detected"}`);
      if (projectRoot) {
        console.log(`Project root: ${projectRoot}`);
      }
    });
}
