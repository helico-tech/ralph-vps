// Mock source control — records calls, configurable push behavior

import type { SourceControl } from "../../ports/source-control.js";

export class MockSourceControl implements SourceControl {
  readonly commits: string[] = [];
  readonly staged: string[][] = [];
  readonly branches: string[] = [];
  readonly checkouts: string[] = [];
  readonly deletedBranches: string[] = [];
  stageTrackedCalls = 0;
  private _pushFails = false;
  private _commitHash = "abc1234";
  private _changedFiles: string[] = [];

  setPushFails(fails: boolean): void { this._pushFails = fails; }
  setCommitHash(hash: string): void { this._commitHash = hash; }
  setChangedFiles(files: string[]): void { this._changedFiles = files; }

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
  async changedFiles(): Promise<string[]> { return [...this._changedFiles]; }

  async deleteBranch(name: string, _options?: { remote?: boolean }): Promise<void> {
    this.deletedBranches.push(name);
  }

  async listBranches(): Promise<string[]> { return [...this.branches]; }
}
