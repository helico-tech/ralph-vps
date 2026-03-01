#!/usr/bin/env node
//
// ralph-collector.js — Transform Claude stream-json output into human-readable log lines
//
// Reads stream-json (newline-delimited JSON) from stdin, writes formatted output to stdout.
// Reads RALPH_ITERATION env var to prefix output with iteration number.
//

const readline = require("readline");

const iteration = process.env.RALPH_ITERATION || "?";

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function prefix() {
  return `[iter:${iteration} ${timestamp()}]`;
}

function truncate(text, maxLen = 200) {
  if (!text) return "";
  const oneLine = text.replace(/\n/g, " ").trim();
  return oneLine.length > maxLen
    ? oneLine.substring(0, maxLen) + "..."
    : oneLine;
}

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on("line", (line) => {
  if (!line.trim()) return;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    // Not JSON — pass through as-is
    console.log(`${prefix()} ${line}`);
    return;
  }

  const type = event.type;

  if (type === "assistant" && event.message?.content) {
    for (const block of event.message.content) {
      if (block.type === "text" && block.text) {
        console.log(`${prefix()} ${truncate(block.text)}`);
      }
    }
  } else if (type === "content_block_delta") {
    // Streaming text delta — only log substantial text blocks
    if (event.delta?.type === "text_delta" && event.delta.text) {
      const text = event.delta.text.trim();
      if (text.length > 50) {
        console.log(`${prefix()} ${truncate(text)}`);
      }
    }
  } else if (type === "tool_use") {
    const name = event.name || event.tool?.name || "unknown";
    let detail = "";
    if (event.input) {
      if (name === "Bash" && event.input.command) {
        detail = `: ${truncate(event.input.command, 100)}`;
      } else if (name === "Read" && event.input.file_path) {
        detail = ` ${event.input.file_path}`;
      } else if (name === "Edit" && event.input.file_path) {
        detail = ` ${event.input.file_path}`;
      } else if (name === "Write" && event.input.file_path) {
        detail = ` ${event.input.file_path}`;
      } else if (name === "Grep" && event.input.pattern) {
        detail = `: ${event.input.pattern}`;
      } else if (name === "Glob" && event.input.pattern) {
        detail = `: ${event.input.pattern}`;
      }
    }
    console.log(`${prefix()} \uD83D\uDD27 ${name}${detail}`);
  } else if (type === "tool_result" || type === "result") {
    if (event.is_error || event.error) {
      const errMsg =
        event.error?.message || event.content || "unknown error";
      console.log(
        `${prefix()} \u274C Tool error: ${truncate(String(errMsg))}`,
      );
    }
  } else if (type === "error") {
    const errMsg = event.error?.message || JSON.stringify(event.error) || "unknown error";
    console.log(`${prefix()} \u274C Error: ${truncate(errMsg)}`);
  } else if (type === "message_start" && event.message?.usage) {
    const usage = event.message.usage;
    console.log(
      `${prefix()} \uD83D\uDCCA Tokens: input=${usage.input_tokens || 0} output=${usage.output_tokens || 0}`,
    );
  } else if (type === "message_delta" && event.usage) {
    console.log(
      `${prefix()} \uD83D\uDCCA Final tokens: output=${event.usage.output_tokens || 0}`,
    );
  }
});

rl.on("close", () => {
  console.log(`${prefix()} --- Stream ended ---`);
});

process.on("SIGPIPE", () => {
  process.exit(0);
});
