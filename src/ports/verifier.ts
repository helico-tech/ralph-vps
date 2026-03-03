// Verifier port — post-execution verification (tests, build, lint)
// Implementations: src/adapters/shell-verifier.ts

import type { VerificationResult } from "../core/types.js";

export interface Verifier {
  /** Run the test command. Empty command returns a skipped result. */
  runTests(command: string): Promise<VerificationResult>;

  /** Run the build command. Empty command returns a skipped result. */
  runBuild(command: string): Promise<VerificationResult>;

  /** Run the lint command. Empty command returns a skipped result. */
  runLint(command: string): Promise<VerificationResult>;
}
