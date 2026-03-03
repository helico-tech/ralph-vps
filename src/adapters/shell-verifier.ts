// Shell verifier — runs test/build/lint commands via sh -c

import type { Verifier } from "../ports/verifier.js";
import type { VerificationResult } from "../core/types.js";

export class ShellVerifier implements Verifier {
  constructor(private readonly cwd: string) {}

  async runTests(command: string): Promise<VerificationResult> {
    return this.run(command);
  }

  async runBuild(command: string): Promise<VerificationResult> {
    return this.run(command);
  }

  async runLint(command: string): Promise<VerificationResult> {
    return this.run(command);
  }

  private async run(command: string): Promise<VerificationResult> {
    const trimmed = command.trim();
    if (!trimmed) {
      return { passed: true, skipped: true, output: "", command: "" };
    }

    try {
      const proc = Bun.spawn(["sh", "-c", trimmed], {
        cwd: this.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      const output = [stdout, stderr].filter(Boolean).join("\n").trim();

      return {
        passed: exitCode === 0,
        skipped: false,
        output,
        command: trimmed,
      };
    } catch (err) {
      return {
        passed: false,
        skipped: false,
        output: `Failed to spawn: ${(err as Error).message}`,
        command: trimmed,
      };
    }
  }
}
