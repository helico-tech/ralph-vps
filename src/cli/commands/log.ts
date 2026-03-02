import type { Command } from "commander";
import { JsonLogStore } from "../../adapters/json-log-store";
import { aggregateStats } from "../../domain/log";

export function registerLogCommands(
  program: Command,
  projectRoot: string
): void {
  const log = program
    .command("log")
    .description("View iteration logs");

  const store = new JsonLogStore(projectRoot);

  log
    .command("list")
    .description("List recent iterations")
    .option("-n, --count <n>", "Number of recent logs", "10")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const logs = await store.readLatest(parseInt(opts.count, 10));

      if (opts.json) {
        console.log(JSON.stringify(logs, null, 2));
        return;
      }

      if (logs.length === 0) {
        console.log("No iteration logs found.");
        return;
      }

      for (const l of logs) {
        const status = l.success ? "OK" : "FAIL";
        console.log(
          `[${l.iteration}] ${status} — ${l.taskTitle} | ${l.durationMs}ms | ` +
          `${l.inputTokens + l.outputTokens} tokens | $${l.costUsd.toFixed(4)} | ` +
          `${l.commitsMade} commits`
        );
      }
    });

  log
    .command("show")
    .description("Show a specific iteration")
    .argument("<iteration>", "Iteration number")
    .option("--json", "Output as JSON")
    .action(async (iteration: string, opts) => {
      const iterLog = await store.readByIteration(parseInt(iteration, 10));

      if (!iterLog) {
        console.log(`No log found for iteration ${iteration}.`);
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(iterLog, null, 2));
        return;
      }

      console.log(`Iteration:    ${iterLog.iteration}`);
      console.log(`Task:         ${iterLog.taskTitle} (${iterLog.taskId})`);
      console.log(`Type:         ${iterLog.type}`);
      console.log(`Status:       ${iterLog.success ? "Success" : "Failed"}`);
      console.log(`Duration:     ${(iterLog.durationMs / 1000).toFixed(1)}s`);
      console.log(`Model:        ${iterLog.model}`);
      console.log(`Tokens:       ${iterLog.inputTokens} in / ${iterLog.outputTokens} out`);
      console.log(`Tool calls:   ${iterLog.toolCalls}`);
      console.log(`Cost:         $${iterLog.costUsd.toFixed(4)}`);
      console.log(`Commits:      ${iterLog.commitsMade}`);
      console.log(`Files:        ${iterLog.filesChanged}`);
      if (iterLog.error) {
        console.log(`Error:        ${iterLog.error}`);
      }
    });

  log
    .command("stats")
    .description("Show aggregate statistics")
    .action(async () => {
      const logs = await store.listAll();
      const stats = aggregateStats(logs);

      if (stats.totalIterations === 0) {
        console.log("No iteration logs found.");
        return;
      }

      console.log(`Total iterations:    ${stats.totalIterations}`);
      console.log(`Successful:          ${stats.successfulIterations}`);
      console.log(`Failed:              ${stats.failedIterations}`);
      console.log(`Error rate:          ${(stats.errorRate * 100).toFixed(1)}%`);
      console.log(`Total tokens:        ${stats.totalTokens}`);
      console.log(`Total cost:          $${stats.totalCostUsd.toFixed(4)}`);
      console.log(`Avg duration:        ${(stats.avgDurationMs / 1000).toFixed(1)}s`);
      console.log(`Avg tokens/iter:     ${Math.round(stats.avgTokensPerIteration)}`);
      console.log(`Total commits:       ${stats.totalCommits}`);
      console.log(`Total files changed: ${stats.totalFilesChanged}`);
    });

  log
    .command("errors")
    .description("Show only failed iterations")
    .action(async () => {
      const logs = await store.listAll();
      const errors = logs.filter((l) => !l.success);

      if (errors.length === 0) {
        console.log("No errors found.");
        return;
      }

      for (const l of errors) {
        console.log(`[${l.iteration}] ${l.taskTitle}: ${l.error ?? "unknown error"}`);
      }
    });

  log
    .command("tools")
    .description("Show tool call counts")
    .action(async () => {
      const logs = await store.listAll();

      if (logs.length === 0) {
        console.log("No iteration logs found.");
        return;
      }

      const totalTools = logs.reduce((sum, l) => sum + l.toolCalls, 0);
      console.log(`Total tool calls:   ${totalTools}`);
      console.log(`Avg per iteration:  ${(totalTools / logs.length).toFixed(1)}`);
    });
}
