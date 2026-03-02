import { join } from "node:path";
import type { Command } from "commander";
import { CLIENT_CONFIG_FILE } from "../../constants";

export function registerNodeCommands(
  program: Command,
  projectRoot: string
): Command {
  const node = program
    .command("node")
    .description("Manage remote nodes");

  node
    .command("add")
    .description("Add a remote node")
    .argument("<name>", "Node name")
    .requiredOption("--host <host>", "SSH host")
    .option("--user <user>", "SSH user", "ralph")
    .option("--port <port>", "SSH port", "22")
    .option("--identity-file <path>", "SSH identity file")
    .action(async (name: string, opts) => {
      const configPath = join(projectRoot, CLIENT_CONFIG_FILE);
      const file = Bun.file(configPath);

      let config: { nodes: Record<string, unknown> } = { nodes: {} };
      if (await file.exists()) {
        config = await file.json();
      }

      config.nodes[name] = {
        host: opts.host,
        user: opts.user,
        port: parseInt(opts.port, 10),
        ...(opts.identityFile ? { identityFile: opts.identityFile } : {}),
      };

      await Bun.write(configPath, JSON.stringify(config, null, 2));
      console.log(`Added node "${name}" (${opts.user}@${opts.host}:${opts.port})`);
    });

  node
    .command("list")
    .description("List configured nodes")
    .action(async () => {
      const configPath = join(projectRoot, CLIENT_CONFIG_FILE);
      const file = Bun.file(configPath);

      if (!(await file.exists())) {
        console.log("No client config found. Run 'ralph init client' first.");
        return;
      }

      const config = await file.json();
      const nodes = config.nodes ?? {};
      const names = Object.keys(nodes);

      if (names.length === 0) {
        console.log("No nodes configured.");
        return;
      }

      for (const name of names) {
        const n = nodes[name];
        console.log(`  ${name}: ${n.user}@${n.host}:${n.port}`);
      }
    });

  node
    .command("remove")
    .description("Remove a remote node")
    .argument("<name>", "Node name")
    .action(async (name: string) => {
      const configPath = join(projectRoot, CLIENT_CONFIG_FILE);
      const file = Bun.file(configPath);

      if (!(await file.exists())) {
        console.error("No client config found.");
        process.exit(1);
      }

      const config = await file.json();
      if (!config.nodes?.[name]) {
        console.error(`Node "${name}" not found.`);
        process.exit(1);
      }

      delete config.nodes[name];
      await Bun.write(configPath, JSON.stringify(config, null, 2));
      console.log(`Removed node "${name}"`);
    });

  return node;
}
