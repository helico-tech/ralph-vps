import { join } from "node:path";
import type { Command } from "commander";
import { LoopEngine, type LoopEngineDeps } from "../../domain/loop-engine";
import { FsTaskRepository } from "../../adapters/fs-task-repository";
import { PriorityTaskSelector } from "../../adapters/priority-task-selector";
import { TemplatePromptCompiler } from "../../adapters/template-prompt-compiler";
import { ClaudeProcessRunner } from "../../adapters/claude-process-runner";
import { GitProgressDetector } from "../../adapters/git-progress-detector";
import { JsonLogStore } from "../../adapters/json-log-store";
import { FsTypeResolver } from "../../adapters/fs-type-resolver";
import { FsConfigProvider } from "../../adapters/fs-config-provider";
import { ShellGitSynchronizer } from "../../adapters/shell-git-synchronizer";
import { STATE_FILE } from "../../constants";

export function registerLoopCommands(
  program: Command,
  projectRoot: string
): void {
  const loop = program
    .command("loop")
    .description("Manage the autonomous loop");

  loop
    .command("start")
    .description("Start the loop in a tmux session")
    .action(async () => {
      const configProvider = new FsConfigProvider();
      const projectConfig = await configProvider.loadProjectConfig(projectRoot);
      const projectName = projectConfig?.name ?? "unnamed";
      const sessionName = `ralph-${projectName}`;

      // Check if session already exists
      const check = Bun.spawnSync(
        ["tmux", "has-session", "-t", sessionName],
        { stdout: "pipe", stderr: "pipe" }
      );
      if (check.exitCode === 0) {
        console.error(`Loop already running in tmux session "${sessionName}"`);
        process.exit(1);
      }

      // Start tmux session running loop run
      const ralphBin = process.argv[1];
      Bun.spawnSync(
        ["tmux", "new-session", "-d", "-s", sessionName, "bun", "run", ralphBin, "loop", "run"],
        { cwd: projectRoot, stdout: "pipe", stderr: "pipe" }
      );

      console.log(`Loop started in tmux session "${sessionName}"`);
      console.log(`  Attach: ralph loop attach`);
      console.log(`  Stop:   ralph loop stop`);
    });

  loop
    .command("run")
    .description("Run the loop (internal — use 'loop start' instead)")
    .action(async () => {
      const configProvider = new FsConfigProvider();
      const projectConfig = await configProvider.loadProjectConfig(projectRoot);
      if (!projectConfig) {
        console.error("Not in a Ralph project.");
        process.exit(1);
      }

      const deps: LoopEngineDeps = {
        taskRepository: new FsTaskRepository(projectRoot),
        taskSelector: new PriorityTaskSelector(),
        promptCompiler: new TemplatePromptCompiler(),
        processRunner: new ClaudeProcessRunner(),
        progressDetector: new GitProgressDetector(),
        gitSynchronizer: new ShellGitSynchronizer(),
        logStore: new JsonLogStore(projectRoot),
        typeResolver: new FsTypeResolver(projectRoot),
        projectName: projectConfig.name,
        projectRoot,
        circuitBreakerConfig: projectConfig.circuitBreakers,
        reviewAfterCompletion: projectConfig.reviewAfterCompletion,
        onIterationComplete: (status, result) => {
          console.log(
            `[iter ${status.iteration}] ${result.success ? "OK" : "FAIL"} — ` +
            `${result.tokensUsed} tokens, $${result.costUsd.toFixed(4)}, ` +
            `${result.commitsMade} commits`
          );
        },
      };

      const engine = new LoopEngine(deps);
      const controller = new AbortController();

      process.on("SIGINT", () => {
        console.log("\nStopping loop...");
        controller.abort();
      });

      console.log(`Loop starting for project "${projectConfig.name}"`);
      const reason = await engine.run(controller.signal);
      console.log(`Loop stopped: ${reason}`);

      // Write final state
      const stateFile = join(projectRoot, STATE_FILE);
      await Bun.write(stateFile, JSON.stringify(engine.getStatus(), null, 2));
    });

  loop
    .command("stop")
    .description("Stop the running loop")
    .action(async () => {
      const configProvider = new FsConfigProvider();
      const projectConfig = await configProvider.loadProjectConfig(projectRoot);
      const projectName = projectConfig?.name ?? "unnamed";
      const sessionName = `ralph-${projectName}`;

      // Send C-c
      Bun.spawnSync(
        ["tmux", "send-keys", "-t", sessionName, "C-c", ""],
        { stdout: "pipe", stderr: "pipe" }
      );

      // Wait a bit, then check
      await Bun.sleep(2000);
      const check = Bun.spawnSync(
        ["tmux", "has-session", "-t", sessionName],
        { stdout: "pipe", stderr: "pipe" }
      );

      if (check.exitCode === 0) {
        // Force kill
        Bun.spawnSync(
          ["tmux", "kill-session", "-t", sessionName],
          { stdout: "pipe", stderr: "pipe" }
        );
        console.log(`Loop force-killed in session "${sessionName}"`);
      } else {
        console.log(`Loop stopped in session "${sessionName}"`);
      }
    });

  loop
    .command("status")
    .description("Show loop status")
    .action(async () => {
      const stateFile = join(projectRoot, STATE_FILE);
      const file = Bun.file(stateFile);

      if (!(await file.exists())) {
        console.log("No loop state found. Loop may not have run yet.");
        return;
      }

      const state = await file.json();
      console.log(`Phase:            ${state.phase}`);
      console.log(`Iteration:        ${state.iteration}`);
      console.log(`Current task:     ${state.currentTaskId ?? "none"}`);
      console.log(`Total tokens:     ${state.totalTokens}`);
      console.log(`Total cost:       $${state.totalCostUsd?.toFixed(4) ?? "0.0000"}`);
      console.log(`Consec. errors:   ${state.consecutiveErrors}`);
      console.log(`Consec. stalls:   ${state.consecutiveStalls}`);
      console.log(`Started at:       ${state.startedAt}`);
      console.log(`Last iteration:   ${state.lastIterationAt ?? "never"}`);
    });

  loop
    .command("attach")
    .description("Attach to the loop tmux session")
    .action(async () => {
      const configProvider = new FsConfigProvider();
      const projectConfig = await configProvider.loadProjectConfig(projectRoot);
      const projectName = projectConfig?.name ?? "unnamed";
      const sessionName = `ralph-${projectName}`;

      const proc = Bun.spawn(["tmux", "attach-session", "-t", sessionName], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
    });
}
