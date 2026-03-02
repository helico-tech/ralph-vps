export interface SyncResult {
  success: boolean;
  error?: string;
  conflictDetails?: string;
}

export interface GitSynchronizer {
  pull(cwd: string): Promise<SyncResult>;
  commitAndPush(cwd: string, message: string): Promise<SyncResult>;
  isClean(cwd: string): Promise<boolean>;
  getCurrentHash(cwd: string): Promise<string>;
}
