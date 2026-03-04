// Mock source control — records calls, configurable push behavior

import type { SourceControl } from "../../ports/source-control.js";

export class MockSourceControl implements SourceControl {
  readonly commits: string[] = [];
  readonly staged: string[][] = [];
  readonly branches: string[] = [];
  readonly checkouts: string[] = [];
  readonly deletedBranches: string[] = [];
  readonly mergedBranches: string[] = [];
  stageTrackedCalls = 0;
  stageAllCalls = 0;
  private _pushFails = false;
  private _mergeFails = false;
  private _commitHash = "abc1234";
  private _changedFiles: string[] = [];
  private _lastCommit: { sha: string; timestamp: string; message: string } | null = {
    sha: "abc1234",
    timestamp: "2026-03-03T12:00:00Z",
    message: "test commit",
  };

  setPushFails(fails: boolean): void { this._pushFails = fails; }
  setMergeFails(fails: boolean): void { this._mergeFails = fails; }
  setCommitHash(hash: string): void { this._commitHash = hash; }
  setChangedFiles(files: string[]): void { this._changedFiles = files; }
  setLastCommit(commit: { sha: string; timestamp: string; message: string } | null): void {
    this._lastCommit = commit;
  }

  async pull(): Promise<void> {}

  async commit(message: string): Promise<string> {
    this.commits.push(message);
    return this._commitHash;
  }

  async push(): Promise<boolean> { return !this._pushFails; }
  async pushBranch(_branch: string): Promise<boolean> { return !this._pushFails; }

  async createBranch(name: string): Promise<void> { this.branches.push(name); }
  async checkout(branch: string): Promise<void> { this.checkouts.push(branch); }

  async stageFiles(paths: string[]): Promise<void> { this.staged.push([...paths]); }
  async stageTracked(): Promise<void> { this.stageTrackedCalls++; }
  async stageAll(): Promise<void> { this.stageAllCalls++; }
  async changedFiles(): Promise<string[]> { return [...this._changedFiles]; }

  async deleteBranch(name: string, _options?: { remote?: boolean }): Promise<void> {
    this.deletedBranches.push(name);
    const idx = this.branches.indexOf(name);
    if (idx !== -1) this.branches.splice(idx, 1);
  }

  async listBranches(): Promise<string[]> { return [...this.branches]; }

  async merge(branch: string, _options?: { ffOnly?: boolean }): Promise<void> {
    if (this._mergeFails) throw new Error("merge conflict");
    this.mergedBranches.push(branch);
  }

  async lastCommit(): Promise<{ sha: string; timestamp: string; message: string } | null> {
    return this._lastCommit ? { ...this._lastCommit } : null;
  }
}
