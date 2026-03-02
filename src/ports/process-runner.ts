export interface ProcessRunOptions {
  prompt: string;
  flags: string[];
  cwd: string;
  signal?: AbortSignal;
}

export interface ProcessRunResult {
  exitCode: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  model: string;
  durationMs: number;
  error?: string;
}

export interface ProcessRunner {
  run(options: ProcessRunOptions): Promise<ProcessRunResult>;
}
