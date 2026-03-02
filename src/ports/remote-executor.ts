export interface RemoteExecuteOptions {
  node: string;
  command: string[];
  cwd?: string;
}

export interface RemoteExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RemoteExecutor {
  execute(options: RemoteExecuteOptions): Promise<RemoteExecuteResult>;
  stream(options: RemoteExecuteOptions): AsyncIterable<string>;
}
