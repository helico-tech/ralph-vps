// Source control port — git operations for the orchestrator
// Implementations: src/adapters/git-source-control.ts

export interface SourceControl {
  /** Fetch and fast-forward merge current branch. */
  pull(): Promise<void>;

  /** Commit staged changes. Returns the commit SHA. */
  commit(message: string): Promise<string>;

  /** Push current branch to origin. Returns false on rejection. */
  push(): Promise<boolean>;

  /** Push a named branch to origin. Returns false on rejection. */
  pushBranch(branch: string): Promise<boolean>;

  /** Create and checkout a new branch from current HEAD. */
  createBranch(name: string): Promise<void>;

  /** Checkout an existing branch. */
  checkout(branch: string): Promise<void>;

  /** Stage specific file paths. Never stages untracked files outside this list. */
  stageFiles(paths: string[]): Promise<void>;

  /** Stage all tracked file modifications (git add -u). No untracked files. */
  stageTracked(): Promise<void>;

  /** Stage all changes including untracked files (git add -A). */
  stageAll(): Promise<void>;

  /** Return list of changed files relative to HEAD, including untracked. */
  changedFiles(): Promise<string[]>;

  /** Delete a local branch. Optionally delete the remote tracking branch too. */
  deleteBranch(name: string, options?: { remote?: boolean }): Promise<void>;

  /** List all local and remote branch names. */
  listBranches(): Promise<string[]>;

  /** Merge a branch into the current branch. Defaults to --no-ff. */
  merge(branch: string, options?: { ffOnly?: boolean }): Promise<void>;

  /** Get the last commit on the current branch. Returns null if no commits. */
  lastCommit(): Promise<{ sha: string; timestamp: string; message: string } | null>;
}
