# Deep Dive: Client Interface

> **Specialist**: client-interface | Architecture B deep dive
> **Date**: 2026-03-03

---

## Overview

The Ralph client is the user's gateway to the entire system. It is NOT a single CLI tool. It is NOT just Claude Code skills. It is a **core library with multiple adapters** -- hexagonal on the client side, same as the orchestrator.

Three adapters, one core:

1. **Claude Code Skills** -- conversational, used inside Claude Code sessions
2. **Standalone CLI** -- `ralph <command>`, used from terminal/scripts/CI
3. **Programmatic API** -- `import { RalphClient }`, used from code

Every client operation ultimately reads or writes to `.ralph/` via git. The adapters differ in how they present the interaction, not in what they do.

---

## 1. The Client Core (Port)

The client core is a set of pure functions that operate on the `.ralph/` directory through git. Each function has a clear contract: inputs, outputs, side effects (git operations).

### Core Operations

```typescript
// src/client/types.ts

interface TaskCreateOptions {
  title: string;
  description: string;
  type?: TaskType;           // 'feature' | 'bugfix' | 'refactor' | 'test' | 'docs'
  priority?: Priority;       // 'high' | 'normal' | 'low'
  acceptanceCriteria?: string[];
  files?: string[];          // scope the agent's attention
  constraints?: string[];    // things the agent must NOT do
}

interface TaskFilter {
  status?: TaskStatus[];     // 'pending' | 'active' | 'review' | 'done' | 'failed'
  priority?: Priority;
  type?: TaskType;
  since?: Date;              // created after this date
}

interface ReviewAction {
  taskId: string;
  action: 'approve' | 'reject';
  feedback?: string;         // required when rejecting
}

interface NodeStatus {
  nodeId: string;
  state: 'idle' | 'working' | 'down' | 'unknown';
  currentTask: TaskSummary | null;
  lastHeartbeat: Date;
  uptime: string;
}

interface QueueStatus {
  pending: number;
  active: number;
  review: number;
  done: number;
  failed: number;
  recentlyCompleted: TaskSummary[];
}

interface ExecutionTrace {
  taskId: string;
  startedAt: Date;
  completedAt: Date;
  duration: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  toolCalls: ToolCallSummary[];
  turns: number;
  exitReason: string;
}

interface CostSummary {
  period: string;
  totalCost: number;
  taskCount: number;
  averageCostPerTask: number;
  breakdown: CostBreakdown[];
}
```

### Core Function Signatures

```typescript
// src/client/core.ts

interface RalphClientPort {
  // Task lifecycle
  createTask(options: TaskCreateOptions): Promise<Task>;
  listTasks(filter?: TaskFilter): Promise<Task[]>;
  getTask(taskId: string): Promise<Task>;

  // Status & introspection
  getStatus(): Promise<{ node: NodeStatus; queue: QueueStatus }>;
  getTrace(taskId: string): Promise<ExecutionTrace>;
  getCosts(period?: 'today' | 'week' | 'month' | 'all'): Promise<CostSummary>;

  // Review workflow
  getReviewQueue(): Promise<Task[]>;
  getTaskDiff(taskId: string): Promise<string>;
  reviewTask(action: ReviewAction): Promise<void>;

  // System operations
  init(): Promise<void>;          // initialize .ralph/ structure in a project
  doctor(): Promise<DiagnosticResult[]>;  // check system health
}
```

### Implementation: Git as the Transport Layer

Every core function follows the same pattern:

```typescript
// Pseudocode for any client operation
async function clientOperation() {
  await git.fetch();              // get latest state
  await git.pullFastForward();    // update local
  // ... read/write .ralph/ files ...
  await git.add(changedFiles);    // stage specific files
  await git.commit(message);      // commit with convention
  await git.push();               // propagate to remote
}
```

The core does NOT import `child_process` directly. It uses a `GitPort` interface:

```typescript
// src/client/ports/git.ts

interface GitPort {
  fetch(): Promise<void>;
  pull(options?: { ffOnly?: boolean }): Promise<void>;
  push(): Promise<void>;
  add(files: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  mv(from: string, to: string): Promise<void>;
  diff(spec: string): Promise<string>;
  log(options?: { maxCount?: number; format?: string }): Promise<string>;
  branchExists(name: string): Promise<boolean>;
  merge(branch: string, options?: { ffOnly?: boolean }): Promise<void>;
  currentBranch(): Promise<string>;
  status(): Promise<GitStatus>;
}
```

This lets us test the client core with a fake git implementation. No real repos needed for unit tests.

### Task File Read/Write

The core includes a `TaskFilePort` for parsing and writing task files:

```typescript
// src/client/ports/task-file.ts

interface TaskFilePort {
  parse(content: string): Task;
  serialize(task: Task): string;
  listDirectory(dir: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  moveFile(from: string, to: string): Promise<void>;
}
```

The real implementation uses `gray-matter` (or a lightweight YAML frontmatter parser) and the filesystem. The test implementation uses in-memory maps.

---

## 2. Adapter 1: Claude Code Skills

Skills are Markdown files that instruct Claude Code to perform operations. They cannot import TypeScript. They instruct Claude to run shell commands, read files, and write files. The skill IS a prompt.

### Design Principle

Each skill:
1. Starts with `git fetch && git pull` to get latest state
2. Reads from `.ralph/` to understand current state
3. Writes to `.ralph/` to make changes
4. Ends with explicit `git add`, `git commit`, `git push`
5. Uses `disable-model-invocation: true` -- user-initiated only

### Skill: `/ralph-task`

```markdown
---
name: ralph-task
description: Create a new task for the remote Ralph agent
disable-model-invocation: true
argument-hint: "[description of what you want done]"
allowed-tools: Read, Write, Bash(git *), Glob, Grep
---

Create a new Ralph task from the user's description.

## Steps

1. Run `git fetch origin && git pull --ff-only origin main` to get the latest state.

2. Generate a task ID:
   - Look at existing task files across all `.ralph/tasks/` subdirectories
   - Find the highest numeric suffix and increment: `task-NNN`
   - Example: if `task-012` exists, create `task-013`

3. Parse the user's description ($ARGUMENTS) and structure it into:
   - **Title**: A concise summary (one line)
   - **Description**: Expanded detail with context from the codebase
   - **Type**: Infer from description -- `feature`, `bugfix`, `refactor`, `test`, or `docs`
   - **Acceptance Criteria**: Concrete, testable conditions for success
   - **Priority**: Default to `normal` unless the user specifies otherwise

4. If the description is too vague to create useful acceptance criteria, ask the
   user to clarify BEFORE creating the file. Do not create tasks with vague
   criteria like "works correctly" -- be specific.

5. Read the relevant parts of the codebase to add context. If the user mentions
   a file or feature, look at it and include relevant file paths in the task.

6. Write the task file to `.ralph/tasks/pending/<task-id>.md`:

```
---
id: <task-id>
title: "<title>"
status: pending
priority: <priority>
type: <type>
created: <ISO 8601 timestamp>
author: <git user.name or "user">
---

## Description

<description>

## Acceptance Criteria

- <criterion 1>
- <criterion 2>
- ...

## Files

- <relevant file paths, if any>

## Constraints

- <constraints, if any>
```

7. Stage and commit:
   ```
   git add .ralph/tasks/pending/<task-id>.md
   git commit -m "ralph: create task <task-id> - <title>"
   git push origin main
   ```

8. Confirm to the user: show the task ID, title, and summary of acceptance
   criteria. Mention they can check status with `/ralph-status`.
```

### Skill: `/ralph-status`

```markdown
---
name: ralph-status
description: Check Ralph node status and task queue
disable-model-invocation: true
allowed-tools: Read, Bash(git *), Glob, Grep
---

Show the current status of the Ralph system.

## Steps

1. Run `git fetch origin && git pull --ff-only origin main` to get the latest.

2. Read `.ralph/status.json` for node heartbeat info. If the file does not
   exist, report "No status file found -- node may not be set up yet."

3. Determine node health from the `last_heartbeat` field:
   - < 5 minutes ago: ONLINE
   - 5-15 minutes ago: POSSIBLY DOWN
   - > 15 minutes ago or missing: DOWN

4. Count tasks in each status directory:
   - `ls .ralph/tasks/pending/` -> pending count
   - `ls .ralph/tasks/active/` -> active count
   - `ls .ralph/tasks/review/` -> review count
   - `ls .ralph/tasks/done/` -> recently done (last 5)
   - `ls .ralph/tasks/failed/` -> failed count

5. If there is an active task, read its file and show title + how long it has
   been running (from `started_at` in frontmatter).

6. If there are tasks in review, highlight them -- these need the user's
   attention.

7. Read the most recent trace file from `.ralph/traces/` (if any exist) to show
   the last completed task's cost and duration.

8. Present a clean summary:

```
Ralph Status
============
Node: <node_id> | <ONLINE/POSSIBLY DOWN/DOWN>
Last heartbeat: <relative time>

Queue:
  Pending:   <N> tasks
  Active:    <N> task(s) -- <current task title if any>
  Review:    <N> tasks (needs your attention!)
  Done:      <N> tasks
  Failed:    <N> tasks

Current Task: <title> (running for <duration>)

Recent completions:
  <task-id>  <title>  <cost>  <duration>
  ...

Cost today: $<total>
```

Do NOT create or modify any files. This is a read-only operation.
```

### Skill: `/ralph-review`

```markdown
---
name: ralph-review
description: Review and approve/reject completed Ralph tasks
disable-model-invocation: true
allowed-tools: Read, Write, Bash(git *), Glob, Grep
---

Review tasks that the Ralph node has completed and marked for review.

## Steps

1. Run `git fetch origin && git pull --ff-only origin main`.

2. List all task files in `.ralph/tasks/review/`. If none exist, tell the user
   "No tasks awaiting review" and stop.

3. If multiple tasks are in review, list them and ask the user which one to
   review. If only one, proceed with it.

4. For the selected task:

   a. Read the task file. Show:
      - Title and description
      - Acceptance criteria (which are marked done by the agent)
      - Any agent notes

   b. Show the code changes:
      - Read the `branch` field from frontmatter
      - Run `git diff main...origin/<branch>` to show the diff
      - Summarize the changes: files modified, lines added/removed

   c. Show execution trace (if available):
      - Read `.ralph/traces/<task-id>.json`
      - Show: duration, cost, token usage, number of tool calls

   d. Show test results from the task metadata if available.

5. Ask the user: **Approve**, **Reject with feedback**, or **Skip**.

6. On **Approve**:
   - Run `git merge origin/<branch> --ff-only` (or `--no-ff` if desired)
   - If merge fails due to conflicts, warn the user and do NOT proceed
   - Move the task file: `git mv .ralph/tasks/review/<task>.md .ralph/tasks/done/<task>.md`
   - Update the task frontmatter: add `reviewed_at` timestamp, `review_action: approved`
   - Commit: `git commit -m "ralph: approve <task-id> - <title>"`
   - Push: `git push origin main`

7. On **Reject with feedback**:
   - Ask the user for specific feedback
   - Append a `## Review Feedback` section to the task file with:
     - Timestamp
     - The user's feedback
     - Which acceptance criteria were not met (if applicable)
   - Move the task file: `git mv .ralph/tasks/review/<task>.md .ralph/tasks/pending/<task>.md`
   - Update frontmatter: `status: pending`, increment `revision_count`
   - Delete the remote branch: `git push origin --delete <branch>`
   - Commit: `git commit -m "ralph: reject <task-id> - <title>"`
   - Push: `git push origin main`
   - The node will pick this up again with the feedback context.

8. On **Skip**: Move to the next task in review, or end if none remain.
```

### Skill: `/ralph-list`

```markdown
---
name: ralph-list
description: List Ralph tasks with optional status filter
disable-model-invocation: true
argument-hint: "[pending|active|review|done|failed|all]"
allowed-tools: Read, Bash(git *), Glob, Grep
---

List Ralph tasks, optionally filtered by status.

## Steps

1. Run `git fetch origin && git pull --ff-only origin main`.

2. Determine the filter from $ARGUMENTS:
   - If a status is specified, only list that directory
   - If "all" or no argument, list all non-done tasks
   - If "done", show the last 10 completed tasks

3. For each matching task file, read the frontmatter and extract:
   - ID, title, priority, type, created date

4. Group by status and sort by priority (high first), then by created date
   (oldest first within same priority).

5. Present as a formatted table:

```
Pending (3):
  HIGH    task-015  Fix authentication bypass    bugfix   2h ago
  NORMAL  task-012  Add rate limiting            feature  1d ago
  LOW     task-011  Update README                docs     2d ago

Active (1):
  NORMAL  task-013  Refactor database pooling    refactor (running 45m)

Review (1):
  NORMAL  task-010  Add pagination endpoint      feature  (awaiting review)

Failed (0):
  (none)
```

Do NOT create or modify any files. This is a read-only operation.
```

### How Skills Call the Core

Skills cannot import TypeScript directly. They instruct Claude Code to perform
the same operations the core library performs, but through shell commands and
file operations:

- Core's `git.fetch()` -> Skill says "Run `git fetch origin`"
- Core's `taskFile.parse(content)` -> Skill says "Read the YAML frontmatter"
- Core's `git.mv(from, to)` -> Skill says "Run `git mv ...`"

The skill is effectively a natural-language specification of the core function.
If the core function and the skill diverge, the skill is a bug. This is a known
tradeoff: skills are less precise than code, but they work inside Claude Code
without any build step.

### Skill Limitations

1. **No type safety** -- Skills are prompts, not code. Claude may misinterpret edge cases.
2. **No shared utility functions** -- Each skill is standalone. If the task ID generation logic changes, it must change in every skill AND the core.
3. **Non-deterministic** -- The same skill invocation may produce slightly different behavior across Claude Code versions.
4. **Can't stream or pipe** -- Skills produce conversational output, not structured data.
5. **Require Claude Code** -- Obviously. Can't use skills from a bare terminal.

These limitations are exactly why the CLI adapter exists.

---

## 3. Adapter 2: Standalone CLI

The CLI is a Bun executable that calls the same core functions as the skills, but from a traditional command-line interface. No Claude Code required.

### Command Design

```
ralph <command> [subcommand] [options]

Commands:
  ralph init                    Initialize .ralph/ in the current project
  ralph task create <desc>      Create a new task
  ralph task list [status]      List tasks (default: non-done)
  ralph task show <id>          Show full task details
  ralph status                  Node status + queue overview
  ralph review [task-id]        Review tasks in review queue
  ralph trace <task-id>         Show execution trace for a task
  ralph costs [period]          Cost summary (today/week/month/all)
  ralph doctor                  Diagnose common setup issues

Options:
  --json                        Output as JSON instead of formatted text
  --no-color                    Disable colored output
  --verbose                     Show debug information
  --help                        Show help
```

### Implementation

Keep it lean. No Commander.js, no Yargs, no heavy CLI framework. Bun's `process.argv` and a simple command router:

```typescript
// src/cli/index.ts

import { parseArgs } from "./parse-args";
import { createClient } from "../client/core";

const args = parseArgs(process.argv.slice(2));
const client = createClient({ projectRoot: process.cwd() });

switch (args.command) {
  case "init":
    await handleInit(client);
    break;
  case "task":
    switch (args.subcommand) {
      case "create":
        await handleTaskCreate(client, args);
        break;
      case "list":
        await handleTaskList(client, args);
        break;
      case "show":
        await handleTaskShow(client, args);
        break;
    }
    break;
  case "status":
    await handleStatus(client, args);
    break;
  case "review":
    await handleReview(client, args);
    break;
  case "trace":
    await handleTrace(client, args);
    break;
  case "costs":
    await handleCosts(client, args);
    break;
  case "doctor":
    await handleDoctor(client, args);
    break;
  default:
    showHelp();
}
```

### Argument Parsing

A minimal, hand-rolled parser. No dependencies:

```typescript
// src/cli/parse-args.ts

interface ParsedArgs {
  command: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return {
    command: positional[0] ?? "",
    subcommand: positional[1],
    positional: positional.slice(2),
    flags,
  };
}
```

### Command Handlers

Each handler is thin -- it calls the core, then formats the output:

```typescript
// src/cli/handlers/status.ts

import type { RalphClientPort } from "../../client/core";
import { formatStatus } from "../formatters/status";

export async function handleStatus(
  client: RalphClientPort,
  args: ParsedArgs
): Promise<void> {
  const { node, queue } = await client.getStatus();

  if (args.flags.json) {
    console.log(JSON.stringify({ node, queue }, null, 2));
  } else {
    console.log(formatStatus(node, queue));
  }
}
```

### Output Formatting

The CLI formats output for the terminal. Rich formatting with ANSI colors, no external dependency needed:

```typescript
// src/cli/formatters/status.ts

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export function formatStatus(node: NodeStatus, queue: QueueStatus): string {
  const stateColor =
    node.state === "idle" || node.state === "working"
      ? GREEN
      : node.state === "down"
        ? RED
        : YELLOW;

  const lines = [
    `${BOLD}Ralph Status${RESET}`,
    `${"=".repeat(40)}`,
    `Node: ${node.nodeId} | ${stateColor}${node.state.toUpperCase()}${RESET}`,
    `Last heartbeat: ${formatRelativeTime(node.lastHeartbeat)}`,
    "",
    `${BOLD}Queue:${RESET}`,
    `  Pending:  ${queue.pending}`,
    `  Active:   ${queue.active}${node.currentTask ? ` -- ${node.currentTask.title}` : ""}`,
    `  Review:   ${queue.review}${queue.review > 0 ? ` ${YELLOW}(needs your attention)${RESET}` : ""}`,
    `  Done:     ${queue.done}`,
    `  Failed:   ${queue.failed}${queue.failed > 0 ? ` ${RED}(!)${RESET}` : ""}`,
  ];

  if (queue.recentlyCompleted.length > 0) {
    lines.push("", `${BOLD}Recent completions:${RESET}`);
    for (const task of queue.recentlyCompleted) {
      lines.push(`  ${DIM}${task.id}${RESET}  ${task.title}  ${DIM}${task.cost ?? ""}  ${task.duration ?? ""}${RESET}`);
    }
  }

  return lines.join("\n");
}
```

### Installation & Distribution

```bash
# Option 1: Global install
bun add -g ralph-vps

# Option 2: npx (no install)
npx ralph-vps status

# Option 3: From source
git clone <repo>
cd ralph-vps
bun install
bun link    # makes `ralph` available globally
```

The `package.json` declares the binary:

```json
{
  "name": "ralph-vps",
  "bin": {
    "ralph": "./src/cli/index.ts"
  }
}
```

Bun runs TypeScript directly -- no build step needed for the CLI.

### `ralph init`

Scaffolds the `.ralph/` directory and Claude Code skills in a project:

```typescript
async function handleInit(client: RalphClientPort): Promise<void> {
  await client.init();
  // Creates:
  //   .ralph/tasks/pending/
  //   .ralph/tasks/active/
  //   .ralph/tasks/review/
  //   .ralph/tasks/done/
  //   .ralph/tasks/failed/
  //   .ralph/traces/
  //   .ralph/config.json (with defaults)
  //   .claude/skills/ralph-task/SKILL.md
  //   .claude/skills/ralph-status/SKILL.md
  //   .claude/skills/ralph-review/SKILL.md
  //   .claude/skills/ralph-list/SKILL.md
}
```

### `ralph doctor`

Diagnoses common setup issues:

```
$ ralph doctor

Ralph Doctor
============
[PASS] .ralph/ directory exists
[PASS] Git repository detected
[PASS] Remote 'origin' configured
[PASS] .ralph/config.json valid
[PASS] Claude Code skills installed (4/4)
[WARN] No status.json found -- node may not be deployed yet
[FAIL] .ralph/tasks/pending/.gitkeep missing -- empty directories won't be tracked
[PASS] Git user.name configured
[PASS] Git user.email configured

3 passed, 1 warning, 1 failure

Fix suggestions:
  - Run `touch .ralph/tasks/pending/.gitkeep && git add .ralph/tasks/pending/.gitkeep`
```

Checks:
- `.ralph/` directory structure is complete
- Git repo exists with a remote
- Config file is valid JSON
- Skills are installed and match expected versions
- `.gitkeep` files exist in empty directories
- Git identity is configured
- Node status file exists (warning if not)
- No uncommitted changes in `.ralph/` (warning if found)

---

## 4. Adapter 3: Programmatic API

The client core IS the programmatic API. No extra wrapper needed.

```typescript
// Usage as a library

import { createClient } from "ralph-vps/client";

const ralph = createClient({ projectRoot: "/path/to/project" });

// Create a task from a CI pipeline
await ralph.createTask({
  title: "Post-deploy smoke tests failed",
  description: "The /api/health endpoint returned 503 after deploy abc123",
  type: "bugfix",
  priority: "high",
  acceptanceCriteria: [
    "Health endpoint returns 200",
    "All smoke tests pass",
  ],
});

// Check status from a cron job
const { node, queue } = await ralph.getStatus();
if (node.state === "down") {
  await sendAlert("Ralph node is down!");
}

// Get costs for a weekly report
const costs = await ralph.getCosts("week");
console.log(`Weekly spend: $${costs.totalCost.toFixed(2)}`);
```

### Use Cases

- **CI/CD pipelines**: Create tasks automatically when tests fail or deploys complete
- **Webhook handlers**: Accept requests from external services, create tasks
- **Custom dashboards**: Read status and traces, render in a web UI
- **Cost monitoring**: Aggregate costs, send alerts if budget thresholds are hit
- **Batch operations**: Create many tasks programmatically from a script

### Package Exports

```json
{
  "name": "ralph-vps",
  "exports": {
    ".": "./src/cli/index.ts",
    "./client": "./src/client/core.ts",
    "./types": "./src/client/types.ts"
  }
}
```

Users import only what they need. The CLI binary and client library are separate entry points from the same package.

---

## 5. The Review Experience

This is the most complex and most important client interaction. A bad review experience means the user stops using the system.

### What the User Needs to See

1. **What was the task?** -- Title, description, acceptance criteria
2. **What changed?** -- Git diff of the task branch
3. **Did it work?** -- Test results, verification status
4. **What did it cost?** -- Tokens, dollars, duration, tool calls
5. **What should I do?** -- Clear approve/reject action

### Review Data Model

```typescript
interface ReviewPackage {
  task: Task;                    // the full task file
  diff: string;                  // git diff main...ralph/<task-id>
  diffStats: DiffStats;          // files changed, insertions, deletions
  trace: ExecutionTrace | null;  // from .ralph/traces/<task-id>.json
  branch: string;                // ralph/<task-id>
  commits: CommitSummary[];      // commits on the branch
}

interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    insertions: number;
    deletions: number;
  }>;
}
```

### Review in Skill Mode

The `/ralph-review` skill presents information conversationally:

```
User: /ralph-review

Claude: I found 1 task awaiting review.

## task-013: Add rate limiting to the API
Type: feature | Priority: normal | Completed: 25 minutes ago

### Acceptance Criteria
- [x] Rate limiter middleware implemented
- [x] Configurable per-endpoint limits
- [x] Returns 429 with Retry-After header
- [x] Tests pass

### Changes (branch: ralph/task-013)
3 files changed, +87 -4

  src/middleware/rate-limiter.ts  (new, +62)
  src/routes/api.ts              (modified, +15 -4)
  tests/rate-limiter.test.ts     (new, +10)

### Execution
Duration: 12m 34s | Cost: $0.47 | Turns: 23 | Tools: 67 calls

Would you like me to show the full diff, or do you want to approve/reject?

User: Show me the diff for rate-limiter.ts

Claude: [shows the diff]

User: Looks good, approve

Claude: Merging ralph/task-013 into main...
Done. Task task-013 moved to done/. Branch cleaned up.
```

The skill's strength is conversation. The user can ask follow-up questions, drill into specific files, ask Claude to explain code changes, etc.

### Review in CLI Mode

```
$ ralph review

Tasks awaiting review (1):
  task-013  Add rate limiting to the API  (completed 25m ago)

Review task-013? [Y/n] y

task-013: Add rate limiting to the API
=======================================
Type: feature | Priority: normal
Branch: ralph/task-013

Acceptance Criteria:
  [x] Rate limiter middleware implemented
  [x] Configurable per-endpoint limits
  [x] Returns 429 with Retry-After header
  [x] Tests pass

Changes: 3 files, +87 -4
  A  src/middleware/rate-limiter.ts    +62
  M  src/routes/api.ts                +15 -4
  A  tests/rate-limiter.test.ts       +10

Execution: 12m 34s | $0.47 | 23 turns | 67 tool calls

[A]pprove  [R]eject  [D]iff  [S]kip  [Q]uit
> d

[shows full diff with syntax highlighting via git diff --color]

[A]pprove  [R]eject  [S]kip  [Q]uit
> a

Merging ralph/task-013...
Done. Task moved to done/.
```

The CLI's strength is speed. No waiting for Claude to process. Direct keyboard navigation. Pipe-able output with `--json`.

### Review in Programmatic Mode

```typescript
const reviewQueue = await ralph.getReviewQueue();

for (const task of reviewQueue) {
  const diff = await ralph.getTaskDiff(task.id);
  const trace = await ralph.getTrace(task.id);

  // Automated review logic (CI/CD, custom rules)
  if (trace.totalCost > 5.0) {
    await ralph.reviewTask({
      taskId: task.id,
      action: "reject",
      feedback: "Cost exceeded $5 threshold. Please optimize approach.",
    });
  }
}
```

### The Approve Flow (All Adapters)

Under the hood, approve always does:

1. `git fetch origin`
2. `git merge origin/ralph/<task-id> --no-ff` into main (preserves branch history)
3. `git mv .ralph/tasks/review/<task-id>.md .ralph/tasks/done/<task-id>.md`
4. Update frontmatter: `reviewed_at`, `review_action: approved`
5. `git commit -m "ralph: approve <task-id> - <title>"`
6. `git push origin main`
7. `git push origin --delete ralph/<task-id>` (clean up remote branch)

### The Reject Flow (All Adapters)

1. `git fetch origin`
2. Append `## Review Feedback` section with user's feedback and timestamp
3. `git mv .ralph/tasks/review/<task-id>.md .ralph/tasks/pending/<task-id>.md`
4. Update frontmatter: `status: pending`, increment `revision_count`
5. `git commit -m "ralph: reject <task-id> - <title>"`
6. `git push origin main`
7. `git push origin --delete ralph/<task-id>` (clean up remote branch)

The node picks up the task again with the review feedback visible in the file. The agent sees the feedback and adjusts its approach.

---

## 6. Status & Introspection Display

### Data Sources

Status is assembled from multiple files:

| Source | What it tells us |
|--------|-----------------|
| `.ralph/status.json` | Node heartbeat, current task, node ID |
| `.ralph/tasks/*/` | Queue counts by status |
| `.ralph/traces/*.json` | Execution history, costs, tool usage |
| `git log` | Recent activity timeline |

### `status.json` Format

Written by the node, read by the client:

```json
{
  "node_id": "ralph-vps-01",
  "last_heartbeat": "2026-03-03T14:22:00Z",
  "state": "working",
  "current_task": {
    "id": "task-013",
    "title": "Add rate limiting to the API",
    "started_at": "2026-03-03T14:10:00Z"
  },
  "stats": {
    "tasks_completed_today": 3,
    "tasks_failed_today": 0,
    "uptime_seconds": 28800
  }
}
```

### CLI Output Design

```
$ ralph status

Ralph Status
========================================
Node: ralph-vps-01 | ONLINE
Heartbeat: 2 min ago | Uptime: 8h 0m

Queue
-----
  Pending:   3 tasks
  Active:    1 task   -> Add rate limiting to the API (12m)
  Review:    2 tasks  <- needs your attention
  Done:      7 tasks  (today)
  Failed:    0

Recent Completions
------------------
  task-012  Refactor auth module       $0.31   8m 22s   20m ago
  task-011  Fix CORS headers           $0.12   3m 45s   1h ago
  task-010  Add health check endpoint  $0.08   2m 10s   2h ago

Today's Cost: $1.84 (10 tasks)
```

### CLI with `--json`

```
$ ralph status --json
{
  "node": {
    "nodeId": "ralph-vps-01",
    "state": "working",
    "lastHeartbeat": "2026-03-03T14:22:00Z",
    ...
  },
  "queue": {
    "pending": 3,
    "active": 1,
    ...
  }
}
```

The `--json` flag is critical for scripting. Status checks in CI/CD, monitoring scripts, custom dashboards -- all consume JSON.

---

## 7. Observability Integration

### Execution Traces

The orchestrator writes a trace file after each task execution:

```
.ralph/traces/task-013.json
```

```json
{
  "task_id": "task-013",
  "started_at": "2026-03-03T14:10:00Z",
  "completed_at": "2026-03-03T14:22:34Z",
  "duration_seconds": 754,
  "exit_reason": "completed",
  "model": "claude-opus-4-6",
  "tokens": {
    "input": 45230,
    "output": 12450,
    "cache_read": 8200,
    "cache_write": 3100
  },
  "cost_usd": 0.47,
  "turns": 23,
  "tool_calls": {
    "total": 67,
    "by_tool": {
      "Read": 18,
      "Edit": 12,
      "Bash": 15,
      "Grep": 10,
      "Write": 5,
      "Glob": 7
    }
  },
  "verification": {
    "tests_passed": true,
    "build_passed": true,
    "lint_passed": true
  },
  "retries": 0
}
```

### Cost Aggregation

The `getCosts()` function scans trace files and aggregates:

```typescript
async function getCosts(period: string): Promise<CostSummary> {
  const traces = await scanTraceFiles(period);

  return {
    period,
    totalCost: traces.reduce((sum, t) => sum + t.cost_usd, 0),
    taskCount: traces.length,
    averageCostPerTask: total / traces.length,
    breakdown: traces.map((t) => ({
      taskId: t.task_id,
      cost: t.cost_usd,
      duration: t.duration_seconds,
      model: t.model,
    })),
  };
}
```

### CLI Cost Display

```
$ ralph costs week

Ralph Costs: This Week
========================================
Total:     $12.47 (34 tasks)
Average:   $0.37 per task
Duration:  6h 12m total execution time

By Day:
  Mon  $2.10  (8 tasks)   ########
  Tue  $3.45  (12 tasks)  #############
  Wed  $1.92  (6 tasks)   #######
  Thu  $2.80  (5 tasks)   ###########
  Fri  $2.20  (3 tasks)   #########

Most Expensive:
  task-045  Implement OAuth2 flow       $2.10  45m
  task-038  Refactor database layer     $1.45  28m

Cheapest:
  task-041  Fix typo in README          $0.03  45s
  task-040  Add .gitignore entries      $0.05  1m
```

### Trace Viewing

```
$ ralph trace task-013

Execution Trace: task-013
========================================
Task:     Add rate limiting to the API
Model:    claude-opus-4-6
Duration: 12m 34s
Cost:     $0.47

Tokens:
  Input:       45,230
  Output:      12,450
  Cache read:   8,200
  Cache write:  3,100

Tool Usage (67 calls):
  Read   18  ###############
  Bash   15  ############
  Edit   12  ##########
  Grep   10  ########
  Glob    7  ######
  Write   5  ####

Verification:
  Tests:  PASSED
  Build:  PASSED
  Lint:   PASSED

Exit: completed (normal)
```

The horizontal bar charts use simple `#` characters. No fancy terminal library required. `BOLD` and `GREEN`/`RED` ANSI codes for emphasis on pass/fail.

---

## 8. Git Operations in the Client

### The Fundamental Problem

The client operates on `.ralph/` via git. But the user's project is also a git repo. Client git operations (pull, commit, push) interact with the user's working tree.

### Strategy: Operate on Main Branch Only

Client operations always target `main` (or the configured default branch). They should:

1. **Check for clean working tree** before starting. If there are uncommitted changes in `.ralph/`, warn and abort.
2. **Only stage `.ralph/` files** -- never `git add -A`, always explicit paths.
3. **Use fast-forward pulls** -- `git pull --ff-only` to avoid merge commits.

```typescript
async function ensureCleanRalphState(git: GitPort): Promise<void> {
  const status = await git.status();

  // Check for uncommitted changes in .ralph/
  const ralphChanges = status.modified.filter((f) => f.startsWith(".ralph/"));
  if (ralphChanges.length > 0) {
    throw new RalphError(
      `Uncommitted changes in .ralph/:\n${ralphChanges.join("\n")}\n` +
        `Commit or discard these changes before running Ralph commands.`
    );
  }
}
```

### What If the User Has Uncommitted Changes?

Three scenarios:

1. **Changes outside `.ralph/`**: Totally fine. Ralph only touches `.ralph/` files. The user's work-in-progress is untouched.
2. **Changes inside `.ralph/`**: Warn and abort. The user may have manually edited a task file. They should commit or discard first.
3. **Merge conflicts on pull**: If `git pull --ff-only` fails, it means someone (the node) pushed changes that conflict with local state. The client should:
   - Report the conflict clearly
   - Suggest `git pull --rebase` or manual resolution
   - Never force-push or silently resolve

### What If Push Fails?

Push can fail if the node pushed between our pull and our push. The solution:

```typescript
async function safePush(git: GitPort, maxRetries = 3): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await git.push();
      return;
    } catch {
      // Pull latest, re-apply our change
      await git.pull({ ffOnly: true });
      // Our commit is still in history, pull should fast-forward
      // If it can't, we have a real conflict
    }
  }
  throw new RalphError(
    "Failed to push after 3 attempts. The node may be actively pushing. " +
      "Try again in a moment."
  );
}
```

### Should the Client Use a Separate Worktree?

**No, for v1.** A separate worktree adds complexity:
- The user might not understand why there's a `.claude/worktrees/` directory
- Worktree management (create, clean up) is another thing that can break
- The client only touches `.ralph/` files -- there's no real conflict risk with user files

**Maybe for v2.** If users report issues with git state, a dedicated worktree for Ralph operations would fully isolate the client from the user's working tree. But this is a solution in search of a problem until proven otherwise.

### Commit Message Convention

All client commits follow the pattern:

```
ralph: <action> <task-id> - <title>
```

Examples:
- `ralph: create task-013 - Add rate limiting to the API`
- `ralph: approve task-013 - Add rate limiting to the API`
- `ralph: reject task-013 - Add rate limiting to the API`

This makes `git log --grep="ralph:"` show all Ralph operations cleanly.

---

## 9. Skill vs CLI: When to Use Which

| Dimension | Skill (Claude Code) | CLI (`ralph`) |
|-----------|-------------------|---------------|
| **Best for** | Conversational task creation, review with questions | Quick status checks, scripting, automation |
| **Speed** | Slower (LLM processing) | Instant (direct execution) |
| **Context** | Has full codebase context, can read files, reason about code | No codebase context, just `.ralph/` data |
| **Task creation** | Richer -- Claude can infer acceptance criteria from code | Simpler -- user provides all details manually |
| **Review** | Interactive -- ask questions about changes, get explanations | Faster -- see diff, approve/reject, move on |
| **Output** | Conversational text | Structured, pipe-able, `--json` |
| **Scripting** | Not possible | `ralph status --json \| jq .queue.review` |
| **CI/CD** | Not possible | `ralph task create --json < task.json` |
| **Availability** | Requires Claude Code session | Works anywhere with Bun/Node |
| **Determinism** | Non-deterministic (LLM) | Fully deterministic |

### When to Use the Skill

- **Creating tasks from vague ideas**: "I want rate limiting on the API" -> Claude reads the codebase, understands the API structure, creates a well-specified task with proper acceptance criteria. The CLI can't do this -- it takes exactly what you give it.
- **Feature decomposition**: `/ralph-backlog "Add OAuth2 support"` -> Claude breaks this into 4-5 ordered tasks. The CLI would require you to create each task manually.
- **Code review**: The skill can explain what the agent's code changes do, answer questions about the implementation, suggest improvements before approving.
- **When you're already in Claude Code**: Zero context switch. You're coding, you want to queue a task, `/ralph-task` is right there.

### When to Use the CLI

- **Quick status checks**: `ralph status` is instant. `/ralph-status` waits for Claude to process.
- **Batch operations**: `for id in task-001 task-002 task-003; do ralph review --approve $id; done`
- **CI/CD integration**: GitHub Actions step that creates a task when tests fail.
- **Monitoring scripts**: Cron job that checks `ralph status --json` and alerts if the node is down.
- **When Claude Code isn't available**: SSH session, CI runner, Docker container, another developer's machine.

### Both Share the Same Data

A task created with the skill shows up in `ralph task list`. A task approved with the CLI was created by the node. They're reading and writing the same `.ralph/` directory through git. There's no "skill state" vs "CLI state" -- there's just git.

---

## 10. Implementation Plan

### Phase 1: Client Core (No Adapters Yet)

Build the core library with tests:

1. `TaskFilePort` -- parse/serialize task files with YAML frontmatter
2. `GitPort` -- interface for git operations, with a fake for testing
3. Core functions: `createTask`, `listTasks`, `getStatus`
4. Unit tests with fake git and fake filesystem

**Gate**: `bun test` passes for all core functions with fakes.

### Phase 2: CLI Adapter

Wire the core to a command-line interface:

5. Argument parser
6. Command router
7. Output formatters (plain text + JSON)
8. `ralph init`, `ralph task create`, `ralph task list`, `ralph status`

**Gate**: `ralph status` works against a real git repo with `.ralph/` structure.

### Phase 3: Skills Adapter

Write the skill files that mirror core functionality:

9. `/ralph-task` skill
10. `/ralph-status` skill
11. `/ralph-list` skill
12. `/ralph-review` skill

**Gate**: Full workflow via skills -- create task, check status, review.

### Phase 4: Review + Observability

The complex interactions:

13. `ralph review` in CLI (interactive approve/reject)
14. Trace file reading and cost aggregation
15. `ralph trace`, `ralph costs` commands
16. `ralph doctor` diagnostics

**Gate**: Complete review cycle through both CLI and skills.

### What NOT to Build in V1

- No `/ralph-backlog` (feature decomposition) -- that's a Phase 2 skill
- No `/ralph-cancel`, `/ralph-priority`, `/ralph-pause` -- nice-to-haves
- No web dashboard
- No real-time streaming of agent progress
- No notification system (ntfy.sh, webhooks)
- No multi-node support in the client

---

## 11. Error Handling Patterns

Every client operation can fail. The error messages should be actionable.

### Error Taxonomy

```typescript
class RalphError extends Error {
  constructor(
    message: string,
    public readonly code: RalphErrorCode,
    public readonly suggestion?: string
  ) {
    super(message);
  }
}

type RalphErrorCode =
  | "NOT_INITIALIZED"     // .ralph/ doesn't exist
  | "GIT_NOT_CLEAN"       // uncommitted .ralph/ changes
  | "GIT_PUSH_FAILED"     // push rejected (conflict)
  | "GIT_PULL_FAILED"     // pull failed (diverged)
  | "TASK_NOT_FOUND"      // task ID doesn't exist
  | "INVALID_TRANSITION"  // e.g., approving a pending task
  | "MERGE_CONFLICT"      // branch can't merge cleanly
  | "NO_REMOTE"           // git remote not configured
  | "NODE_NOT_DEPLOYED";  // no status.json found
```

### Error Messages (CLI)

```
$ ralph task create "Fix the bug"
Error: Ralph is not initialized in this project.

  Run `ralph init` to set up the .ralph/ directory structure.
```

```
$ ralph review task-013
Error: Cannot review task-013 -- it is in 'pending' status, not 'review'.

  Only tasks in .ralph/tasks/review/ can be reviewed.
  Current status: pending (.ralph/tasks/pending/task-013.md)
```

```
$ ralph status
Warning: Node may be down. Last heartbeat was 23 minutes ago.

  If the node is running, check its logs:
    ssh <your-vps> docker logs ralph-loop
  If the node is not running:
    ssh <your-vps> docker compose up -d
```

Clear error. What went wrong. What to do about it. Always.

---

## 12. Configuration

### `.ralph/config.json`

```json
{
  "version": 1,
  "node": {
    "id": "ralph-vps-01",
    "poll_interval_seconds": 30,
    "max_retries": 2,
    "max_budget_per_task_usd": 5.0,
    "model": "opus",
    "max_turns": 50
  },
  "client": {
    "default_priority": "normal",
    "default_type": "feature",
    "auto_pull": true,
    "auto_push": true
  },
  "git": {
    "main_branch": "main",
    "branch_prefix": "ralph/"
  }
}
```

The client reads this on every operation. The CLI can override with flags:

```bash
ralph task create "Fix bug" --priority high --type bugfix
```

### Config Defaults

If `config.json` doesn't exist, use sensible defaults. The system should work with zero configuration. `ralph init` creates the config file but it's not required for reading operations.

---

## Summary

The Ralph client is three things wearing one hat:

1. **A library** (`src/client/core.ts`) with typed interfaces, testable with fakes, no side effects beyond git
2. **A CLI** (`src/cli/index.ts`) that calls the library and formats output for terminals
3. **A set of skills** (`.claude/skills/ralph-*/SKILL.md`) that instruct Claude Code to perform the same operations conversationally

The core handles the hard parts: git synchronization, task file parsing, state transitions, conflict detection. The adapters handle presentation: formatted tables for CLI, conversational prompts for skills, raw JSON for programmatic use.

The review workflow is the crown jewel. It must be fast, informative, and low-friction. If reviewing tasks feels like a chore, users won't use the system. The skill adapter excels here -- it lets users ask questions about code changes before deciding. The CLI adapter excels at batch operations -- approve 5 tasks in 30 seconds.

Both adapters share the same `.ralph/` data through git. There is no impedance mismatch. A task created with a skill is reviewed with the CLI. A task created with the CLI is visible in `/ralph-status`. One truth, multiple views.
