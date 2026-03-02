export interface PreState {
  commitHash: string;
  taskFileHashes: Record<string, string>;
}

export interface ProgressResult {
  commitsMade: number;
  filesChanged: number;
  isDirty: boolean;
  newCommitHash: string;
}

export interface ProgressDetector {
  recordPreState(cwd: string): Promise<PreState>;
  detectProgress(cwd: string, preState: PreState): Promise<ProgressResult>;
}
