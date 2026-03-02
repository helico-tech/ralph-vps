import type { ProcessRunner, ProcessRunOptions, ProcessRunResult } from "../ports/process-runner";

interface StreamJsonEvent {
  type: string;
  [key: string]: unknown;
}

export class ClaudeProcessRunner implements ProcessRunner {
  async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    const startTime = Date.now();

    const args = [
      "-p", options.prompt,
      ...options.flags,
    ];

    const proc = Bun.spawn(["claude", ...args], {
      cwd: options.cwd,
      stdout: "pipe",
      stderr: "pipe",
      signal: options.signal,
    });

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let toolCalls = 0;
    let model = "unknown";
    let error: string | undefined;

    // Read stdout line by line (stream-json format)
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as StreamJsonEvent;
            const parsed = parseStreamEvent(event);
            inputTokens += parsed.inputTokens;
            outputTokens += parsed.outputTokens;
            cacheReadTokens += parsed.cacheReadTokens;
            cacheWriteTokens += parsed.cacheWriteTokens;
            toolCalls += parsed.toolCalls;
            if (parsed.model) model = parsed.model;
            if (parsed.error) error = parsed.error;
          } catch {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const exitCode = await proc.exited;
    const durationMs = Date.now() - startTime;

    if (exitCode !== 0 && !error) {
      const stderr = await new Response(proc.stderr).text();
      error = stderr.trim() || `Process exited with code ${exitCode}`;
    }

    return {
      exitCode,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      toolCalls,
      model,
      durationMs,
      error,
    };
  }
}

interface ParsedEvent {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  model: string | null;
  error: string | null;
}

function parseStreamEvent(event: StreamJsonEvent): ParsedEvent {
  const result: ParsedEvent = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: 0,
    model: null,
    error: null,
  };

  if (event.type === "message" && event.message) {
    const msg = event.message as Record<string, unknown>;
    if (msg.model) result.model = msg.model as string;

    if (msg.usage) {
      const usage = msg.usage as Record<string, number>;
      result.inputTokens = usage.input_tokens ?? 0;
      result.outputTokens = usage.output_tokens ?? 0;
      result.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      result.cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
    }
  }

  if (event.type === "content_block_start") {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (block?.type === "tool_use") {
      result.toolCalls = 1;
    }
  }

  if (event.type === "error") {
    result.error = (event.error as Record<string, string>)?.message ?? "Unknown error";
  }

  return result;
}
