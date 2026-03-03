// Mock verifier — configurable pass/fail results, records calls

import type { Verifier } from "../../ports/verifier.js";
import type { VerificationResult } from "../../core/types.js";

const PASS: VerificationResult = { passed: true, skipped: false, output: "", command: "" };

export class MockVerifier implements Verifier {
  readonly calls: { method: string; command: string }[] = [];
  private _testResult: VerificationResult = { ...PASS };
  private _buildResult: VerificationResult = { ...PASS };
  private _lintResult: VerificationResult = { ...PASS };

  setTestResult(result: Partial<VerificationResult>): void {
    this._testResult = { ...PASS, ...result };
  }

  setBuildResult(result: Partial<VerificationResult>): void {
    this._buildResult = { ...PASS, ...result };
  }

  setLintResult(result: Partial<VerificationResult>): void {
    this._lintResult = { ...PASS, ...result };
  }

  async runTests(command: string): Promise<VerificationResult> {
    this.calls.push({ method: "runTests", command });
    return { ...this._testResult, command };
  }

  async runBuild(command: string): Promise<VerificationResult> {
    this.calls.push({ method: "runBuild", command });
    return { ...this._buildResult, command };
  }

  async runLint(command: string): Promise<VerificationResult> {
    this.calls.push({ method: "runLint", command });
    return { ...this._lintResult, command };
  }
}
