// Claude CLI executor — shells out to `claude` via Bun.spawn

import { join } from "path";
import type { AgentExecutor } from "../ports/agent-executor.js";
import type { ExecutionPlan, ExecutionResult, StopReason } from "../core/types.js";
import { ExecutionError, ERROR_CODES } from "../core/errors.js";

interface ClaudeJsonOutput {
  type?: string;
  subtype?: string;
  result?: string;
  session_id?: string;
  is_error?: boolean;
}

export class ClaudeCliExecutor implements AgentExecutor {
  async execute(plan: ExecutionPlan): Promise<ExecutionResult> {
    const { args, tempFile } = await this.buildArgs(plan);

    let stdout: string;
    let exitCode: number;

    try {
      const proc = Bun.spawn(["claude", ...args], {
        cwd: plan.working_directory,
        stdout: "pipe",
        stderr: "inherit",
      });

      const work = Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ]);

      const timeout = new Promise<never>((_resolve, reject) =>
        setTimeout(() => {
          proc.kill();
          reject(
            new ExecutionError(
              ERROR_CODES.EXECUTION_TIMEOUT,
              `Claude CLI timed out after ${plan.timeout_ms}ms`,
              true,
            ),
          );
        }, plan.timeout_ms),
      );

      [stdout, exitCode] = await Promise.race([work, timeout]);
    } catch (err) {
      if (err instanceof ExecutionError) throw err;
      throw new ExecutionError(
        ERROR_CODES.EXECUTION_FAILED,
        `Failed to spawn claude: ${(err as Error).message}`,
      );
    } finally {
      if (tempFile) {
        try { await Bun.file(tempFile).delete(); } catch { /* best effort cleanup */ }
      }
    }

    if (exitCode === 124 || exitCode === 137) {
      throw new ExecutionError(
        ERROR_CODES.EXECUTION_TIMEOUT,
        `Claude killed by signal (exit ${exitCode})`,
        true,
      );
    }

    let parsed: ClaudeJsonOutput;
    try {
      parsed = JSON.parse(stdout) as ClaudeJsonOutput;
    } catch {
      throw new ExecutionError(
        ERROR_CODES.INVALID_OUTPUT,
        `Claude produced non-JSON output (exit ${exitCode}): ${stdout.slice(0, 200)}`,
      );
    }

    const stopReason = this.mapStopReason(exitCode, parsed);

    return {
      stop_reason: stopReason,
      output: parsed.result ?? "",
    };
  }

  private async buildArgs(plan: ExecutionPlan): Promise<{ args: string[]; tempFile: string | null }> {
    const args: string[] = [
      "-p", plan.prompt,
      "--output-format", "json",
      "--max-turns", String(plan.max_turns),
      "--model", plan.model,
    ];

    let tempFile: string | null = null;
    if (plan.system_prompt) {
      tempFile = join(plan.working_directory, ".ralph", "system-prompt-active.md");
      await Bun.write(tempFile, plan.system_prompt);
      args.push("--append-system-prompt-file", tempFile);
    }

    if (plan.permission_mode === "skip_all") {
      args.push("--dangerously-skip-permissions");
    }

    return { args, tempFile };
  }

  private mapStopReason(exitCode: number, output: ClaudeJsonOutput): StopReason {
    if (output.subtype === "max_turns") return "max_turns";
    if (output.is_error) return "error";
    if (exitCode !== 0) return "error";
    return "end_turn";
  }
}
