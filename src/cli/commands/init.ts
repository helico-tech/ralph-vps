import { join } from "node:path";
import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { RALPH_DIR, RALPH_LOCAL_DIR, TASKS_DIR, TYPES_DIR, LOGS_DIR } from "../../constants";

export function registerInitCommand(program: Command): void {
  const init = program
    .command("init")
    .description("Initialize Ralph configuration");

  init
    .command("project")
    .description("Initialize a Ralph project in the current directory")
    .argument("[name]", "Project name", defaultProjectName())
    .action(async (name: string) => {
      const cwd = process.cwd();
      await initProject(cwd, name);
      console.log(`Initialized Ralph project "${name}" in ${cwd}`);
    });

  init
    .command("node")
    .description("Initialize this machine as a Ralph node")
    .argument("<hostname>", "Node hostname identifier")
    .action(async (hostname: string) => {
      const cwd = process.cwd();
      await initNode(cwd, hostname);
      console.log(`Initialized Ralph node "${hostname}" in ${cwd}`);
    });

  init
    .command("client")
    .description("Initialize Ralph client configuration")
    .action(async () => {
      const cwd = process.cwd();
      await initClient(cwd);
      console.log(`Initialized Ralph client in ${cwd}`);
    });
}

function defaultProjectName(): string {
  return process.cwd().split("/").pop() ?? "unnamed";
}

async function initProject(cwd: string, name: string): Promise<void> {
  // Create directories
  await mkdir(join(cwd, TASKS_DIR), { recursive: true });
  await mkdir(join(cwd, TYPES_DIR), { recursive: true });
  await mkdir(join(cwd, RALPH_LOCAL_DIR, "logs"), { recursive: true });

  // Write project config
  const configPath = join(cwd, RALPH_DIR, "project.json");
  if (!(await Bun.file(configPath).exists())) {
    await Bun.write(
      configPath,
      JSON.stringify(
        {
          name,
          circuitBreakers: {
            maxConsecutiveErrors: 3,
            maxStallIterations: 5,
            maxCostUsd: 0,
            maxTokens: 0,
            maxIterations: 0,
          },
          defaultType: "feature-dev",
          reviewAfterCompletion: true,
        },
        null,
        2
      )
    );
  }

  // Update .gitignore
  await ensureGitignore(cwd);
}

async function initNode(cwd: string, hostname: string): Promise<void> {
  await mkdir(join(cwd, RALPH_DIR), { recursive: true });

  const configPath = join(cwd, RALPH_DIR, "node.json");
  if (!(await Bun.file(configPath).exists())) {
    await Bun.write(
      configPath,
      JSON.stringify(
        {
          hostname,
          projectsDir: "/home/ralph/projects",
          logsDir: "/home/ralph/logs",
          maxConcurrentLoops: 1,
        },
        null,
        2
      )
    );
  }
}

async function initClient(cwd: string): Promise<void> {
  await mkdir(join(cwd, RALPH_DIR), { recursive: true });

  const configPath = join(cwd, RALPH_DIR, "client.json");
  if (!(await Bun.file(configPath).exists())) {
    await Bun.write(
      configPath,
      JSON.stringify({ nodes: {} }, null, 2)
    );
  }
}

async function ensureGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, ".gitignore");
  const entry = ".ralph-local/";

  let content = "";
  try {
    content = await readFile(gitignorePath, "utf-8");
  } catch {
    // No .gitignore yet
  }

  if (!content.includes(entry)) {
    const addition = content.endsWith("\n") || content === ""
      ? `\n# Ralph local state\n${entry}\n`
      : `\n\n# Ralph local state\n${entry}\n`;
    await appendFile(gitignorePath, addition);
  }
}
