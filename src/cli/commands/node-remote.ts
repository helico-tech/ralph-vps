import type { Command } from "commander";
import { SshRemoteExecutor } from "../../adapters/ssh-remote-executor";
import type { ClientConfig } from "../../domain/config";
import type { RemoteExecuteOptions } from "../../ports/remote-executor";
import { RemoteError } from "../../errors";

const PROJECTS_DIR = "~/projects";
const TOOLS_DIR = "~/tools";

function deriveProjectName(repoUrl: string): string {
  return repoUrl.replace(/\.git$/, "").split("/").pop()!;
}

async function runOrFail(
  executor: SshRemoteExecutor,
  options: RemoteExecuteOptions,
  errorMsg: string
) {
  const result = await executor.execute(options);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new RemoteError(
      `${errorMsg}: ${detail}`,
      options.node
    );
  }
  return result;
}

export function registerNodeRemoteCommands(
  nodeCmd: Command,
  clientConfig: ClientConfig
): void {
  // --- deploy-key ---
  nodeCmd
    .command("deploy-key")
    .description("Generate an SSH deploy key on a remote node")
    .argument("<node>", "Node name")
    .action(async (node: string) => {
      const executor = new SshRemoteExecutor(clientConfig);

      try {
        // Check if key already exists
        const check = await executor.execute({
          node,
          command: ["test", "-f", "~/.ssh/id_ed25519"],
        });

        if (check.exitCode !== 0) {
          console.log("Generating SSH key...");
          await runOrFail(
            executor,
            {
              node,
              command: [
                "ssh-keygen",
                "-t", "ed25519",
                "-f", "~/.ssh/id_ed25519",
                "-N", '""',
              ],
            },
            "Failed to generate SSH key"
          );
        } else {
          console.log("SSH key already exists, skipping generation.");
        }

        // Print public key
        const pubKey = await runOrFail(
          executor,
          { node, command: ["cat", "~/.ssh/id_ed25519.pub"] },
          "Failed to read public key"
        );

        console.log("\nPublic key:\n");
        console.log(pubKey.stdout.trim());
        console.log(
          "\nAdd this as a deploy key on GitHub:"
        );
        console.log(
          "  Repo → Settings → Deploy keys → Add deploy key"
        );
        console.log("  Check 'Allow write access'\n");

        // Accept GitHub host key
        console.log("Accepting GitHub host key...");
        await executor.execute({
          node,
          command: [
            "ssh",
            "-o", "StrictHostKeyChecking=accept-new",
            "-T", "git@github.com",
            "2>&1", "||", "true",
          ],
        });
        console.log("Done.");
      } catch (e) {
        if (e instanceof RemoteError) {
          console.error(e.message);
          process.exit(1);
        }
        throw e;
      }
    });

  // --- setup ---
  nodeCmd
    .command("setup")
    .description("Bootstrap the ralph environment on a remote node")
    .argument("<node>", "Node name")
    .option("--git-name <name>", "Git user name")
    .option("--git-email <email>", "Git user email")
    .option("--api-key <key>", "Anthropic API key")
    .requiredOption(
      "--ralph-repo <url>",
      "Git URL of the Ralph repository to clone on the node"
    )
    .action(
      async (
        node: string,
        opts: {
          gitName?: string;
          gitEmail?: string;
          apiKey?: string;
          ralphRepo: string;
        }
      ) => {
        const executor = new SshRemoteExecutor(clientConfig);

        try {
          // 1. Check/install Bun
          const bunCheck = await executor.execute({
            node,
            command: ["which", "bun"],
          });
          if (bunCheck.exitCode !== 0) {
            console.log("Installing Bun...");
            await runOrFail(
              executor,
              {
                node,
                command: [
                  "bash",
                  "-c",
                  '"curl -fsSL https://bun.sh/install | bash"',
                ],
              },
              "Failed to install Bun"
            );
            console.log("Bun installed.");
          } else {
            console.log(
              `Bun already installed: ${bunCheck.stdout.trim()}`
            );
          }

          // 2. Check/install Ralph
          const ralphCheck = await executor.execute({
            node,
            command: ["which", "ralph"],
          });
          if (ralphCheck.exitCode !== 0) {
            console.log(`Installing Ralph from ${opts.ralphRepo}...`);
            const ralphRepoUrl = opts.ralphRepo;
            await runOrFail(
              executor,
              {
                node,
                command: [
                  "bash",
                  "-c",
                  `"mkdir -p ${TOOLS_DIR} && git clone ${ralphRepoUrl} ${TOOLS_DIR}/ralph && cd ${TOOLS_DIR}/ralph && ~/.bun/bin/bun install && ~/.bun/bin/bun link"`,
                ],
              },
              "Failed to install Ralph"
            );
            console.log("Ralph installed.");
          } else {
            console.log(
              `Ralph already installed: ${ralphCheck.stdout.trim()}`
            );
          }

          // 3. Git config
          if (opts.gitName) {
            console.log(`Setting git user.name to "${opts.gitName}"...`);
            await runOrFail(
              executor,
              {
                node,
                command: [
                  "git",
                  "config",
                  "--global",
                  "user.name",
                  `"${opts.gitName}"`,
                ],
              },
              "Failed to set git user.name"
            );
          }
          if (opts.gitEmail) {
            console.log(`Setting git user.email to "${opts.gitEmail}"...`);
            await runOrFail(
              executor,
              {
                node,
                command: [
                  "git",
                  "config",
                  "--global",
                  "user.email",
                  opts.gitEmail,
                ],
              },
              "Failed to set git user.email"
            );
          }

          // 4. Create projects dir
          console.log("Ensuring ~/projects exists...");
          await runOrFail(
            executor,
            { node, command: ["mkdir", "-p", PROJECTS_DIR] },
            "Failed to create projects directory"
          );

          // 5. API key
          if (opts.apiKey) {
            console.log("Configuring ANTHROPIC_API_KEY...");
            await runOrFail(
              executor,
              {
                node,
                command: [
                  "bash",
                  "-c",
                  `"grep -q ANTHROPIC_API_KEY ~/.bashrc 2>/dev/null || echo 'export ANTHROPIC_API_KEY=\"${opts.apiKey}\"' >> ~/.bashrc"`,
                ],
              },
              "Failed to configure API key"
            );
          }

          console.log("Setup complete.");
        } catch (e) {
          if (e instanceof RemoteError) {
            console.error(e.message);
            process.exit(1);
          }
          throw e;
        }
      }
    );

  // --- clone ---
  nodeCmd
    .command("clone")
    .description("Clone a project repo on a remote node and initialize Ralph")
    .argument("<node>", "Node name")
    .argument("<repo-url>", "Git repository URL")
    .option("--name <name>", "Project directory name (derived from URL if omitted)")
    .action(async (node: string, repoUrl: string, opts: { name?: string }) => {
      const executor = new SshRemoteExecutor(clientConfig);
      const projectName = opts.name ?? deriveProjectName(repoUrl);

      try {
        // 1. Check target doesn't already exist
        const existsCheck = await executor.execute({
          node,
          command: ["test", "-d", `${PROJECTS_DIR}/${projectName}`],
        });
        if (existsCheck.exitCode === 0) {
          throw new RemoteError(
            `Directory ${PROJECTS_DIR}/${projectName} already exists on ${node}`,
            node
          );
        }

        // 2. Clone with streaming output
        console.log(`Cloning ${repoUrl} into ${PROJECTS_DIR}/${projectName}...`);
        for await (const line of executor.stream({
          node,
          command: [
            "bash",
            "-c",
            `"cd ${PROJECTS_DIR} && git clone ${repoUrl} ${projectName} 2>&1"`,
          ],
        })) {
          console.log(line);
        }

        // 3. Verify clone succeeded
        const verifyCheck = await executor.execute({
          node,
          command: ["test", "-d", `${PROJECTS_DIR}/${projectName}`],
        });
        if (verifyCheck.exitCode !== 0) {
          throw new RemoteError(
            `Clone appeared to succeed but directory not found`,
            node
          );
        }

        // 4. Initialize Ralph
        console.log("Initializing Ralph project...");
        await runOrFail(
          executor,
          {
            node,
            command: ["ralph", "init", "project", projectName],
            cwd: `${PROJECTS_DIR}/${projectName}`,
          },
          "Failed to initialize Ralph project"
        );

        // 5. Sync types
        console.log("Syncing built-in types...");
        await runOrFail(
          executor,
          {
            node,
            command: ["ralph", "sync"],
            cwd: `${PROJECTS_DIR}/${projectName}`,
          },
          "Failed to sync built-in types"
        );

        console.log(`Project "${projectName}" ready at ${PROJECTS_DIR}/${projectName}`);
      } catch (e) {
        if (e instanceof RemoteError) {
          console.error(e.message);
          process.exit(1);
        }
        throw e;
      }
    });

  // --- projects ---
  nodeCmd
    .command("projects")
    .description("List Ralph projects on a remote node")
    .argument("<node>", "Node name")
    .action(async (node: string) => {
      const executor = new SshRemoteExecutor(clientConfig);

      try {
        const script = [
          `for dir in ${PROJECTS_DIR}/*/; do`,
          '  [ -d "$dir" ] || continue;',
          '  name=$(basename "$dir");',
          '  pjson="$dir/.ralph/project.json";',
          '  sjson="$dir/.ralph-local/state.json";',
          '  if [ -f "$pjson" ]; then',
          '    phase="idle"; iteration="0";',
          '    if [ -f "$sjson" ]; then',
          // Use grep/sed to extract values without jq dependency
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
          node,
          command: ["bash", "-c", `'${script}'`],
        });

        if (result.exitCode !== 0) {
          throw new RemoteError(
            `Failed to list projects: ${result.stderr.trim()}`,
            node
          );
        }

        const lines = result.stdout.trim().split("\n").filter(Boolean);

        if (lines.length === 0) {
          console.log("No Ralph projects found.");
          return;
        }

        // Print table
        const header = { name: "NAME", path: "PATH", phase: "PHASE", iteration: "ITERATION" };
        const rows = lines.map((line) => {
          const [name, path, phase, iteration] = line.split("|");
          return { name, path, phase, iteration };
        });

        const colWidths = {
          name: Math.max(header.name.length, ...rows.map((r) => r.name.length)),
          path: Math.max(header.path.length, ...rows.map((r) => r.path.length)),
          phase: Math.max(header.phase.length, ...rows.map((r) => r.phase.length)),
          iteration: Math.max(header.iteration.length, ...rows.map((r) => r.iteration.length)),
        };

        const fmt = (row: typeof header) =>
          `${row.name.padEnd(colWidths.name)}  ${row.path.padEnd(colWidths.path)}  ${row.phase.padEnd(colWidths.phase)}  ${row.iteration}`;

        console.log(fmt(header));
        for (const row of rows) {
          console.log(fmt(row));
        }
      } catch (e) {
        if (e instanceof RemoteError) {
          console.error(e.message);
          process.exit(1);
        }
        throw e;
      }
    });
}
