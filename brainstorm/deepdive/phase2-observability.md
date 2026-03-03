# Phase 2 Cross-Review: Observability Perspective

> By **observability** | 2026-03-03
>
> Reviewing: core-arch.md, prompt-templates.md, client-interface.md, onboarding.md, node-runtime.md

---

## Agent Rankings

| Rank | Agent | Score | Verdict |
|------|-------|-------|---------|
| 1 | **node-runtime** | 9/10 | Best alignment with observability needs. Structured JSON logs, heartbeat design, log management, and health checks are exactly what we need. Minor gaps only. |
| 2 | **client-interface** | 8/10 | Defines the right introspection commands (`trace`, `costs`, `status`) and references our trace files. A few data-access gaps. |
| 3 | **core-arch** | 7/10 | Solid hexagonal structure, but the `Logger` port is too thin for our needs. The `EventEmitter` was explicitly cut -- that's the single biggest conflict with observability. |
| 4 | **prompt-templates** | 7/10 | Exit criteria evaluation produces the right data at the right layers. Missing some observability hooks in the verification pipeline. |
| 5 | **onboarding** | 6/10 | Good `ralph doctor` and `ralph hello` design. But almost no mention of observability setup, trace directories, or initial configuration of budgets/alerts. |

---

## 1. Core Architecture (`core-arch.md`)

### What Works Well

**The port/adapter structure is clean.** Each port (`TaskRepository`, `SourceControl`, `AgentExecutor`, `Verifier`, `Logger`) has a narrow interface. The composition root in `orchestrator/index.ts` wires everything together. This is exactly the structure that makes observability pluggable.

**`ExecutionResult` captures the right fields.** The type includes `exitCode`, `sessionId`, `costUsd`, `turnsUsed`, `durationMs`, and `stopReason`. These are the six fields I need to populate a trace.

**`VerificationResult` is rich enough.** It has `testsPass`, `buildPass`, `lintPass`, `verified`, and `output`. All of this goes into the execution trace.

### The Critical Problem: Logger Port vs Observability Port

Core-arch defines this Logger port:

```typescript
interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}
```

And then explicitly says:

> **`EventEmitter`** -- Considered an event bus for observability. Cut it. The `Logger` port covers what we need for V1.

**This is the single biggest conflict across all documents.** The Logger port is for textual logging -- writing lines to stdout/journald for human debugging. The observability port is for structured domain events that get consumed by trace writers, heartbeat updaters, cost trackers, and anomaly detectors. These are fundamentally different concerns:

| Concern | Logger | Observability |
|---------|--------|---------------|
| Consumer | Human operator reading logs | Trace files, heartbeat, cost tracker, analytics |
| Format | JSON text lines | Typed domain events |
| Retention | Rotated, ephemeral | Committed to git, permanent |
| Granularity | Per-log-level filtering | Per-event-type routing |
| Action on consume | Print to stdout | Write files, update state, trigger alerts |

**You cannot build execution traces from log lines.** A `log.info("execution_done", { costUsd: 0.82 })` call is a fire-and-forget text emission. There's no way to correlate it with the task's start event, aggregate tool calls, or write a structured trace file -- unless you build a log parser that reconstructs state from text. That's fragile and backwards.

### Proposed Fix

Don't replace the Logger. Keep it for operational logging. Add an `ObservabilityPort` alongside it:

```typescript
// ports/observability.ts
interface ObservabilityPort {
  emit(event: DomainEvent): void;
}
```

The orchestrator loop calls BOTH:
```typescript
log.info("task_claimed", { taskId: task.id });           // for humans
observability.emit({ type: 'task.claimed', taskId, ts }); // for machines
```

The wiring in `main()` adds the observability adapter alongside the logger:
```typescript
const log = new ConsoleLogger();
const observability = new CompositeObservabilityAdapter([
  new TraceWriterAdapter(),
  new HeartbeatAdapter(),
]);
```

This is a minimal change: one new port, same composition pattern, no event bus complexity. The core-arch doc's own reasoning ("if a port would have exactly one method that's called exactly once, it's not a port") doesn't apply here -- `emit()` is called dozens of times per task execution.

### The `AgentExecutor` Port Loses Tool Call Data

The executor port returns `ExecutionResult`:

```typescript
interface ExecutionResult {
  exitCode: number;
  sessionId: string | null;
  costUsd: number | null;
  turnsUsed: number | null;
  durationMs: number;
  stopReason: "end_turn" | "max_turns" | "max_budget" | "refusal" | "error" | "timeout";
}
```

Notice what's missing: **tool call data**. The `ClaudeCliExecutor` adapter uses `--output-format json`, which gives us cost and turns but NOT which tools were called or how many times.

If we want tool call tracking (and my observability deep dive argues we should for V1-should-have), the executor needs to either:
1. Switch to `--output-format stream-json` and parse the NDJSON stream, or
2. Return additional optional fields for tool call summaries.

**Proposed extension:**
```typescript
interface ExecutionResult {
  // ... existing fields ...
  toolCalls?: ToolCallSummary[];  // populated if stream-json parsing is used
}
```

This is backwards-compatible. V1 can return `undefined` for `toolCalls` and still build a valid trace. When we upgrade the executor adapter to stream-json, the data flows through automatically.

### Missing: `durationApiMs` from Claude Output

Claude's JSON output includes both `duration_ms` (wall clock) and `duration_api_ms` (time in API calls). The `ExecutionResult` only captures one duration. The difference tells you how much time was spent in tool execution vs API calls -- useful for understanding whether a task was compute-bound or I/O-bound.

**Proposed fix:** Add `durationApiMs?: number` to `ExecutionResult`.

---

## 2. Prompt Templates & Exit Criteria (`prompt-templates.md`)

### What Works Well

**Exit criteria evaluation is layered correctly.** Four layers: process exit, stop reason, verification, custom checks. Each layer produces clear pass/fail signals that map directly to trace fields.

**The `VerifyResult` type captures structured verification data:**
```typescript
interface VerifyResult {
  passed: boolean;
  test?: { passed: boolean; output: string };
  build?: { passed: boolean; output: string };
  lint?: { passed: boolean; output: string };
}
```

This gives me everything I need for the `verification` section of the execution trace.

**The state transition matrix is deterministic.** Given (all_layers_pass, retries_remaining), the next state is fully determined. No ambiguity for the trace to record.

### Where Data Gets Lost

**Layer 2 (Stop Reason) doesn't capture the raw `subtype` field.** The `evaluateStopReason()` function maps Claude's output to 'continue' | 'retry' | 'fail', but doesn't preserve the original value. The trace needs the original `stop_reason` from Claude's JSON for diagnostics.

```typescript
// Current: lossy mapping
function evaluateStopReason(result: ClaudeResult): 'continue' | 'retry' | 'fail'

// Better: return both the action AND the raw reason
interface StopReasonEvaluation {
  action: 'continue' | 'retry' | 'fail';
  rawStopReason: string;  // preserved from Claude output
  rawSubtype: string;     // "success" | "error_max_turns" etc.
}
```

**Custom check results aren't structured.** The `custom` checks in config:
```json
{
  "custom": [
    { "name": "type-check", "command": "bunx tsc --noEmit", "required": true }
  ]
}
```

These run, but there's no structured output format specified. The verifier should return per-check results in a way that maps to the trace, not just a boolean. Something like:
```typescript
interface CustomCheckResult {
  name: string;
  passed: boolean;
  required: boolean;
  output: string;
  durationMs: number;
}
```

**Per-type exit criteria overrides don't include `max_turns` or `max_budget`.** The config allows per-type overrides for verification requirements:
```json
{
  "per_type_overrides": {
    "refactor": { "require_tests": true, "require_build": true }
  }
}
```

But the observability deep dive identifies that per-type `maxTurns`, `maxBudgetUsd`, and `timeoutSeconds` are the most impactful tuning parameters. The prompt-templates doc handles this in `PromptOutput` via `config.defaults`, but there's no per-type override mechanism for execution limits -- only for verification requirements.

**Proposed addition to config:**
```json
{
  "exit_criteria": {
    "defaults": { "max_turns": 50, "max_budget_usd": 5.00, "timeout_seconds": 1800 },
    "per_type": {
      "bugfix": { "max_turns": 40, "max_budget_usd": 3.00 },
      "feature": { "max_turns": 80, "max_budget_usd": 8.00 }
    }
  }
}
```

### Verification Duration Isn't Tracked

The `verify()` function runs test/build/lint commands but doesn't time them. Verification duration matters: if `bun test` takes 90 seconds, that's significant wall-clock time that should show up in the trace. The trace's `verification.duration_ms` field needs to be populated.

**Fix:** Wrap each check in timing:
```typescript
const start = Date.now();
const result = await runCommand(config.test, cwd);
const durationMs = Date.now() - start;
```

---

## 3. Client Interface (`client-interface.md`)

### What Works Well

**The introspection commands are exactly right.** The `RalphClientPort` includes:
```typescript
getTrace(taskId: string): Promise<ExecutionTrace>;
getCosts(period?: 'today' | 'week' | 'month' | 'all'): Promise<CostSummary>;
getStatus(): Promise<{ node: NodeStatus; queue: QueueStatus }>;
```

These map 1:1 to the `ralph trace`, `ralph costs`, and `ralph status` commands from my observability deep dive.

**The `ExecutionTrace` type in client-interface is compatible with mine:**
```typescript
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
```

This is a subset of my more detailed `ExecutionTrace` (which also includes `verification`, `attempt`, `model`, budget limits, etc.), but it covers the core fields the client needs to display.

**The `/ralph-review` skill reads trace files.** Step 4c explicitly says:
```
c. Show execution trace (if available):
   - Read `.ralph/traces/<task-id>.json`
   - Show: duration, cost, token usage, number of tool calls
```

This means the skill is already designed to consume my trace format.

### Where Data Access Is Insufficient

**`getStatus()` can't show real-time cost.** The `QueueStatus` type has `recentlyCompleted: TaskSummary[]` but no `todayCost` or `currentTaskCost` field. The status command should show "Cost today: $3.42" which requires reading the trace index.

**Proposed addition to `QueueStatus`:**
```typescript
interface QueueStatus {
  // ... existing fields ...
  todayCost: number;
  todayTaskCount: number;
}
```

**The `/ralph-status` skill reads a non-existent `status.json`.** The skill says:
```
2. Read `.ralph/status.json` for node heartbeat info.
```

But the node-runtime doc writes the heartbeat to `/home/ralph/heartbeat.json` (outside `.ralph/`), and my observability doc writes it to `.ralph/heartbeat.json`. These three locations need to be reconciled.

**Resolution:** The heartbeat should be at `.ralph/heartbeat.json` on the VPS disk (inside the workspace), NOT committed to git. The skill needs SSH access or a git-pushed summary to read it. For V1, the skill should show the LAST KNOWN state from the most recent git commit (claim commit timestamp), not a live heartbeat.

**Missing: `ralph analytics` and `ralph history` commands.** Client-interface defines `status`, `trace`, and `costs` but not the aggregate `analytics` or `history` commands from my observability deep dive. These should be added to `RalphClientPort`:

```typescript
interface RalphClientPort {
  // ... existing ...
  getHistory(options?: { limit?: number; since?: Date }): Promise<TaskSummary[]>;
  getAnalytics(): Promise<AnalyticsReport>;
}
```

### The Skill/CLI Divergence Problem

Client-interface correctly identifies this:

> If the core function and the skill diverge, the skill is a bug.

For observability, this means: if the CLI's `ralph trace` reads `.ralph/traces/<id>.json` and shows 15 fields, but the `/ralph-review` skill only reads 4 of those fields, the user gets inconsistent information depending on which interface they use.

**Recommendation:** Define a canonical "trace summary" format (5-6 key fields) that both the CLI and skill display. The CLI's `ralph trace` can show the full detail; the skill's review flow shows the summary.

---

## 4. Onboarding (`onboarding.md`)

### What Works Well

**`ralph doctor` checks system health exhaustively.** The diagnostic checks cover git, SSH, API keys, Docker, node reachability. This is the operational observability that my deep dive doesn't cover -- it focuses on task-level observability. Together they're comprehensive.

**`ralph hello` is a full lifecycle test.** It proves the system works end-to-end. If hello succeeds, observability data was generated (a trace file should exist for `hello-001`).

### What's Missing

**No mention of `.ralph/traces/` directory setup.** The `ralph init project` command creates:
```
.ralph/tasks/pending/
.ralph/tasks/active/
.ralph/tasks/review/
.ralph/tasks/done/
.ralph/tasks/failed/
.ralph/templates/default.md
.ralph/config.json
```

But NOT `.ralph/traces/`. When the first task completes and the trace writer tries to write `.ralph/traces/task-001.json`, the directory won't exist.

**Fix:** Add `.ralph/traces/` (with `.gitkeep`) to the `ralph init project` scaffolding.

**No budget configuration in onboarding.** The `config.json` from onboarding includes:
```json
{
  "task_defaults": {
    "max_budget_usd": 5,
    "model": "claude-sonnet-4-20250514"
  }
}
```

But no system-level budgets (daily, weekly, monthly). A new user should be prompted for budget limits during `ralph init project`, or at minimum get sensible defaults:
```json
{
  "budgets": {
    "daily": 50.00,
    "weekly": 200.00,
    "monthly": 500.00,
    "alert_at_percent": 80
  }
}
```

Without this, the cost tracking system has nothing to compare against, and the user gets no warnings until their Anthropic account runs dry.

**`ralph hello` should verify trace generation.** After the hello task completes, the output should show:
```
Execution trace:
  Duration: 15s
  Cost: $0.05
  Turns: 3
  Tool calls: 4 (Read: 1, Write: 1, Bash: 2)
```

This proves observability works AND introduces the user to the trace data. Currently, `ralph hello` only shows the task result (the file created) but not the execution metadata.

**`ralph doctor` should check trace index integrity.** Add a check:
```
[PASS] .ralph/traces/ directory exists
[PASS] Trace index has 12 entries (12 completed tasks)
[WARN] 1 completed task has no trace file (task-003)
```

---

## 5. Node Runtime (`node-runtime.md`)

### What Works Well

**Structured JSON logs are perfectly aligned.** The log format:
```typescript
interface LogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  task_id?: string;
  detail?: Record<string, unknown>;
}
```

This is parseable, greppable, and already includes `task_id`. The log events table maps cleanly to domain events:

| Log Event | Domain Event Equivalent |
|-----------|------------------------|
| `task.claimed` | `task.claimed` |
| `task.execution.started` | `execution.started` |
| `task.execution.completed` | `execution.completed` |
| `task.verification.passed` | `verification.completed` (passed=true) |

**If** we keep the Logger-only approach (no ObservabilityPort), these structured logs could potentially be parsed to reconstruct traces. It's fragile but not impossible.

**The heartbeat design is solid:**
```typescript
interface Heartbeat {
  timestamp: string;
  state: 'idle' | 'polling' | 'claiming' | 'executing' | 'verifying' | 'pushing';
  uptime_seconds: number;
  active_task: string | null;
  last_task_completed: string | null;
  last_task_completed_at: string | null;
  total_tasks_completed: number;
  total_tasks_failed: number;
  version: string;
  pid: number;
}
```

This is richer than my observability design's heartbeat (which focused on per-task state). The node-runtime version adds cumulative counters (`total_tasks_completed`, `total_tasks_failed`) and system info (`version`, `pid`, `uptime_seconds`). These are good additions.

**Docker health check uses heartbeat freshness.** The `HEALTHCHECK` directive checks if the heartbeat file was modified within 5 minutes. This is the right signal for "is the orchestrator alive?"

### Alignment Issues

**Heartbeat file location conflict.** Three different locations are mentioned across documents:

| Document | Location |
|----------|----------|
| node-runtime | `/home/ralph/heartbeat.json` (outside workspace) |
| client-interface | `.ralph/status.json` (different filename!) |
| observability | `.ralph/heartbeat.json` (inside workspace) |

**Resolution:** The heartbeat should live at `<workspace>/.ralph/heartbeat.json`. It's inside the workspace (accessible to the orchestrator regardless of deployment), uses a consistent name, and lives under the `.ralph/` namespace where all Ralph state belongs. It MUST be gitignored.

**Log management doesn't mention trace files.** The log rotation and retention section covers operational logs (stdout/journald) but not the `.ralph/traces/` directory which grows monotonically. After 1000 tasks, that's 1000 JSON files. This won't be large (each trace is ~2KB), but it should be acknowledged and a cleanup strategy documented.

**Docker volume mapping doesn't persist traces.** The docker-compose.yml maps:
```yaml
volumes:
  - ralph-workspace:/home/ralph/workspace
  - ralph-logs:/home/ralph/logs
```

The workspace volume preserves the `.ralph/traces/` directory (since it's inside the workspace). Good -- but only by accident, not by design. It should be explicitly documented that the workspace volume is the trace archive.

**The `task.execution.tool_call` log event is marked `debug` level.** From the log event table:
```
task.execution.tool_call | debug | Each tool call (if streaming)
```

This means tool calls are only logged at debug level. In production (`LOG_LEVEL=info`), they're invisible. For observability, tool calls are not debug noise -- they're core execution data. Either:
1. Log them at `info` level (noisy but complete), or
2. Don't rely on logs for tool call data -- use the ObservabilityPort instead (my recommendation).

### Missing: Claude Code Session Logs

Node-runtime doesn't mention the Claude Code JSONL session logs at `~/.claude/projects/<project>/<session-id>.jsonl`. These are a rich data source that persists on the VPS disk. In Docker, they're inside the container at `/home/ralph/.claude/projects/...`.

**If** we want to preserve these for post-hoc analysis (and we should -- they contain the full conversation transcript), we need to either:
1. Mount a volume for `~/.claude/` in Docker, or
2. Copy the JSONL file to `.ralph/traces/<task-id>.session.jsonl` after each execution.

Option 2 is cleaner: it collocates the session log with the trace file and commits it to git for the user to review.

---

## Conflicts Requiring Resolution

### Conflict 1: Logger vs ObservabilityPort (CRITICAL)

**Parties:** core-arch vs observability

**core-arch says:** "No EventEmitter. Logger covers V1."
**observability says:** "We need a typed event port for traces, heartbeat, and cost tracking."

**Resolution:** Add `ObservabilityPort` as a new port alongside `Logger`. Logger stays for operational text logging. ObservabilityPort handles structured domain events that feed trace files and analytics. The core-arch argument that "Logger covers what we need" is wrong -- Logger covers operational debugging; it does NOT cover trace generation, cost aggregation, or anomaly detection.

This is the single most important decision for V1. Without it, traces become an afterthought bolted onto log parsing.

### Conflict 2: Heartbeat Location (MODERATE)

**Parties:** node-runtime vs client-interface vs observability (three-way disagreement)

**Resolution:** `<workspace>/.ralph/heartbeat.json`. Gitignored. One canonical location that works for Docker, bare VPS, and local development.

### Conflict 3: `ExecutionResult` Missing Tool Calls (MODERATE)

**Parties:** core-arch vs observability

**core-arch says:** `ExecutionResult` has 6 fields (exit code, session, cost, turns, duration, stop reason).
**observability says:** We need tool call summaries in the trace.

**Resolution:** Add `toolCalls?: ToolCallSummary[]` as an optional field to `ExecutionResult`. The V1 executor adapter returns `undefined`. When stream-json parsing is implemented (V1 should-have or V2), the field gets populated.

### Conflict 4: Trace Directory Not In Scaffolding (LOW)

**Parties:** onboarding vs observability

**Resolution:** Add `.ralph/traces/` with `.gitkeep` to the `ralph init project` scaffolding. Trivial fix.

### Conflict 5: Per-Type Execution Limits (LOW)

**Parties:** prompt-templates vs observability

**prompt-templates says:** Per-type overrides exist for verification requirements only.
**observability says:** Per-type overrides for `maxTurns`, `maxBudgetUsd`, `timeoutSeconds` are the most impactful tuning parameters.

**Resolution:** Extend the config schema to support per-type execution limits alongside per-type verification requirements. Both live under `exit_criteria` in config.

---

## Data Loss Inventory

Places where observability data is generated but not captured or not surfaced:

| Data | Generated By | Currently Lost? | Fix |
|------|-------------|----------------|-----|
| Tool call names/counts | Claude stream-json events | Yes (V1 uses `--output-format json`) | Switch executor to stream-json, or defer to V2 |
| `duration_api_ms` | Claude JSON output | Yes (not mapped to ExecutionResult) | Add field to `ExecutionResult` |
| Verification duration | Verifier adapter | Yes (not timed) | Add timing to `verify()` |
| Custom check individual results | Verifier adapter | Partially (boolean only, no per-check detail) | Return structured `CustomCheckResult[]` |
| Claude session transcript | `~/.claude/projects/` JSONL | Yes (not preserved in Docker restart) | Mount volume or copy to traces dir |
| Raw Claude stop reason | executor evaluateStopReason | Yes (mapped to action, original lost) | Preserve raw value in return type |
| Cost running totals | Trace index | Not lost, but not surfaced until `ralph costs` is built | Build `ralph costs` command |

---

## Implementation Recommendations (Priority Order)

### Before V1 Ships

1. **Add `ObservabilityPort` to core-arch.** This unblocks trace generation, heartbeat updates, and cost tracking as first-class concerns rather than log-parsing afterthoughts.

2. **Add `.ralph/traces/` to `ralph init project` scaffolding.** Otherwise the first completed task will fail to write its trace.

3. **Reconcile heartbeat location to `<workspace>/.ralph/heartbeat.json`.** All three documents need to agree.

4. **Add `durationApiMs` and optional `toolCalls` to `ExecutionResult`.** Backwards-compatible, no breakage.

5. **Add budget config to `ralph init project`.** Users need defaults for daily/weekly/monthly limits.

### For V1 Quality

6. **Time verification steps.** Add `durationMs` to each verification result.

7. **Preserve raw stop reason in executor.** Don't discard Claude's original `subtype` field.

8. **Add `todayCost` to `QueueStatus` in client-interface.** The status command should always show cost context.

9. **Add `ralph history` and `ralph analytics` to `RalphClientPort`.** These are core introspection commands.

### For V2

10. **Switch executor to stream-json for tool call tracking.**
11. **Persist Claude session JSONL in traces directory.**
12. **Add per-type execution limits to config schema.**
