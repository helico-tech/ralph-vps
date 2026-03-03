# Deep Dive: Hexagonal Architecture & Domain Design

> By **core-arch** | 2026-03-03
>
> The structural backbone of Architecture B. Every line of code in this system
> belongs to exactly one of: core domain, port, adapter, or orchestrator.

---

## Table of Contents

1. [The Core Domain](#1-the-core-domain)
2. [The Ports (Interfaces)](#2-the-ports-interfaces)
3. [The Adapters](#3-the-adapters)
4. [The Orchestrator Loop](#4-the-orchestrator-loop)
5. [File/Module Structure](#5-filemodule-structure)
6. [The "No Ceremony" Test](#6-the-no-ceremony-test)
7. [Configuration](#7-configuration)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Testing Seams](#9-testing-seams)

---

## 1. The Core Domain

The core domain is **pure**. Zero imports from Node/Bun APIs. No `fs`, no
`child_process`, no `Bun.spawn`. If you can't run it in a browser, it doesn't
belong here. This is the part of the system that will never change because of
infrastructure decisions.

### Core Entities

```typescript
// core/types.ts

/** The 5 canonical states. Directory name = state name. */
type TaskStatus = "pending" | "active" | "review" | "done" | "failed";

/** Task priority. Lower number = higher priority. */
type Priority = number;

/** The task as parsed from a .ralph/tasks/<status>/<file>.md file. */
interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  type: TaskType;
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
  assignedTo: string | null;
  dependsOn: string[];
  retryCount: number;
  maxRetries: number;
  tags: string[];
  branch: string | null;
  needsReview: boolean;
  // Optional fields from frontmatter
  files?: string[];
  acceptanceCriteria?: string[];
  constraints?: string[];
  // The markdown body (everything below the frontmatter)
  body: string;
}

type TaskType = "bugfix" | "feature" | "refactor" | "test" | "research" | "default";

/** What came out of a Claude execution. */
interface ExecutionResult {
  exitCode: number;
  sessionId: string | null;
  costUsd: number | null;
  turnsUsed: number | null;
  durationMs: number;
  /** Why did Claude stop? */
  stopReason: "end_turn" | "max_turns" | "max_budget" | "refusal" | "error" | "timeout";
}

/** What came out of post-execution verification. */
interface VerificationResult {
  testsPass: boolean;
  buildPass: boolean;
  lintPass: boolean | null;  // null = no lint configured
  /** Combined: all configured checks passed. */
  verified: boolean;
  output: string;            // Captured stdout/stderr for logging
}

/** A prompt template with its source and variables. */
interface PromptTemplate {
  taskType: TaskType;
  templateBody: string;      // Raw template with {{variable}} placeholders
}
```

### Core Operations

These are **pure functions**. They take data in, return data out. No side
effects.

```typescript
// core/state-machine.ts

/** All legal state transitions. */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending:  ["active"],
  active:   ["review", "failed", "pending"],  // pending = retry
  review:   ["done", "pending"],              // pending = rejected
  done:     [],                               // terminal
  failed:   [],                               // terminal
};

interface TransitionContext {
  workerId?: string;
  now: string;              // ISO 8601 -- injected, not read from system
  retryCount?: number;
  branch?: string;
  reviewFeedback?: string;
}

/**
 * Pure state transition. Returns the updated task or throws.
 * Does NOT perform any I/O. Does NOT move files.
 */
function transitionTask(
  task: Task,
  to: TaskStatus,
  ctx: TransitionContext
): Task {
  const allowed = TRANSITIONS[task.status];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(task.id, task.status, to);
  }

  // Guard: can't go active without a worker
  if (to === "active" && !ctx.workerId) {
    throw new TransitionGuardError(task.id, "active requires workerId");
  }

  // Guard: retry means going back to pending with incremented count
  if (task.status === "active" && to === "pending") {
    if (task.retryCount >= task.maxRetries) {
      throw new TransitionGuardError(
        task.id,
        `retry count ${task.retryCount} >= max ${task.maxRetries}, should fail instead`
      );
    }
  }

  return {
    ...task,
    status: to,
    updatedAt: ctx.now,
    assignedTo: to === "active" ? (ctx.workerId ?? task.assignedTo) : null,
    retryCount: (task.status === "active" && to === "pending")
      ? task.retryCount + 1
      : task.retryCount,
    branch: ctx.branch ?? task.branch,
    body: ctx.reviewFeedback
      ? task.body + `\n\n## Review Feedback (${ctx.now})\n${ctx.reviewFeedback}`
      : task.body,
  };
}
```

```typescript
// core/task-queue.ts

/**
 * Given a list of all tasks across all statuses, return the next
 * eligible task to pick up. Pure function.
 *
 * Eligibility:
 *   1. Status is "pending"
 *   2. All depends_on tasks are in "done" status
 *   3. Sorted by priority ASC, then createdAt ASC, then id ASC
 */
function pickNextTask(allTasks: Task[]): Task | null {
  const doneTasks = new Set(
    allTasks.filter(t => t.status === "done").map(t => t.id)
  );

  const eligible = allTasks
    .filter(t => t.status === "pending")
    .filter(t => t.dependsOn.every(dep => doneTasks.has(dep)));

  if (eligible.length === 0) return null;

  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  return eligible[0];
}
```

```typescript
// core/prompt-builder.ts

/**
 * Build the final prompt string from a task and a template.
 * Pure string interpolation. No I/O.
 */
function buildPrompt(task: Task, template: PromptTemplate): string {
  let result = template.templateBody;

  // Simple variable interpolation
  result = result.replace(/\{\{id\}\}/g, task.id);
  result = result.replace(/\{\{title\}\}/g, task.title);
  result = result.replace(/\{\{description\}\}/g, task.body);

  // List interpolation: {{#field}}...{{.}}...{{/field}}
  result = interpolateList(result, "files", task.files ?? []);
  result = interpolateList(result, "acceptance_criteria", task.acceptanceCriteria ?? []);
  result = interpolateList(result, "constraints", task.constraints ?? []);

  return result;
}

function interpolateList(
  template: string,
  field: string,
  items: string[]
): string {
  const regex = new RegExp(
    `\\{\\{#${field}\\}\\}([\\s\\S]*?)\\{\\{/${field}\\}\\}`,
    "g"
  );
  return template.replace(regex, (_, inner) => {
    if (items.length === 0) return "";
    return items.map(item => inner.replace(/\{\{\.\}\}/g, item)).join("");
  });
}
```

```typescript
// core/consistency.ts

/**
 * Validate that a task's frontmatter status matches its directory location.
 * Returns a list of inconsistencies. Pure function.
 */
interface TaskLocation {
  task: Task;
  directory: TaskStatus;  // Which status directory the file lives in
}

function checkConsistency(locations: TaskLocation[]): string[] {
  const errors: string[] = [];

  for (const { task, directory } of locations) {
    if (task.status !== directory) {
      errors.push(
        `Task ${task.id}: frontmatter says "${task.status}" but file is in "${directory}/"`
      );
    }
  }

  // Check for dangling dependencies
  const allIds = new Set(locations.map(l => l.task.id));
  for (const { task } of locations) {
    for (const dep of task.dependsOn) {
      if (!allIds.has(dep)) {
        errors.push(
          `Task ${task.id}: depends_on "${dep}" which does not exist`
        );
      }
    }
  }

  return errors;
}
```

```typescript
// core/errors.ts

class RalphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RalphError";
  }
}

class InvalidTransitionError extends RalphError {
  constructor(
    public taskId: string,
    public from: TaskStatus,
    public to: TaskStatus
  ) {
    super(`Invalid transition for task ${taskId}: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

class TransitionGuardError extends RalphError {
  constructor(public taskId: string, reason: string) {
    super(`Transition guard failed for task ${taskId}: ${reason}`);
    this.name = "TransitionGuardError";
  }
}

class TaskParseError extends RalphError {
  constructor(public filePath: string, reason: string) {
    super(`Failed to parse task at ${filePath}: ${reason}`);
    this.name = "TaskParseError";
  }
}

class AdapterError extends RalphError {
  constructor(
    public adapter: string,
    public operation: string,
    reason: string
  ) {
    super(`Adapter error [${adapter}.${operation}]: ${reason}`);
    this.name = "AdapterError";
  }
}
```

### What the core does NOT contain

- No file I/O. The core doesn't know what a filesystem is.
- No git operations. The core doesn't know what git is.
- No process spawning. The core doesn't know what Claude CLI is.
- No timers or clocks. Time is injected via `TransitionContext.now`.
- No logging. Events are returned as data; the caller decides what to log.

This is not philosophical purity for its own sake. It means:
- Every core function is testable with zero setup (no temp dirs, no mocks).
- The core can't accidentally commit something it shouldn't.
- You can refactor adapters without touching domain logic.

---

## 2. The Ports (Interfaces)

Ports are TypeScript interfaces. They define what the core **needs** from the
outside world without specifying **how**. Each port should be as narrow as
possible -- one responsibility, minimal surface area.

```typescript
// ports/task-repository.ts

/**
 * Reads and writes task files. The core doesn't know if these are
 * on a filesystem, in a database, or in memory.
 */
interface TaskRepository {
  /** List all tasks across all status directories. */
  listAll(): Promise<Task[]>;

  /** Read a single task by ID. Returns null if not found. */
  findById(id: string): Promise<Task | null>;

  /**
   * Move a task from one status to another AND write updated frontmatter.
   * This is a single atomic operation (git mv + write + git add).
   */
  transition(task: Task, from: TaskStatus, to: TaskStatus): Promise<void>;

  /** Get the directory a task lives in (for consistency checks). */
  locateAll(): Promise<TaskLocation[]>;
}
```

```typescript
// ports/source-control.ts

/**
 * Git operations needed by the orchestrator. Deliberately narrow.
 * No `git rebase`, no `git cherry-pick`, no `git stash`.
 */
interface SourceControl {
  /** Pull latest from remote. Throws on conflict. */
  pull(): Promise<void>;

  /** Commit staged changes with a message. */
  commit(message: string): Promise<string>;  // returns commit hash

  /** Push current branch to remote. Returns false if rejected. */
  push(): Promise<boolean>;

  /** Push a named branch to remote. */
  pushBranch(branch: string): Promise<boolean>;

  /** Create and checkout a new branch from current HEAD. */
  createBranch(name: string): Promise<void>;

  /** Checkout an existing branch. */
  checkout(branch: string): Promise<void>;

  /** Stage specific files. Never `git add -A`. */
  stageFiles(paths: string[]): Promise<void>;

  /** Stage all tracked file modifications (git add -u). */
  stageTracked(): Promise<void>;

  /** Get list of changed files (tracked, unstaged + staged). */
  changedFiles(): Promise<string[]>;
}
```

```typescript
// ports/agent-executor.ts

/**
 * Runs Claude (or a mock) on a prompt. The core doesn't know
 * if this spawns a CLI process, calls an SDK, or returns canned data.
 */
interface AgentExecutor {
  execute(params: ExecutionParams): Promise<ExecutionResult>;
}

interface ExecutionParams {
  prompt: string;
  model: string;
  maxTurns: number;
  budgetUsd: number;
  timeoutMs: number;
  allowedTools: string[];
  systemPromptFile?: string;
}
```

```typescript
// ports/verifier.ts

/**
 * Runs post-execution checks (tests, build, lint).
 * The core doesn't know if this runs npm, bun, make, or cargo.
 */
interface Verifier {
  verify(commands: VerificationCommands): Promise<VerificationResult>;
}

interface VerificationCommands {
  test?: string;    // e.g. "bun test"
  build?: string;   // e.g. "bun run build"
  lint?: string;    // e.g. "bun run lint"
}
```

```typescript
// ports/logger.ts

/**
 * Structured event logging. The core emits events as data.
 * The adapter decides where they go (stdout, file, both).
 */
interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}
```

### Ports I intentionally did NOT create

**`Clock`** -- I considered a `Clock` port (for injecting time in tests), but
`TransitionContext.now` already handles this. The only place we need time is in
state transitions, and that time is passed as a parameter. Adding a `Clock`
port would mean every function that touches time needs an extra dependency.
The parameter approach is simpler and equally testable.

**`EventEmitter`** -- Considered an event bus for observability. Cut it. The
`Logger` port covers what we need for V1. An event system is premature until we
have multiple consumers of the same events. If observability needs grow, we
add it then.

**`TemplateLoader`** -- Considered a port for loading prompt templates from
disk. But templates are just strings. The orchestrator reads them at startup
and passes them to `buildPrompt()`. No need to abstract file reading behind
a port just for templates -- that's ceremony.

**`ConfigLoader`** -- Same reasoning. Config is loaded once at startup. The
orchestrator reads the file, parses it, and passes values where needed. A
port for "read a JSON file" is not pulling its weight.

**`Notifier`** -- For sending notifications (ntfy.sh, etc). Not in V1. The
consensus was pull-based status via git. When we add push notifications,
we add this port.

The rule: **if a port would have exactly one method that's called exactly
once, it's not a port -- it's a function call.**

---

## 3. The Adapters

Each port gets one or more concrete implementations. Adapters are where the
ugly reality lives: file paths, shell commands, process spawning, error
codes.

### 3.1 Git+Filesystem TaskRepository

```typescript
// adapters/fs-task-repository.ts

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

class FsTaskRepository implements TaskRepository {
  constructor(private basePath: string) {}  // e.g. ".ralph/tasks"

  async listAll(): Promise<Task[]> {
    const tasks: Task[] = [];
    for (const status of STATUSES) {
      const dir = `${this.basePath}/${status}`;
      const files = await readdir(dir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await readFile(`${dir}/${file}`, "utf-8");
        tasks.push(this.parseTaskFile(content, file, status));
      }
    }
    return tasks;
  }

  async findById(id: string): Promise<Task | null> {
    for (const status of STATUSES) {
      const dir = `${this.basePath}/${status}`;
      const files = await readdir(dir).catch(() => []);
      for (const file of files) {
        if (file.includes(id)) {
          const content = await readFile(`${dir}/${file}`, "utf-8");
          return this.parseTaskFile(content, file, status);
        }
      }
    }
    return null;
  }

  async transition(task: Task, from: TaskStatus, to: TaskStatus): Promise<void> {
    const filename = `${task.id}.md`;
    const fromPath = `${this.basePath}/${from}/${filename}`;
    const toPath = `${this.basePath}/${to}/${filename}`;

    // Write updated frontmatter + body to the new location.
    // The caller (orchestrator) is responsible for git mv + git add + git commit.
    // This adapter only handles the file content; git ops go through SourceControl.
    const content = this.serializeTask(task);
    await writeFile(toPath, content);
    await unlink(fromPath).catch(() => {});
  }

  async locateAll(): Promise<TaskLocation[]> {
    const locations: TaskLocation[] = [];
    for (const status of STATUSES) {
      const dir = `${this.basePath}/${status}`;
      const files = await readdir(dir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const content = await readFile(`${dir}/${file}`, "utf-8");
        const task = this.parseTaskFile(content, file, status);
        locations.push({ task, directory: status });
      }
    }
    return locations;
  }

  private parseTaskFile(content: string, filename: string, directory: TaskStatus): Task {
    const { frontmatter, body } = splitFrontmatter(content);
    const meta = parseYaml(frontmatter);

    if (!meta.id || !meta.title || !meta.status) {
      throw new TaskParseError(filename, "missing required fields: id, title, status");
    }

    return {
      id: meta.id,
      title: meta.title,
      status: meta.status,
      priority: meta.priority ?? 100,
      type: meta.type ?? "default",
      createdAt: meta.created_at ?? meta.createdAt ?? new Date().toISOString(),
      updatedAt: meta.updated_at ?? meta.updatedAt ?? new Date().toISOString(),
      assignedTo: meta.assigned_to ?? meta.assignedTo ?? null,
      dependsOn: meta.depends_on ?? meta.dependsOn ?? [],
      retryCount: meta.retry_count ?? meta.retryCount ?? 0,
      maxRetries: meta.max_retries ?? meta.maxRetries ?? 2,
      tags: meta.tags ?? [],
      branch: meta.branch ?? null,
      needsReview: meta.needs_review ?? meta.needsReview ?? true,
      files: meta.files,
      acceptanceCriteria: meta.acceptance_criteria ?? meta.acceptanceCriteria,
      constraints: meta.constraints,
      body,
    };
  }

  private serializeTask(task: Task): string {
    const frontmatter: Record<string, unknown> = {
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      type: task.type,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      assigned_to: task.assignedTo,
      depends_on: task.dependsOn,
      retry_count: task.retryCount,
      max_retries: task.maxRetries,
      tags: task.tags,
      branch: task.branch,
      needs_review: task.needsReview,
    };
    // Only include optional fields if present
    if (task.files) frontmatter.files = task.files;
    if (task.acceptanceCriteria) frontmatter.acceptance_criteria = task.acceptanceCriteria;
    if (task.constraints) frontmatter.constraints = task.constraints;

    return `---\n${stringifyYaml(frontmatter)}---\n${task.body}`;
  }
}

const STATUSES: TaskStatus[] = ["pending", "active", "review", "done", "failed"];

/** Split a markdown file into YAML frontmatter and body. */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new TaskParseError("<unknown>", "no YAML frontmatter found");
  }
  return { frontmatter: match[1], body: match[2] };
}
```

**Design note**: The `FsTaskRepository.transition()` method handles file
content only. It does NOT call `git mv`. The orchestrator coordinates
between `TaskRepository` and `SourceControl` because the git operation
(mv + add + commit + push) is an orchestration concern, not a repository
concern. This keeps the adapter testable with just a temp directory -- no
git required.

### 3.2 Git Adapter (SourceControl)

```typescript
// adapters/git-source-control.ts

class GitSourceControl implements SourceControl {
  constructor(private cwd: string) {}

  async pull(): Promise<void> {
    await this.exec("git", ["pull", "--rebase", "origin", "main"]);
  }

  async commit(message: string): Promise<string> {
    await this.exec("git", ["commit", "-m", message]);
    const { stdout } = await this.exec("git", ["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  async push(): Promise<boolean> {
    try {
      await this.exec("git", ["push", "origin", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  async pushBranch(branch: string): Promise<boolean> {
    try {
      await this.exec("git", ["push", "origin", branch]);
      return true;
    } catch {
      return false;
    }
  }

  async createBranch(name: string): Promise<void> {
    await this.exec("git", ["checkout", "-b", name]);
  }

  async checkout(branch: string): Promise<void> {
    await this.exec("git", ["checkout", branch]);
  }

  async stageFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.exec("git", ["add", ...paths]);
  }

  async stageTracked(): Promise<void> {
    await this.exec("git", ["add", "-u"]);
  }

  async changedFiles(): Promise<string[]> {
    const { stdout } = await this.exec("git", ["diff", "--name-only", "HEAD"]);
    return stdout.trim().split("\n").filter(Boolean);
  }

  private async exec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const proc = Bun.spawn([cmd, ...args], {
      cwd: this.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      throw new AdapterError("git", `${cmd} ${args.join(" ")}`, stderr || `exit code ${exitCode}`);
    }
    return { stdout, stderr };
  }
}
```

**Why git operations are NOT in the TaskRepository**: Because `git mv` + `git
commit` + `git push` is a multi-step coordination that involves both the
repository AND source control. If we bury git inside TaskRepository, we can't
test the repository without git. If we keep them separate, we can test file
operations with temp directories and git operations with bare repos --
independently.

### 3.3 Claude CLI Adapter (AgentExecutor)

```typescript
// adapters/claude-cli-executor.ts

class ClaudeCliExecutor implements AgentExecutor {
  constructor(
    private cwd: string,
    private cliBinary: string = "claude"  // Overridable for testing
  ) {}

  async execute(params: ExecutionParams): Promise<ExecutionResult> {
    const args = [
      "-p", params.prompt,
      "--output-format", "json",
      "--max-turns", String(params.maxTurns),
      "--max-budget-usd", String(params.budgetUsd),
      "--model", params.model,
    ];

    if (params.allowedTools.length > 0) {
      args.push("--allowedTools", ...params.allowedTools);
    }

    if (params.systemPromptFile) {
      args.push("--append-system-prompt-file", params.systemPromptFile);
    }

    args.push("--dangerously-skip-permissions");

    const startTime = Date.now();
    const proc = Bun.spawn([this.cliBinary, ...args], {
      cwd: this.cwd,
      stdout: "pipe",
      stderr: "pipe",
      timeout: params.timeoutMs,
    });

    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const durationMs = Date.now() - startTime;

    // Parse JSON output from Claude
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Non-JSON output = probably an error or timeout
    }

    return {
      exitCode,
      sessionId: (parsed.session_id as string) ?? null,
      costUsd: (parsed.cost_usd as number) ?? null,
      turnsUsed: (parsed.num_turns as number) ?? null,
      durationMs,
      stopReason: this.mapStopReason(exitCode, parsed),
    };
  }

  private mapStopReason(
    exitCode: number,
    parsed: Record<string, unknown>
  ): ExecutionResult["stopReason"] {
    if (exitCode === 124 || exitCode === 137) return "timeout";   // timeout / SIGKILL
    if (parsed.stop_reason === "refusal") return "refusal";
    if (parsed.stop_reason === "max_tokens") return "max_turns";
    if (exitCode !== 0) return "error";
    return "end_turn";
  }
}
```

### 3.4 Mock Executor (for testing)

```typescript
// adapters/mock-executor.ts

class MockExecutor implements AgentExecutor {
  private scenarios: Map<string, ExecutionResult> = new Map();
  public calls: ExecutionParams[] = [];

  /** Register a canned response for a prompt containing the given substring. */
  whenPromptContains(substring: string, result: Partial<ExecutionResult>): void {
    this.scenarios.set(substring, {
      exitCode: 0,
      sessionId: "mock-session",
      costUsd: 0.01,
      turnsUsed: 5,
      durationMs: 100,
      stopReason: "end_turn",
      ...result,
    });
  }

  async execute(params: ExecutionParams): Promise<ExecutionResult> {
    this.calls.push(params);

    for (const [substring, result] of this.scenarios) {
      if (params.prompt.includes(substring)) {
        return result;
      }
    }

    // Default: success
    return {
      exitCode: 0,
      sessionId: "mock-session",
      costUsd: 0.01,
      turnsUsed: 5,
      durationMs: 100,
      stopReason: "end_turn",
    };
  }
}
```

### 3.5 Shell Verifier

```typescript
// adapters/shell-verifier.ts

class ShellVerifier implements Verifier {
  constructor(private cwd: string) {}

  async verify(commands: VerificationCommands): Promise<VerificationResult> {
    const outputs: string[] = [];

    const testsPass = commands.test
      ? await this.runCheck(commands.test, outputs)
      : true;

    const buildPass = commands.build
      ? await this.runCheck(commands.build, outputs)
      : true;

    const lintPass = commands.lint
      ? await this.runCheck(commands.lint, outputs)
      : null;

    return {
      testsPass,
      buildPass,
      lintPass,
      verified: testsPass && buildPass && (lintPass ?? true),
      output: outputs.join("\n---\n"),
    };
  }

  private async runCheck(command: string, outputs: string[]): Promise<boolean> {
    const [cmd, ...args] = command.split(" ");
    const proc = Bun.spawn([cmd, ...args], {
      cwd: this.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    outputs.push(`$ ${command}\n${stdout}${stderr}`);
    return exitCode === 0;
  }
}
```

### 3.6 Console Logger

```typescript
// adapters/console-logger.ts

class ConsoleLogger implements Logger {
  info(event: string, data?: Record<string, unknown>): void {
    this.emit("info", event, data);
  }

  warn(event: string, data?: Record<string, unknown>): void {
    this.emit("warn", event, data);
  }

  error(event: string, data?: Record<string, unknown>): void {
    this.emit("error", event, data);
  }

  private emit(level: string, event: string, data?: Record<string, unknown>): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...data,
    };
    console.log(JSON.stringify(entry));
  }
}
```

### 3.7 Docker vs Bare VPS: What Differs?

**Nothing at the orchestrator level.** The orchestrator doesn't know or care
whether it's running inside Docker or directly on a VPS. The adapters are
identical. The only differences are:

| Concern | Docker | Bare VPS |
|---------|--------|----------|
| Process management | Docker restart policy | systemd service |
| Log access | `docker logs` | journalctl or log files |
| Git credentials | Mounted volume or env var | ~/.ssh/config |
| Bun runtime | Installed in Dockerfile | Installed on host |
| Working directory | Container filesystem | Host filesystem |

All of these are **deployment concerns**, not adapter concerns. The
orchestrator binary is the same. The adapters are the same. The Dockerfile
is just packaging.

If we ever need Docker-specific behavior (e.g., health check endpoint), that
would be a separate entrypoint concern, not an adapter.

---

## 4. The Orchestrator Loop

The orchestrator is the **composition root**. It creates adapters, wires
them together, and runs the main loop. It's the only place that knows
about all the pieces.

```typescript
// orchestrator/index.ts

import { loadConfig, type RalphConfig } from "./config";
import { FsTaskRepository } from "../adapters/fs-task-repository";
import { GitSourceControl } from "../adapters/git-source-control";
import { ClaudeCliExecutor } from "../adapters/claude-cli-executor";
import { ShellVerifier } from "../adapters/shell-verifier";
import { ConsoleLogger } from "../adapters/console-logger";
import { pickNextTask } from "../core/task-queue";
import { transitionTask } from "../core/state-machine";
import { buildPrompt } from "../core/prompt-builder";
import { checkConsistency } from "../core/consistency";
import { getToolProfile } from "./tool-profiles";
import { loadTemplates } from "./templates";

async function main() {
  const config = await loadConfig(".ralph/config.json");
  const cwd = process.cwd();

  // Wire up adapters -- plain constructor injection, no framework
  const repo = new FsTaskRepository(`${cwd}/.ralph/tasks`);
  const git = new GitSourceControl(cwd);
  const executor = new ClaudeCliExecutor(cwd, config.claudeBinary);
  const verifier = new ShellVerifier(cwd);
  const log = new ConsoleLogger();

  const templates = await loadTemplates(`${cwd}/.ralph/templates`);

  log.info("ralph_started", { workerId: config.workerId });

  // Phase 0: Crash recovery
  await recoverOrphanedTasks(repo, git, config, log);

  // Phase 1: Main loop
  while (true) {
    try {
      await git.pull();
    } catch (err) {
      log.error("pull_failed", { error: String(err) });
      await sleep(config.pollIntervalMs);
      continue;
    }

    const allTasks = await repo.listAll();

    // Consistency check (every loop, cheap operation)
    const inconsistencies = checkConsistency(
      await repo.locateAll()
    );
    if (inconsistencies.length > 0) {
      log.error("consistency_error", { errors: inconsistencies });
      // Don't proceed with inconsistent state
      await sleep(config.pollIntervalMs);
      continue;
    }

    const task = pickNextTask(allTasks);
    if (!task) {
      log.info("no_eligible_tasks");
      await sleep(config.pollIntervalMs);
      continue;
    }

    await processTask(task, { repo, git, executor, verifier, log, config, templates });
  }
}

interface Deps {
  repo: TaskRepository;
  git: SourceControl;
  executor: AgentExecutor;
  verifier: Verifier;
  log: Logger;
  config: RalphConfig;
  templates: Map<TaskType, PromptTemplate>;
}

async function processTask(task: Task, deps: Deps): Promise<void> {
  const { repo, git, executor, verifier, log, config, templates } = deps;
  const now = () => new Date().toISOString();

  log.info("task_claiming", { taskId: task.id, type: task.type });

  // 1. Claim: pending -> active
  const claimed = transitionTask(task, "active", {
    workerId: config.workerId,
    now: now(),
  });
  await repo.transition(claimed, "pending", "active");
  await git.stageFiles([
    `.ralph/tasks/active/${task.id}.md`,
  ]);
  // Also need to stage the removal of the old file
  await git.stageTracked();
  await git.commit(`ralph(${task.id}): claimed by ${config.workerId}`);

  const pushed = await git.push();
  if (!pushed) {
    // Someone else changed remote. Abort claim.
    log.warn("claim_push_failed", { taskId: task.id });
    await git.pull();  // Will reset our local state
    return;
  }

  log.info("task_claimed", { taskId: task.id });

  // 2. Create task branch
  const branchName = `ralph/${task.id}`;
  await git.createBranch(branchName);

  // 3. Build prompt
  const template = templates.get(task.type) ?? templates.get("default")!;
  const prompt = buildPrompt(claimed, template);
  const tools = getToolProfile(task.type, config);

  // 4. Execute
  log.info("execution_start", { taskId: task.id, model: config.model });
  const result = await executor.execute({
    prompt,
    model: config.model,
    maxTurns: config.maxTurns,
    budgetUsd: config.budgetUsd,
    timeoutMs: config.taskTimeoutMs,
    allowedTools: tools,
    systemPromptFile: ".claude/ralph-system.md",
  });
  log.info("execution_done", {
    taskId: task.id,
    exitCode: result.exitCode,
    stopReason: result.stopReason,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  });

  // 5. Verify
  let verification: VerificationResult = {
    testsPass: false,
    buildPass: false,
    lintPass: null,
    verified: false,
    output: "",
  };

  if (result.stopReason === "end_turn") {
    verification = await verifier.verify({
      test: config.commands.test,
      build: config.commands.build,
      lint: config.commands.lint,
    });
    log.info("verification_done", {
      taskId: task.id,
      verified: verification.verified,
      testsPass: verification.testsPass,
      buildPass: verification.buildPass,
    });
  }

  // 6. Commit work on branch (explicit files, never git add -A)
  await git.stageTracked();
  await git.commit(
    `ralph(${task.id}): execution complete (verified=${verification.verified})`
  ).catch(() => {});  // May fail if nothing changed -- that's fine
  await git.pushBranch(branchName);

  // 7. Switch back to main for status update
  await git.checkout("main");
  await git.pull();

  // 8. Determine outcome and transition
  if (verification.verified) {
    const reviewed = transitionTask(claimed, "review", {
      now: now(),
      branch: branchName,
    });
    await repo.transition(reviewed, "active", "review");
    await git.stageTracked();
    await git.commit(`ralph(${task.id}): completed, moved to review (branch: ${branchName})`);
    log.info("task_to_review", { taskId: task.id, branch: branchName });
  } else if (claimed.retryCount < claimed.maxRetries) {
    const retried = transitionTask(claimed, "pending", { now: now() });
    await repo.transition(retried, "active", "pending");
    await git.stageTracked();
    await git.commit(
      `ralph(${task.id}): failed verification, retry ${retried.retryCount}/${retried.maxRetries}`
    );
    log.info("task_retry", { taskId: task.id, retryCount: retried.retryCount });
  } else {
    const failed = transitionTask(claimed, "failed", { now: now() });
    // Guard won't let us go pending -> failed, so we go active -> failed
    // Actually, we need to handle this: the task is "active" in the core's view
    await repo.transition(failed, "active", "failed");
    await git.stageTracked();
    await git.commit(
      `ralph(${task.id}): permanently failed after ${claimed.maxRetries} retries`
    );
    log.error("task_failed", { taskId: task.id, retryCount: claimed.retryCount });
  }

  // Push status update
  const statusPushed = await git.push();
  if (!statusPushed) {
    // Pull and retry once
    await git.pull();
    await git.push();
  }
}

async function recoverOrphanedTasks(
  repo: TaskRepository,
  git: SourceControl,
  config: RalphConfig,
  log: Logger
): Promise<void> {
  const tasks = await repo.listAll();
  const orphaned = tasks.filter(
    t => t.status === "active" && t.assignedTo === config.workerId
  );

  for (const task of orphaned) {
    log.warn("recovering_orphaned_task", { taskId: task.id });
    const now = new Date().toISOString();

    if (task.retryCount < task.maxRetries) {
      const retried = transitionTask(task, "pending", { now });
      await repo.transition(retried, "active", "pending");
      log.info("orphan_retried", { taskId: task.id, retryCount: retried.retryCount });
    } else {
      const failed = transitionTask(task, "failed", { now });
      await repo.transition(failed, "active", "failed");
      log.error("orphan_failed", { taskId: task.id });
    }
  }

  if (orphaned.length > 0) {
    await git.stageTracked();
    await git.commit(`ralph: recovered ${orphaned.length} orphaned task(s) after crash`);
    await git.push();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
```

### How Configuration Is Loaded

```typescript
// orchestrator/config.ts

interface RalphConfig {
  workerId: string;
  pollIntervalMs: number;
  taskTimeoutMs: number;
  model: string;
  maxTurns: number;
  budgetUsd: number;
  claudeBinary: string;
  commands: {
    test?: string;
    build?: string;
    lint?: string;
  };
}

async function loadConfig(path: string): Promise<RalphConfig> {
  const raw = await Bun.file(path).json().catch(() => ({}));

  return {
    workerId: raw.worker_id ?? `ralph-${hostname()}`,
    pollIntervalMs: (raw.poll_interval_seconds ?? 30) * 1000,
    taskTimeoutMs: (raw.task_timeout_seconds ?? 1800) * 1000,
    model: raw.model ?? "opus",
    maxTurns: raw.max_turns ?? 50,
    budgetUsd: raw.budget_usd ?? 5.0,
    claudeBinary: raw.claude_binary ?? "claude",
    commands: {
      test: raw.commands?.test,
      build: raw.commands?.build,
      lint: raw.commands?.lint,
    },
  };
}
```

### How Templates Are Loaded

```typescript
// orchestrator/templates.ts

async function loadTemplates(
  dir: string
): Promise<Map<TaskType, PromptTemplate>> {
  const templates = new Map<TaskType, PromptTemplate>();
  const defaultTemplate = await readFileOrNull(`${dir}/default.md`);

  if (!defaultTemplate) {
    throw new Error(`Missing required template: ${dir}/default.md`);
  }
  templates.set("default", { taskType: "default", templateBody: defaultTemplate });

  const types: TaskType[] = ["bugfix", "feature", "refactor", "test", "research"];
  for (const type of types) {
    const body = await readFileOrNull(`${dir}/${type}.md`);
    if (body) {
      templates.set(type, { taskType: type, templateBody: body });
    }
    // If no template for this type, it'll fall back to "default" at runtime
  }

  return templates;
}
```

### Tool Profiles

```typescript
// orchestrator/tool-profiles.ts

const BASE_TOOLS = ["Read", "Glob", "Grep"];
const EDIT_TOOLS = [...BASE_TOOLS, "Edit", "Write"];
const FULL_TOOLS = [
  ...EDIT_TOOLS,
  "Bash(bun test *)",
  "Bash(bun run lint *)",
  "Bash(bun run build *)",
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(git add *)",
  "Bash(git commit *)",
];

function getToolProfile(taskType: TaskType, config: RalphConfig): string[] {
  switch (taskType) {
    case "research":
      return BASE_TOOLS;
    case "test":
    case "bugfix":
    case "feature":
    case "refactor":
      return FULL_TOOLS;
    default:
      return FULL_TOOLS;
  }
}
```

---

## 5. File/Module Structure

```
src/
  core/                         # Pure domain logic, ZERO external dependencies
    types.ts                    # Task, ExecutionResult, VerificationResult, etc.
    state-machine.ts            # transitionTask(), TRANSITIONS map
    task-queue.ts               # pickNextTask()
    prompt-builder.ts           # buildPrompt(), interpolateList()
    consistency.ts              # checkConsistency()
    errors.ts                   # RalphError, InvalidTransitionError, etc.

  ports/                        # TypeScript interfaces only
    task-repository.ts          # TaskRepository
    source-control.ts           # SourceControl
    agent-executor.ts           # AgentExecutor
    verifier.ts                 # Verifier
    logger.ts                   # Logger

  adapters/                     # Concrete implementations of ports
    fs-task-repository.ts       # FsTaskRepository (filesystem + YAML parsing)
    git-source-control.ts       # GitSourceControl (shells out to git)
    claude-cli-executor.ts      # ClaudeCliExecutor (spawns claude -p)
    mock-executor.ts            # MockExecutor (for tests)
    shell-verifier.ts           # ShellVerifier (runs test/build/lint commands)
    console-logger.ts           # ConsoleLogger (structured JSON to stdout)

  orchestrator/                 # Wires everything together
    index.ts                    # main(), processTask(), recoverOrphanedTasks()
    config.ts                   # loadConfig(), RalphConfig type
    templates.ts                # loadTemplates()
    tool-profiles.ts            # getToolProfile()

  tests/
    unit/
      state-machine.test.ts
      task-queue.test.ts
      prompt-builder.test.ts
      consistency.test.ts
    integration/
      fs-task-repository.test.ts  # Uses temp directories
      git-source-control.test.ts  # Uses local bare repos
      shell-verifier.test.ts      # Runs real commands
    e2e/
      golden-path.test.ts         # Full loop with mock executor + local git
      failure-path.test.ts
      recovery.test.ts
    fixtures/
      tasks/                      # Sample .md task files for parser tests
```

**Total: ~20 files.** Flat within each layer. No nested subdirectories
within `core/` or `adapters/`. If a file doesn't fit in one of these four
directories, question whether it belongs.

### Dependency Rule

The dependency arrow always points inward:

```
orchestrator  -->  ports  <--  adapters
                    ^
                    |
                   core
```

- `core/` imports nothing outside `core/`.
- `ports/` imports types from `core/` (for `Task`, `VerificationResult`, etc.).
- `adapters/` import from `ports/` and `core/`.
- `orchestrator/` imports from everything.

This is enforced by convention, not by build tooling. With ~20 files and
one developer, a folder with discipline beats a package with enforcement.

If you want automated enforcement later, add a lint rule that blocks imports
from `adapters/` in `core/` files. But don't set up a monorepo package
boundary for 20 files. That's ceremony.

---

## 6. The "No Ceremony" Test

For every abstraction proposed above, here's the justification test:

| Abstraction | "What does this buy us RIGHT NOW?" | Verdict |
|---|---|---|
| `TaskRepository` interface | I can test file parsing with temp dirs, no git | **KEEP** |
| `SourceControl` interface | I can test the orchestrator loop without a real git repo | **KEEP** |
| `AgentExecutor` interface | I can test the entire loop without spending $5/run on Claude | **KEEP** |
| `Verifier` interface | I can test failure/retry paths without real test suites | **KEEP** |
| `Logger` interface | I can verify log output in tests; swap to file logger later | **KEEP** |
| `Clock` interface | Time is already injected via `TransitionContext.now` | **CUT** (parameter does the job) |
| `EventEmitter` interface | Only one consumer (logger). No fan-out needed. | **CUT** (use Logger directly) |
| `TemplateLoader` interface | Templates loaded once at startup. Just a function. | **CUT** (plain function) |
| `ConfigLoader` interface | Config loaded once at startup. Just a function. | **CUT** (plain function) |
| DI container | 5 adapters, created in one place. Manual wiring is 5 lines. | **CUT** (constructor calls) |
| Abstract factory | Only one implementation per port in V1. | **CUT** (direct instantiation) |
| Repository pattern with Unit of Work | We have git commits as transactions already. | **CUT** (git IS the UoW) |
| Separate `TaskParser` class | It's 40 lines inside `FsTaskRepository`. Not reused. | **CUT** (private method) |

### Where I intentionally chose NOT to abstract

1. **No `GitMvOperation` class.** The orchestrator directly coordinates between
   `TaskRepository.transition()` and `SourceControl.stageTracked()`. Yes, this
   means the orchestrator "knows" that transitions involve both file writes and
   git staging. That's fine. The orchestrator IS the coordination layer. Making
   a `TransitionCoordinator` would just move the same code to a different file.

2. **No `RetryPolicy` class.** The retry logic is 10 lines in `processTask()`:
   check `retryCount < maxRetries`, transition accordingly. A `RetryPolicy`
   abstraction would be justified if we had different retry strategies per task
   type. We don't. Three similar lines beat a premature abstraction.

3. **No `PromptTemplateEngine` abstraction.** The template interpolation is
   a `replace()` call with a regex for lists. It handles `{{variable}}` and
   `{{#list}}...{{/list}}`. If we need Handlebars features later, we add
   Handlebars. But right now, 20 lines of string replacement beats importing
   a template library.

4. **No `TaskFileSerializer` port.** Serialization is a private method on
   `FsTaskRepository`. It doesn't need to be swappable because we're committed
   to Markdown + YAML frontmatter. If we changed the format, we'd rewrite the
   adapter, not swap a serializer.

5. **No `HealthCheck` port.** The heartbeat is updating `status.json` -- a file
   write that happens in the orchestrator loop. It's 3 lines. It doesn't need
   its own abstraction.

---

## 7. Configuration

### `.ralph/config.json` Schema

```jsonc
{
  // Worker identity
  "worker_id": "ralph-vps-01",        // default: "ralph-<hostname>"

  // Polling
  "poll_interval_seconds": 30,         // default: 30

  // Execution limits
  "task_timeout_seconds": 1800,        // default: 1800 (30 min)
  "model": "opus",                     // default: "opus"
  "max_turns": 50,                     // default: 50
  "budget_usd": 5.0,                   // default: 5.0

  // Claude binary (override for testing)
  "claude_binary": "claude",           // default: "claude"

  // Verification commands (project-specific)
  "commands": {
    "test": "bun test",                // null = skip test verification
    "build": "bun run build",          // null = skip build verification
    "lint": "bun run lint"             // null = skip lint verification
  }
}
```

### How the core loads config without knowing about files

It doesn't. The **orchestrator** loads the config file (it's one of only two
places that touch the filesystem directly -- the other being template loading).
The config values are then passed to adapters as constructor arguments and to
core functions as parameters.

```typescript
// The orchestrator does this:
const config = await loadConfig(".ralph/config.json");  // reads file
const executor = new ClaudeCliExecutor(cwd, config.claudeBinary);  // passes values
```

The core never sees `RalphConfig`. It receives individual values:

```typescript
// Core function doesn't know about config
transitionTask(task, "active", {
  workerId: config.workerId,  // orchestrator extracts the value
  now: now(),
});
```

This means the core is testable without any config file:

```typescript
// Test
transitionTask(task, "active", {
  workerId: "test-worker",
  now: "2026-03-03T10:00:00Z",
});
```

No config mocking needed. No `process.env` stubbing. Just function arguments.

---

## 8. Error Handling Strategy

### Error Taxonomy

```
RalphError (base)
  |
  +-- InvalidTransitionError    # Core: illegal state transition
  |   (taskId, from, to)
  |
  +-- TransitionGuardError      # Core: guard condition failed
  |   (taskId, reason)
  |
  +-- TaskParseError            # Core/Adapter boundary: malformed task file
  |   (filePath, reason)
  |
  +-- AdapterError              # Adapter: external operation failed
      (adapter, operation, reason)
```

### Core Domain Errors

These are **programming errors** or **data errors**. They mean the system
has a bug or the data is corrupted.

| Error | Cause | Recovery |
|---|---|---|
| `InvalidTransitionError` | Code tried `done -> active` | Fix the code. This is a bug. |
| `TransitionGuardError` | Tried to claim without workerId | Fix the calling code. |
| `TaskParseError` | Malformed YAML, missing fields | Log, skip task, continue loop. User fixes the file. |

Core errors are **never retryable**. If `transitionTask()` throws, something
is fundamentally wrong. Retrying won't help.

### Adapter Errors

These are **infrastructure failures**. The operation is correct but the
external system is unavailable or rejected it.

| Error | Cause | Retryable? | Recovery |
|---|---|---|---|
| `git pull` fails | Network down, auth expired | Yes | Wait, retry on next loop iteration |
| `git push` rejected | Remote has new commits | Yes | Pull, re-evaluate, retry |
| `claude -p` exits non-zero | API error, rate limit | Maybe | Depends on exit code |
| `claude -p` timeout | Task too complex | No | Mark task failed |
| `bun test` exits non-zero | Tests fail | Via task retry | Retry task if retries remain |
| File read/write fails | Disk full, permissions | No | Fatal -- log and exit |

### Error Flow

```
Adapter throws AdapterError
    |
    v
Orchestrator catches it
    |
    +-- Is it a git push failure? --> pull and re-evaluate
    |
    +-- Is it an execution failure? --> check retry eligibility
    |       |
    |       +-- Retries remain --> transition to pending
    |       +-- No retries    --> transition to failed
    |
    +-- Is it fatal (disk, permissions)? --> log and exit(1)
    |
    +-- Unknown? --> log, skip this task, continue loop
```

The orchestrator is the **error boundary**. Core functions throw.
Adapters throw. The orchestrator catches and decides. This means:

- Core functions don't need try/catch (they're pure).
- Adapters throw `AdapterError` for all failures (uniform error type).
- The orchestrator's `processTask()` is wrapped in try/catch at the loop level.

```typescript
// In the main loop:
while (true) {
  try {
    // ... pick task, process task ...
  } catch (err) {
    if (err instanceof TaskParseError) {
      log.error("task_parse_error", { file: err.filePath, reason: err.message });
      // Skip this task, continue to next
    } else if (err instanceof AdapterError) {
      log.error("adapter_error", { adapter: err.adapter, op: err.operation });
      // Wait and retry the whole loop
      await sleep(config.pollIntervalMs);
    } else {
      log.error("unexpected_error", { error: String(err) });
      // Unknown error -- sleep and retry to avoid tight error loops
      await sleep(config.pollIntervalMs);
    }
  }
}
```

### What about partial failures in processTask?

The hardest error case: the orchestrator claimed a task (pushed to remote),
started execution, then crashed mid-execution. The task is stuck in `active`
on the remote.

**Solution**: Crash recovery on startup (already designed in the orchestrator).
On boot, check for tasks in `active` assigned to this worker. Release them
back to `pending` (with incremented retry count) or mark them `failed`.

This is the same pattern as a database transaction rollback, except the
"transaction" is a git commit and the "rollback" is another git commit that
undoes the state.

---

## 9. Testing Seams

The hexagonal architecture gives us natural seams at every port boundary.
Here's what gets tested, how, and with what mocks.

### Unit Tests (core/ -- zero mocks needed)

```typescript
// tests/unit/state-machine.test.ts
import { describe, it, expect } from "bun:test";
import { transitionTask } from "../../src/core/state-machine";

describe("transitionTask", () => {
  const baseTask: Task = {
    id: "task-001",
    title: "Test task",
    status: "pending",
    priority: 100,
    type: "bugfix",
    createdAt: "2026-03-03T10:00:00Z",
    updatedAt: "2026-03-03T10:00:00Z",
    assignedTo: null,
    dependsOn: [],
    retryCount: 0,
    maxRetries: 2,
    tags: [],
    branch: null,
    needsReview: true,
    body: "Fix the bug.",
  };

  it("pending -> active: sets assignedTo and updatedAt", () => {
    const result = transitionTask(baseTask, "active", {
      workerId: "ralph-1",
      now: "2026-03-03T11:00:00Z",
    });
    expect(result.status).toBe("active");
    expect(result.assignedTo).toBe("ralph-1");
    expect(result.updatedAt).toBe("2026-03-03T11:00:00Z");
  });

  it("pending -> review: throws InvalidTransitionError", () => {
    expect(() =>
      transitionTask(baseTask, "review", { now: "2026-03-03T11:00:00Z" })
    ).toThrow("Invalid transition");
  });

  it("active -> pending: increments retryCount", () => {
    const active = { ...baseTask, status: "active" as const, assignedTo: "ralph-1" };
    const result = transitionTask(active, "pending", {
      now: "2026-03-03T11:00:00Z",
    });
    expect(result.retryCount).toBe(1);
    expect(result.status).toBe("pending");
    expect(result.assignedTo).toBeNull();
  });

  it("active -> pending: throws when retries exhausted", () => {
    const active = {
      ...baseTask,
      status: "active" as const,
      retryCount: 2,
      maxRetries: 2,
    };
    expect(() =>
      transitionTask(active, "pending", { now: "2026-03-03T11:00:00Z" })
    ).toThrow("should fail instead");
  });
});
```

```typescript
// tests/unit/task-queue.test.ts
import { describe, it, expect } from "bun:test";
import { pickNextTask } from "../../src/core/task-queue";

describe("pickNextTask", () => {
  it("returns highest priority pending task", () => {
    const tasks: Task[] = [
      makeTask({ id: "a", priority: 200, status: "pending" }),
      makeTask({ id: "b", priority: 100, status: "pending" }),
      makeTask({ id: "c", priority: 300, status: "pending" }),
    ];
    expect(pickNextTask(tasks)?.id).toBe("b");
  });

  it("skips tasks with unsatisfied dependencies", () => {
    const tasks: Task[] = [
      makeTask({ id: "a", priority: 100, status: "pending", dependsOn: ["x"] }),
      makeTask({ id: "b", priority: 200, status: "pending" }),
      makeTask({ id: "x", status: "active" }),  // not done yet
    ];
    expect(pickNextTask(tasks)?.id).toBe("b");
  });

  it("returns task when dependency is done", () => {
    const tasks: Task[] = [
      makeTask({ id: "a", priority: 100, status: "pending", dependsOn: ["x"] }),
      makeTask({ id: "x", status: "done" }),
    ];
    expect(pickNextTask(tasks)?.id).toBe("a");
  });

  it("returns null when no eligible tasks", () => {
    const tasks: Task[] = [
      makeTask({ id: "a", status: "active" }),
      makeTask({ id: "b", status: "done" }),
    ];
    expect(pickNextTask(tasks)).toBeNull();
  });
});
```

### Integration Tests (adapters -- real I/O, controlled environment)

```typescript
// tests/integration/fs-task-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { FsTaskRepository } from "../../src/adapters/fs-task-repository";

describe("FsTaskRepository", () => {
  let tmpDir: string;
  let repo: FsTaskRepository;

  beforeEach(async () => {
    tmpDir = await mkdtemp("/tmp/ralph-test-");
    // Create status directories
    for (const status of ["pending", "active", "review", "done", "failed"]) {
      await mkdir(`${tmpDir}/${status}`, { recursive: true });
    }
    repo = new FsTaskRepository(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it("listAll finds tasks in all directories", async () => {
    await writeTaskFile(`${tmpDir}/pending/task-001.md`, { id: "task-001", status: "pending" });
    await writeTaskFile(`${tmpDir}/active/task-002.md`, { id: "task-002", status: "active" });

    const tasks = await repo.listAll();
    expect(tasks).toHaveLength(2);
  });

  it("transition moves file between directories", async () => {
    await writeTaskFile(`${tmpDir}/pending/task-001.md`, { id: "task-001", status: "pending" });
    const task = (await repo.listAll())[0];
    const updated = { ...task, status: "active" as const };

    await repo.transition(updated, "pending", "active");

    const files = await readdir(`${tmpDir}/active`);
    expect(files).toContain("task-001.md");
    const pendingFiles = await readdir(`${tmpDir}/pending`);
    expect(pendingFiles).not.toContain("task-001.md");
  });
});
```

```typescript
// tests/integration/git-source-control.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

describe("GitSourceControl", () => {
  let remoteDir: string;
  let workDir: string;
  let git: GitSourceControl;

  beforeEach(async () => {
    // Create local bare repo (simulates remote)
    remoteDir = await mkdtemp("/tmp/ralph-remote-");
    await exec("git", ["init", "--bare", remoteDir]);

    // Clone it (simulates worker)
    workDir = await mkdtemp("/tmp/ralph-work-");
    await exec("git", ["clone", remoteDir, workDir]);

    // Seed with initial commit
    await writeFile(`${workDir}/README.md`, "init");
    await exec("git", ["-C", workDir, "add", "."]);
    await exec("git", ["-C", workDir, "commit", "-m", "init"]);
    await exec("git", ["-C", workDir, "push"]);

    git = new GitSourceControl(workDir);
  });

  it("pull succeeds with no changes", async () => {
    await expect(git.pull()).resolves.toBeUndefined();
  });

  it("commit + push cycle works", async () => {
    await writeFile(`${workDir}/test.txt`, "hello");
    await git.stageFiles(["test.txt"]);
    const hash = await git.commit("test commit");
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.push()).toBe(true);
  });

  it("push returns false when remote has diverged", async () => {
    // Create a second clone that pushes first
    const otherDir = await mkdtemp("/tmp/ralph-other-");
    await exec("git", ["clone", remoteDir, otherDir]);
    await writeFile(`${otherDir}/other.txt`, "conflict");
    await exec("git", ["-C", otherDir, "add", "."]);
    await exec("git", ["-C", otherDir, "commit", "-m", "other"]);
    await exec("git", ["-C", otherDir, "push"]);

    // Now our push should fail
    await writeFile(`${workDir}/local.txt`, "local");
    await git.stageFiles(["local.txt"]);
    await git.commit("local commit");
    expect(await git.push()).toBe(false);
  });
});
```

### E2E Tests (full loop with mocks)

```typescript
// tests/e2e/golden-path.test.ts
import { describe, it, expect } from "bun:test";

describe("Golden path: task pending -> review", () => {
  it("picks up task, executes, verifies, transitions to review", async () => {
    // Setup: bare repo + worker clone + laptop clone
    const { remoteDir, workerDir, laptopDir } = await setupGitTopology();

    // Seed a pending task from "laptop"
    await seedTask(laptopDir, {
      id: "task-001",
      title: "Add greeting function",
      type: "feature",
      status: "pending",
    });
    await pushFromLaptop(laptopDir);

    // Create orchestrator with mock executor
    const mockExecutor = new MockExecutor();
    mockExecutor.whenPromptContains("greeting", { exitCode: 0, stopReason: "end_turn" });

    const mockVerifier = new MockVerifier({ verified: true });

    // Run one iteration of the loop
    await runOneIteration({
      cwd: workerDir,
      executor: mockExecutor,
      verifier: mockVerifier,
    });

    // Verify from "laptop" side
    await pullToLaptop(laptopDir);

    // Task should be in review/
    const reviewFiles = await readdir(`${laptopDir}/.ralph/tasks/review`);
    expect(reviewFiles).toContain("task-001.md");

    // Task should NOT be in pending/
    const pendingFiles = await readdir(`${laptopDir}/.ralph/tasks/pending`);
    expect(pendingFiles).not.toContain("task-001.md");

    // Branch should exist
    const branches = await exec("git", ["-C", laptopDir, "branch", "-r"]);
    expect(branches.stdout).toContain("ralph/task-001");
  });
});
```

### Which Adapters Get Mocked in Which Tests

| Test Type | TaskRepository | SourceControl | AgentExecutor | Verifier | Logger |
|---|---|---|---|---|---|
| Unit (core) | N/A | N/A | N/A | N/A | N/A |
| Integration (adapters) | **Real** (temp dir) | **Real** (bare repo) | **Real** (mock binary) | **Real** (trivial commands) | **Real** (console) |
| E2E (golden path) | **Real** (temp dir) | **Real** (bare repo) | **Mock** | **Mock** | **Real** (console) |
| E2E (failure path) | **Real** (temp dir) | **Real** (bare repo) | **Mock** (returns failures) | **Mock** (returns failures) | **Real** |
| Smoke (real Claude) | **Real** | **Real** | **Real** | **Real** | **Real** |

The key insight: **AgentExecutor is almost always mocked** because real Claude
costs money and takes time. Everything else can use real implementations with
controlled environments (temp dirs, bare repos).

---

## Summary

### What This Architecture Gives Us

1. **Every component is testable in isolation.** Core with zero mocks. Adapters
   with temp dirs and bare repos. Orchestrator with mock executor.

2. **Swapping implementations is trivial.** Want to use the Claude SDK instead
   of the CLI? Write a new adapter. Want to store tasks in a database? Write
   a new adapter. The core and orchestrator don't change.

3. **The core is a permanent asset.** State machine logic, task queue sorting,
   prompt building -- these don't change when infrastructure changes. They're
   pure functions that will work as long as TypeScript does.

4. **Bugs are localized.** A git push failure is in the git adapter. A prompt
   formatting issue is in the prompt builder. A state transition bug is in
   the state machine. You know where to look.

5. **No ceremony.** Five ports, six adapters, one orchestrator. No DI
   framework, no abstract factories, no module registration. Just constructors
   and function calls.

### What It Costs

1. **~1500 lines of TypeScript** (estimated). That's the investment for
   testability and structure.

2. **One level of indirection** at each port boundary. When you're debugging
   a git push failure, you follow the call from orchestrator -> SourceControl
   interface -> GitSourceControl adapter. One hop.

3. **The orchestrator knows about everything.** It's the composition root.
   If you add a new port, you add it here. This is intentional -- one place
   to see all the wiring.

### The Confidence Ladder Alignment

This architecture maps cleanly to test-architect's confidence ladder:

| Ladder Step | Architecture Layer | What's Tested |
|---|---|---|
| Layer 0: Task parsing | `FsTaskRepository.parseTaskFile()` | YAML + frontmatter |
| Layer 0.5: Consistency | `core/consistency.ts` | Status/directory agreement |
| Layer 1: State machine | `core/state-machine.ts` | All transitions + guards |
| Layer 2: Task queue | `core/task-queue.ts` + `FsTaskRepository` | Scan, filter, sort, pick |
| Layer 3: Git sync | `GitSourceControl` | Pull, commit, push, branch |
| Layer 4: Agent executor | `ClaudeCliExecutor` + `MockExecutor` | Prompt -> result |
| Layer 5: Full loop | `orchestrator/index.ts` | Everything composed |
| Layer 6: Docker | Dockerfile | Same binary, packaged |
| Layer 7: VPS | Deploy | Same container, remote |

Each layer is independently testable. Each layer builds on the previous.
No step is skipped.
