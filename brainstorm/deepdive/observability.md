# Deep Dive: Observability, Metrics & Introspection

> Architecture B context: TypeScript/Bun orchestrator, hexagonal architecture, Claude Code via `claude -p --output-format json`

---

## 1. What Data Does Claude Code Produce?

This is the foundation. Everything else in this document depends on understanding exactly what comes out of a `claude -p` invocation.

### 1.1 JSON Output (`--output-format json`)

When you run:
```bash
claude -p "do the thing" --output-format json --max-turns 50 --max-budget-usd 5
```

You get back a single JSON object on stdout:

```json
{
  "type": "result",
  "subtype": "success",
  "total_cost_usd": 0.0034,
  "is_error": false,
  "duration_ms": 2847,
  "duration_api_ms": 1923,
  "num_turns": 4,
  "result": "I've fixed the null check in auth.ts...",
  "session_id": "abc-123-def"
}
```

**Available fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"result"` | Always "result" for the final output |
| `subtype` | `"success" \| "error"` | Whether the run succeeded or errored |
| `total_cost_usd` | `number` | Total API cost in USD for this invocation |
| `is_error` | `boolean` | Whether an error occurred |
| `duration_ms` | `number` | Wall-clock duration in milliseconds |
| `duration_api_ms` | `number` | Time spent in API calls (excludes tool execution time) |
| `num_turns` | `number` | Number of agentic turns taken |
| `result` | `string` | The final text response from Claude |
| `session_id` | `string` | Unique session identifier (UUID) |

**What's NOT directly available in the JSON result:**
- Per-tool breakdown (which tools were called, how many times)
- Per-turn token counts
- Model used (you set it, so you know it)
- Cache hit/miss rates
- Individual tool call durations

### 1.2 Stream-JSON Output (`--output-format stream-json`)

This is the gold mine. When you use `--output-format stream-json --verbose --include-partial-messages`, you get newline-delimited JSON (NDJSON) with every event:

```bash
claude -p "do the thing" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages
```

Event types in the stream:

| Event Type | Description |
|------------|-------------|
| `message_start` | New message begins |
| `content_block_start` | New content block (text or tool_use) |
| `content_block_delta` | Incremental text or tool input |
| `content_block_stop` | Content block complete |
| `message_delta` | Message-level updates (stop reason, usage) |
| `message_stop` | Message complete |

**For tool call tracking**, `content_block_start` with `content_block.type === "tool_use"` gives you:
- `content_block.name` — the tool name (Read, Edit, Bash, etc.)
- Subsequent `content_block_delta` events give the tool input
- The corresponding `tool_result` gives you the output

**This is the critical design decision for Ralph: do we use `json` or `stream-json`?**

### 1.3 Local JSONL Session Logs

Claude Code stores session transcripts locally at:
```
~/.claude/projects/<project-name>/<conversation-id>.jsonl
```

Each JSONL file contains the full conversation for a session, including:
- Token counts per message (input, output, cache creation, cache read)
- Model information
- Tool calls and results
- Timestamps

This is what tools like `ccusage` parse for analytics. However, **on a VPS running in Docker, these logs are inside the container** unless we mount the volume. This matters for post-execution analysis.

### 1.4 The `/cost` Command (Interactive Only)

In interactive mode, `/cost` shows:
```
Total cost:            $0.55
Total duration (API):  6m 19.7s
Total duration (wall): 6h 33m 10.2s
Total code changes:    0 lines added, 0 lines removed
```

Not available in `-p` mode, but `total_cost_usd` in the JSON output gives us the same data.

### 1.5 Agent SDK (TypeScript/Python)

If Ralph eventually moves from CLI to the Agent SDK, we get much richer data:

```typescript
for await (const message of query({ prompt: "..." })) {
  if (message.type === "assistant") {
    // Per-step: message.message.usage.input_tokens, output_tokens
    // Cache: cache_creation_input_tokens, cache_read_input_tokens
  }
  if (message.type === "result") {
    // total_cost_usd — authoritative total
    // modelUsage — per-model breakdown (if using subagents)
    //   { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD }
  }
}
```

**Recommendation for V1:** Use `--output-format stream-json` for execution, parse the NDJSON stream in real-time to extract tool calls, then capture the final `result` message for cost/duration/session_id. This gives us the richest data without needing the Agent SDK.

---

## 2. Execution Trace Design

Every task execution must produce a trace. This is the forensic record that answers "what happened?"

### 2.1 What Goes In a Trace

```typescript
interface ExecutionTrace {
  // Identity
  taskId: string;
  sessionId: string;  // from Claude JSON output
  branch: string;     // ralph/<task-id>

  // Timing
  startedAt: string;  // ISO 8601
  completedAt: string;
  durationMs: number;
  durationApiMs: number;

  // Cost
  totalCostUsd: number;

  // Turns & Tokens
  numTurns: number;
  // If using stream-json, we can populate these:
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;

  // Tool Usage
  toolCalls: ToolCallSummary[];
  toolCallCount: number;

  // Outcome
  result: "success" | "error" | "timeout" | "budget_exceeded";
  stopReason: string;     // from Claude: end_turn, max_turns, budget
  exitCode: number;       // process exit code

  // Verification
  verification: {
    ran: boolean;
    passed: boolean;
    testsPassed?: number;
    testsFailed?: number;
    buildSucceeded?: boolean;
    lintClean?: boolean;
    duration_ms: number;
  };

  // Retries
  attempt: number;        // 1 = first try, 2 = first retry, etc.
  maxRetries: number;

  // Context
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  taskType: string;       // bugfix, feature, refactor, etc.
}

interface ToolCallSummary {
  tool: string;           // Read, Edit, Write, Bash, Grep, Glob, Agent
  count: number;
  // Optional detail for Bash:
  commands?: string[];    // "npm test", "git diff", etc.
}
```

### 2.2 How to Populate the Trace

**From `--output-format json` (minimum viable):**
```
total_cost_usd  → trace.totalCostUsd
duration_ms     → trace.durationMs
duration_api_ms → trace.durationApiMs
num_turns       → trace.numTurns
session_id      → trace.sessionId
subtype         → trace.result (success/error)
is_error        → trace.result
```

**From `--output-format stream-json` (rich trace):**
Parse the NDJSON stream as it flows. For each `content_block_start` with `type: "tool_use"`:
```typescript
if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
  currentToolCall = event.content_block.name;
  toolCounts[currentToolCall] = (toolCounts[currentToolCall] || 0) + 1;
}
```

For token counts, `message_delta` events contain usage data.

**From the orchestrator itself:**
```
startedAt       → Date.now() before invoking Claude
completedAt     → Date.now() after Claude exits
branch          → constructed from task.id
attempt         → from retry counter
verification.*  → from verifier module output
```

### 2.3 Storage Format

**Per-task trace file:** `.ralph/traces/<task-id>.json`

```
.ralph/
  traces/
    task-001.json
    task-001.attempt-2.json    # if retried
    task-002.json
```

**Why JSON, not JSONL?** Each trace is a complete document. JSONL is for append-only logs. A trace is a finished artifact. One file per task, one object per file.

**Why not frontmatter in the task file?** The task file belongs to the user (they wrote it) and has a clear lifecycle (pending -> done). The trace is an operational artifact generated by the system. Mixing them couples concerns. The task file in `done/` says "this was the task." The trace file says "this is what happened when we ran it."

### 2.4 Aggregate Trace Index

For querying across tasks without reading every trace file:

```
.ralph/traces/index.jsonl
```

One line per completed task:
```jsonl
{"taskId":"task-001","completedAt":"2026-03-03T14:22:00Z","costUsd":0.82,"numTurns":12,"toolCalls":23,"result":"success","taskType":"bugfix","attempt":1}
{"taskId":"task-002","completedAt":"2026-03-03T15:01:00Z","costUsd":2.15,"numTurns":35,"toolCalls":47,"result":"success","taskType":"feature","attempt":1}
```

JSONL here makes sense: it's append-only, one line per task, cheap to parse for analytics.

---

## 3. Cost Tracking

### 3.1 Per-Task Cost

This comes directly from the Claude JSON output: `total_cost_usd`. No estimation needed, no token-to-dollar conversion — Claude gives us the real number.

```typescript
// In executor.ts
const result = JSON.parse(claudeOutput);
trace.totalCostUsd = result.total_cost_usd;
```

If a task retries, the total cost is the sum across attempts:
```typescript
const totalTaskCost = traces
  .filter(t => t.taskId === taskId)
  .reduce((sum, t) => sum + t.totalCostUsd, 0);
```

### 3.2 Running Totals

Derived from the trace index:

```typescript
function costSummary(index: TraceLine[]): CostSummary {
  const now = new Date();
  const today = startOfDay(now);
  const thisWeek = startOfWeek(now);
  const thisMonth = startOfMonth(now);

  return {
    today: sum(index.filter(t => t.completedAt >= today), 'costUsd'),
    thisWeek: sum(index.filter(t => t.completedAt >= thisWeek), 'costUsd'),
    thisMonth: sum(index.filter(t => t.completedAt >= thisMonth), 'costUsd'),
    allTime: sum(index, 'costUsd'),
    taskCount: index.length,
    averagePerTask: sum(index, 'costUsd') / index.length,
  };
}
```

### 3.3 Cost Projection

Based on queue depth and historical averages:

```typescript
function projectCosts(pending: Task[], history: TraceLine[]): Projection {
  // Average cost by task type
  const avgByType = groupBy(history, 'taskType')
    .map(([type, traces]) => [type, avg(traces, 'costUsd')]);

  // Project pending tasks
  const projected = pending.reduce((sum, task) => {
    const typeCost = avgByType.get(task.type) ?? avgByType.get('default');
    return sum + typeCost;
  }, 0);

  return {
    pendingTaskCount: pending.length,
    projectedCost: projected,
    confidence: history.length > 20 ? 'high' : history.length > 5 ? 'medium' : 'low',
  };
}
```

### 3.4 Budget Alerts

Two levels:

1. **Per-task budget** — Already built into Claude Code: `--max-budget-usd 5`. If Claude exceeds this, it stops. The orchestrator reads `subtype` to detect `"error"` with a budget exceeded indication.

2. **System-wide budget** — Ralph tracks cumulative spend and can pause:
   ```typescript
   // In config.json
   {
     "budgets": {
       "perTask": 5.00,
       "daily": 50.00,
       "weekly": 200.00,
       "monthly": 500.00
     }
   }
   ```

   Before claiming a task:
   ```typescript
   const todaySpend = costSummary(index).today;
   if (todaySpend >= config.budgets.daily) {
     log.warn(`Daily budget of $${config.budgets.daily} reached ($${todaySpend}). Pausing.`);
     await sleep(untilMidnight());
     continue;
   }
   ```

### 3.5 Surfacing Cost to the User

Costs show up in three places:

1. **Task completion commit message:**
   ```
   ralph(task-001): completed [bugfix] $0.82 | 12 turns | 23 tool calls
   ```

2. **Task frontmatter update** (when moved to `done/`):
   ```yaml
   cost_usd: 0.82
   turns: 12
   duration_s: 45
   ```

3. **`ralph costs` command** (see Section 8).

---

## 4. Tool Usage Analytics

### 4.1 Capturing Tool Calls

**With `stream-json`**, we parse tool calls in real-time:

```typescript
class ToolTracker {
  private calls: Map<string, number> = new Map();
  private bashCommands: string[] = [];

  onStreamEvent(event: StreamEvent) {
    if (event.type === "content_block_start"
        && event.content_block?.type === "tool_use") {
      const tool = event.content_block.name;
      this.calls.set(tool, (this.calls.get(tool) ?? 0) + 1);
    }

    // Track Bash command details from input
    if (event.type === "content_block_delta"
        && event.delta?.type === "input_json_delta"
        && this.currentTool === "Bash") {
      this.accumulateBashInput(event.delta.partial_json);
    }
  }

  summary(): ToolCallSummary[] {
    return [...this.calls.entries()].map(([tool, count]) => ({
      tool,
      count,
      ...(tool === "Bash" ? { commands: this.bashCommands } : {}),
    }));
  }
}
```

**Without stream-json (fallback):** Parse the local JSONL session log after execution:
```
~/.claude/projects/<project>/<session-id>.jsonl
```

### 4.2 What Tool Patterns Tell You

| Pattern | Signal |
|---------|--------|
| High Read, low Edit | Agent spent most time understanding code, not changing it |
| High Bash count | Agent ran many commands — might indicate trial-and-error debugging |
| High Grep/Glob | Agent was searching extensively — might need better `files:` hints in the task |
| Multiple Write calls | Agent created new files — review carefully |
| Agent tool calls | Agent spawned subagents — nested complexity |
| Edit count > 10 | Significant refactoring — pay extra attention in review |
| Bash with `npm test` repeated | Tests were failing and agent was iterating |

### 4.3 Anomaly Detection

After accumulating enough history (say 20+ tasks):

```typescript
function detectAnomalies(trace: ExecutionTrace, history: TraceLine[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const typeHistory = history.filter(h => h.taskType === trace.taskType);

  if (typeHistory.length < 5) return []; // not enough data

  const avgToolCalls = avg(typeHistory, 'toolCallCount');
  const avgCost = avg(typeHistory, 'costUsd');
  const avgTurns = avg(typeHistory, 'numTurns');

  if (trace.toolCallCount > avgToolCalls * 3) {
    anomalies.push({
      type: 'high_tool_calls',
      message: `${trace.toolCallCount} tool calls (avg: ${avgToolCalls.toFixed(0)} for ${trace.taskType})`,
      severity: 'warning',
    });
  }

  if (trace.totalCostUsd > avgCost * 3) {
    anomalies.push({
      type: 'high_cost',
      message: `$${trace.totalCostUsd.toFixed(2)} (avg: $${avgCost.toFixed(2)} for ${trace.taskType})`,
      severity: 'warning',
    });
  }

  return anomalies;
}
```

Anomalies get included in the trace and surfaced in `ralph status` / commit messages.

---

## 5. Entry/Exit Criteria Tuning

This is where observability becomes prescriptive rather than just descriptive.

### 5.1 Entry Criteria

Entry criteria answer: "Is this task ready to run?"

| Criterion | Source | Default |
|-----------|--------|---------|
| Task file is valid YAML+MD | Task parser | Always checked |
| Required fields present (`type`, `acceptance_criteria`) | Task parser | Always checked |
| Dependencies met (if `depends_on` specified) | Task queue | Checked if present |
| Daily budget not exceeded | Cost tracker | Configurable |
| No concurrent task running (V1) | State machine | Always checked |

Entry criteria are mostly static in V1. Observability doesn't tune them much — they're either met or not.

### 5.2 Exit Criteria

Exit criteria answer: "When does the agent stop?"

| Criterion | Claude Flag | Default |
|-----------|-------------|---------|
| Max turns | `--max-turns` | 50 |
| Max budget | `--max-budget-usd` | 5.00 |
| Timeout | `timeout` command wrapper | 1800s (30 min) |
| Tests pass | Verifier module | Required |
| Build succeeds | Verifier module | Required |

### 5.3 How Observability Tunes Exit Criteria

This is the key insight: **trace history tells you whether your exit criteria are calibrated correctly.**

```typescript
function tuningRecommendations(history: TraceLine[]): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const byType = groupBy(history, 'taskType');

  for (const [type, traces] of byType) {
    const avgTurns = avg(traces, 'numTurns');
    const maxTurns = max(traces, 'numTurns');
    const avgCost = avg(traces, 'costUsd');
    const maxCost = max(traces, 'costUsd');
    const hitTurnLimit = traces.filter(t => t.stopReason === 'max_turns').length;
    const hitBudgetLimit = traces.filter(t => t.stopReason === 'budget').length;

    // Turn limit too low?
    if (hitTurnLimit / traces.length > 0.2) {
      recommendations.push({
        type: 'increase_max_turns',
        taskType: type,
        message: `${(hitTurnLimit/traces.length*100).toFixed(0)}% of '${type}' tasks hit the turn limit. Average: ${avgTurns.toFixed(0)} turns, max: ${maxTurns}. Consider increasing --max-turns.`,
        currentValue: config.maxTurns,
        suggestedValue: Math.ceil(maxTurns * 1.5),
      });
    }

    // Budget too generous?
    if (maxCost < config.maxBudgetUsd * 0.3) {
      recommendations.push({
        type: 'decrease_budget',
        taskType: type,
        message: `'${type}' tasks average $${avgCost.toFixed(2)} (max $${maxCost.toFixed(2)}). Your budget of $${config.maxBudgetUsd} is very generous.`,
        currentValue: config.maxBudgetUsd,
        suggestedValue: Math.ceil(maxCost * 2 * 100) / 100,
      });
    }

    // Timeout too low?
    const avgDuration = avg(traces, 'durationMs');
    const hitTimeout = traces.filter(t => t.result === 'timeout').length;
    if (hitTimeout > 0) {
      recommendations.push({
        type: 'increase_timeout',
        taskType: type,
        message: `${hitTimeout} '${type}' tasks timed out. Average duration: ${(avgDuration/1000).toFixed(0)}s.`,
      });
    }
  }

  return recommendations;
}
```

Example output:
```
Tuning recommendations based on 45 task executions:

  [bugfix] 15% of tasks hit the turn limit (50). Average: 32 turns, max: 48.
           Consider increasing --max-turns to 72.

  [bugfix] Average cost: $0.82 (max $1.45). Your budget of $5.00 is generous.
           Consider lowering to $3.00.

  [feature] Average: 28 turns, $2.15. 0% hit limits. Current settings look good.

  [refactor] 40% of tasks timed out at 1800s. Average duration: 1450s.
             Consider increasing timeout to 3600s.
```

### 5.4 Per-Type Configuration

Observability data naturally leads to per-type exit criteria:

```json
{
  "exitCriteria": {
    "default": { "maxTurns": 50, "maxBudgetUsd": 5.00, "timeoutS": 1800 },
    "bugfix":  { "maxTurns": 40, "maxBudgetUsd": 3.00, "timeoutS": 1200 },
    "feature": { "maxTurns": 80, "maxBudgetUsd": 8.00, "timeoutS": 3600 },
    "refactor":{ "maxTurns": 60, "maxBudgetUsd": 5.00, "timeoutS": 2400 }
  }
}
```

The tuning recommendations can suggest these values, but the user always approves changes.

---

## 6. Real-Time vs After-the-Fact Monitoring

### 6.1 What You Can See WHILE a Task Is Running

| Signal | Mechanism | Latency |
|--------|-----------|---------|
| "Task claimed" | Git commit on main | Seconds (after push) |
| "Branch created" | Git branch exists | Seconds |
| Commits on the branch | `git log ralph/<task-id>` | As Claude commits (if it does) |
| Heartbeat | `.ralph/heartbeat.json` on disk (NOT in git) | Updated every 30s |
| Stream events | If using stream-json: real-time tool calls | Real-time |

**Heartbeat file (on disk only, never committed):**
```json
{
  "taskId": "task-001",
  "startedAt": "2026-03-03T14:00:00Z",
  "lastActiveAt": "2026-03-03T14:05:30Z",
  "turnsCompleted": 8,
  "toolCallsSoFar": 15,
  "currentCostUsd": 0.45,
  "status": "executing"
}
```

Updated by the orchestrator as stream-json events come in (if using stream-json) or periodically.

**Why not commit heartbeats?** Because:
1. It pollutes git history with noise
2. It can conflict with agent commits on the same branch
3. It's ephemeral information — only useful while the task is running
4. The consensus doc explicitly says "No heartbeat commits in git"

### 6.2 What You Can See AFTER a Task Completes

| Data | Location | Access |
|------|----------|--------|
| Full execution trace | `.ralph/traces/<task-id>.json` | Committed to git |
| Task outcome | Task file in `done/` or `failed/` with updated frontmatter | Committed to git |
| Branch diff | `git diff main...ralph/<task-id>` | Git |
| Cost summary | Trace index + commit message | Git |
| Tool call breakdown | Trace file | Committed to git |
| Anomaly alerts | Trace file | Committed to git |

### 6.3 Client Access Patterns

**While running (from laptop):**
```bash
# Check if anything is happening
git fetch origin && git log --oneline -5 origin/main

# See the heartbeat (requires SSH to VPS)
ssh ralph-vps cat /app/.ralph/heartbeat.json

# Or: ralph skill checks a git-pushed status marker
ralph status  # shows last known state from git
```

**After completion (from laptop):**
```bash
git pull
ralph trace task-001    # reads .ralph/traces/task-001.json
ralph costs             # reads .ralph/traces/index.jsonl
ralph history           # reads trace index + task dirs
```

### 6.4 The Real-Time Gap

There's an inherent gap: while a task is running, the client can only see what's been pushed to git. The heartbeat is local to the VPS. This is acceptable for V1:

- The user submitted a task and walked away. They don't need millisecond-level updates.
- When they come back, everything is in git.
- For "is it still alive?" — the git log shows the claim commit. If that was recent, it's running.
- For VPS-local monitoring, SSH access or a simple status endpoint (V2) fills the gap.

---

## 7. The Observability Port (Hexagonal Architecture)

### 7.1 Domain Events

The core domain produces events. It does not know or care how they are consumed.

```typescript
// domain/events.ts
type DomainEvent =
  | { type: 'task.claimed'; taskId: string; timestamp: string }
  | { type: 'execution.started'; taskId: string; sessionId: string; timestamp: string }
  | { type: 'execution.tool_called'; taskId: string; tool: string; timestamp: string }
  | { type: 'execution.turn_completed'; taskId: string; turnNumber: number; timestamp: string }
  | { type: 'execution.completed'; taskId: string; result: ExecutionResult; timestamp: string }
  | { type: 'verification.started'; taskId: string; timestamp: string }
  | { type: 'verification.completed'; taskId: string; passed: boolean; timestamp: string }
  | { type: 'task.transitioned'; taskId: string; from: Status; to: Status; timestamp: string }
  | { type: 'budget.threshold_reached'; level: string; currentSpend: number; limit: number; timestamp: string };
```

### 7.2 The Observability Port

```typescript
// ports/observability.ts
interface ObservabilityPort {
  emit(event: DomainEvent): void;
}
```

That's it. One method. The port is as thin as possible.

The core uses it like this:
```typescript
// In the orchestrator loop
this.observability.emit({ type: 'task.claimed', taskId: task.id, timestamp: now() });

// During execution (if using stream-json)
this.observability.emit({ type: 'execution.tool_called', taskId, tool: 'Read', timestamp: now() });

// After execution
this.observability.emit({ type: 'execution.completed', taskId, result, timestamp: now() });
```

### 7.3 The Trace Adapter

```typescript
// adapters/trace-writer.ts
class TraceWriterAdapter implements ObservabilityPort {
  private currentTrace: Partial<ExecutionTrace> | null = null;
  private toolTracker = new ToolTracker();

  emit(event: DomainEvent): void {
    switch (event.type) {
      case 'execution.started':
        this.currentTrace = {
          taskId: event.taskId,
          sessionId: event.sessionId,
          startedAt: event.timestamp,
        };
        break;

      case 'execution.tool_called':
        this.toolTracker.record(event.tool);
        break;

      case 'execution.completed':
        this.currentTrace = {
          ...this.currentTrace,
          ...event.result,
          completedAt: event.timestamp,
          toolCalls: this.toolTracker.summary(),
          toolCallCount: this.toolTracker.totalCount(),
        };
        this.writeTrace(this.currentTrace as ExecutionTrace);
        this.appendIndex(this.currentTrace as ExecutionTrace);
        this.toolTracker.reset();
        this.currentTrace = null;
        break;
    }
  }

  private writeTrace(trace: ExecutionTrace): void {
    const path = `.ralph/traces/${trace.taskId}.json`;
    Bun.write(path, JSON.stringify(trace, null, 2));
  }

  private appendIndex(trace: ExecutionTrace): void {
    const line = JSON.stringify({
      taskId: trace.taskId,
      completedAt: trace.completedAt,
      costUsd: trace.totalCostUsd,
      numTurns: trace.numTurns,
      toolCalls: trace.toolCallCount,
      result: trace.result,
      taskType: trace.taskType,
      attempt: trace.attempt,
    });
    appendFileSync('.ralph/traces/index.jsonl', line + '\n');
  }
}
```

### 7.4 The Heartbeat Adapter

```typescript
// adapters/heartbeat-writer.ts
class HeartbeatAdapter implements ObservabilityPort {
  private heartbeat: Heartbeat | null = null;

  emit(event: DomainEvent): void {
    switch (event.type) {
      case 'execution.started':
        this.heartbeat = {
          taskId: event.taskId,
          startedAt: event.timestamp,
          lastActiveAt: event.timestamp,
          turnsCompleted: 0,
          toolCallsSoFar: 0,
          currentCostUsd: 0,
          status: 'executing',
        };
        this.write();
        break;

      case 'execution.turn_completed':
        if (this.heartbeat) {
          this.heartbeat.turnsCompleted = event.turnNumber;
          this.heartbeat.lastActiveAt = event.timestamp;
          this.write();
        }
        break;

      case 'execution.tool_called':
        if (this.heartbeat) {
          this.heartbeat.toolCallsSoFar++;
          this.heartbeat.lastActiveAt = event.timestamp;
          // Don't write on every tool call — too frequent. Debounce.
        }
        break;

      case 'execution.completed':
        this.heartbeat = null;
        this.delete();
        break;
    }
  }

  private write(): void {
    Bun.write('.ralph/heartbeat.json', JSON.stringify(this.heartbeat, null, 2));
  }

  private delete(): void {
    unlinkSync('.ralph/heartbeat.json');
  }
}
```

### 7.5 Composite Adapter

Multiple adapters behind one port:

```typescript
// adapters/composite-observability.ts
class CompositeObservabilityAdapter implements ObservabilityPort {
  constructor(private adapters: ObservabilityPort[]) {}

  emit(event: DomainEvent): void {
    for (const adapter of this.adapters) {
      adapter.emit(event);
    }
  }
}

// Wiring in main:
const observability = new CompositeObservabilityAdapter([
  new TraceWriterAdapter(),
  new HeartbeatAdapter(),
  // Future: new ConsoleLogAdapter(),
  // Future: new WebhookAdapter(),
]);
```

### 7.6 Why This Design Works

- **Core doesn't import any adapter.** It calls `observability.emit()` and doesn't know if events go to files, logs, webhooks, or /dev/null.
- **Adding a new consumer is trivial.** Want to send events to a webhook? Write a new adapter. Want to log to console? Write a new adapter. Neither requires touching the core.
- **Testing is clean.** In unit tests, use a `SpyObservabilityAdapter` that records events for assertions.
- **No event bus complexity.** This isn't pub/sub. It's synchronous method calls through an interface. No message brokers, no async event queues. Just function calls.

---

## 8. Introspection Commands

These are the user-facing commands that consume observability data.

### 8.1 `ralph status`

"What's happening right now?"

```
$ ralph status

Ralph Status
============

Queue:
  Pending:     3 tasks
  In Progress: 1 task (task-007: "Add input validation to login")
  Review:      2 tasks (task-005, task-006)
  Done:        12 tasks
  Failed:      1 task

Current Execution:
  Task:        task-007 [feature]
  Started:     2 min ago
  Branch:      ralph/task-007
  Last commit: 45s ago ("Add validation schema")

Today:
  Completed:   4 tasks
  Cost:        $3.42
  Avg cost:    $0.86/task
```

Data sources:
- Queue status: `ls .ralph/tasks/*/` (directories)
- Current execution: last git log + heartbeat file (if accessible)
- Today's stats: `.ralph/traces/index.jsonl`

### 8.2 `ralph history`

"What happened recently?"

```
$ ralph history

Recent Task History (last 7 days)
=================================

  task-007  [feature]  in_progress  --          --      (running)
  task-006  [bugfix]   review       $0.62       8 turns  2h ago
  task-005  [bugfix]   review       $0.91      14 turns  3h ago
  task-004  [feature]  done         $2.15      35 turns  5h ago
  task-003  [refactor] done         $1.23      18 turns  yesterday
  task-002  [bugfix]   done         $0.45       6 turns  yesterday
  task-001  [bugfix]   failed       $4.98      50 turns  2 days ago  (hit turn limit)
```

### 8.3 `ralph costs`

"How much have we spent?"

```
$ ralph costs

Cost Summary
============

  Today:       $3.42 / $50.00 daily budget  (6.8%)
  This week:   $18.75 / $200.00 weekly budget  (9.4%)
  This month:  $42.30 / $500.00 monthly budget  (8.5%)
  All time:    $42.30 (45 tasks)

By Task Type:
  bugfix:    $12.40  (18 tasks, avg $0.69/task)
  feature:   $24.80  (15 tasks, avg $1.65/task)
  refactor:  $5.10   (12 tasks, avg $0.43/task)

Projection:
  3 pending tasks estimated at $4.20
  Projected monthly total: ~$85 (based on current rate)
```

### 8.4 `ralph trace <task-id>`

"Tell me everything about this task execution."

```
$ ralph trace task-004

Execution Trace: task-004
=========================

Task:           "Add user profile page"
Type:           feature
Branch:         ralph/task-004
Attempt:        1 of 3

Timing:
  Started:      2026-03-03 09:15:00
  Completed:    2026-03-03 09:22:15
  Duration:     7m 15s (API: 4m 2s)

Cost & Tokens:
  Total cost:   $2.15
  Turns:        35
  Tokens in:    125,000
  Tokens out:   28,000

Tool Usage:
  Read:         12 calls
  Edit:          8 calls
  Bash:          9 calls  (npm test x4, git diff x2, npm run build x2, ls x1)
  Grep:          4 calls
  Write:         2 calls
  Glob:          1 call
  Total:        36 tool calls

Verification:
  Tests:        42 passed, 0 failed
  Build:        success
  Lint:         clean

Result:         success
Stop reason:    end_turn (natural completion)
```

### 8.5 `ralph analytics`

"Show me patterns across all my tasks."

```
$ ralph analytics

Analytics (45 tasks over 14 days)
=================================

Success Rate:
  Overall:     93% (42/45)
  By type:     bugfix 94%, feature 87%, refactor 100%

Cost Distribution:
  Min:         $0.12
  Median:      $0.82
  Mean:        $0.94
  P90:         $2.40
  Max:         $4.98

Turn Distribution:
  Min:         3
  Median:      14
  Mean:        18
  P90:         38
  Max:         50

Most Used Tools:
  Read:        412 calls (32%)
  Bash:        298 calls (23%)
  Edit:        245 calls (19%)
  Grep:        178 calls (14%)
  Write:        89 calls (7%)
  Glob:         67 calls (5%)

Tuning Recommendations:
  [bugfix] Turn limit of 50 is generous — max observed: 32. Consider 45.
  [feature] 2 tasks (13%) hit the turn limit. Consider increasing to 75.
  [refactor] Budget of $5.00 is generous — max observed: $0.98. Consider $2.00.
```

---

## 9. Dashboard Without a Dashboard

### 9.1 Rich CLI (Primary Interface)

The commands in Section 8 ARE the dashboard. No Grafana, no Prometheus, no web server. Just well-formatted terminal output.

Implementation approach:
- Use a library like `cli-table3` or `chalk` for formatting
- Keep it simple: formatted strings, aligned columns, color coding
- No TUI framework — just `console.log` with taste

Color coding:
- Green: success, under budget
- Yellow: warning, approaching limits
- Red: failed, over budget, anomalies
- Dim: old/completed items

### 9.2 Static HTML Report (V2)

A `ralph report` command that generates a single self-contained HTML file:

```bash
ralph report > ralph-report.html && open ralph-report.html
```

The HTML contains:
- Inline CSS (no external deps)
- Summary dashboard (costs, success rates, queue status)
- Task history table (sortable)
- Cost chart (simple SVG or inline chart library)
- Tool usage breakdown
- Tuning recommendations

Why a single HTML file?
- No server needed
- Shareable (send to a colleague)
- Works offline
- Can be committed to git as a snapshot

### 9.3 Obsidian Integration (V2)

The user uses Obsidian. We can generate a Markdown note that Obsidian renders nicely:

```bash
ralph report --format obsidian > ~/vault/ralph-dashboard.md
```

Or better: a `PostTaskComplete` hook that appends to a running Obsidian note:

```markdown
# Ralph Dashboard
Updated: 2026-03-03 14:30

## Today
| Task | Type | Cost | Turns | Result |
|------|------|------|-------|--------|
| task-007 | feature | $2.15 | 35 | success |
| task-006 | bugfix | $0.62 | 8 | success |

## Cost Summary
- Today: $3.42
- This week: $18.75
- This month: $42.30

## Queue
- 3 pending, 1 in progress, 2 in review
```

Obsidian-native features we can leverage:
- Dataview queries over frontmatter (if traces have YAML frontmatter)
- Mermaid diagrams for cost trends
- Links between task notes and trace notes
- Tags for task types

**But this is V2.** For V1, the CLI is enough. Don't build an Obsidian integration before you have 20 tasks through the system.

### 9.4 What We Explicitly Don't Build

- No Grafana/Prometheus (overkill for single-worker)
- No web dashboard (another moving part to maintain)
- No real-time websocket updates (git polling is fine)
- No database (traces are files, index is JSONL)
- No alerting service (log warnings are enough for V1)

---

## 10. What Observability Data Gets Committed to Git?

This is a boundary decision. Get it wrong and you either lose data or pollute history.

### 10.1 Committed to Git (Persistent, Shared)

| Data | Location | When |
|------|----------|------|
| Execution trace | `.ralph/traces/<task-id>.json` | After task completes |
| Trace index | `.ralph/traces/index.jsonl` | Appended after each task |
| Task outcome (updated frontmatter) | `.ralph/tasks/done/<task>.md` | On state transition |
| Commit messages with cost/turn metadata | Git log | On each status commit |

### 10.2 NOT Committed to Git (Ephemeral, Local)

| Data | Location | Lifetime |
|------|----------|----------|
| Heartbeat | `.ralph/heartbeat.json` | While task runs |
| Claude session logs | `~/.claude/projects/.../*.jsonl` | Persistent on VPS disk |
| Stream-json raw output | Memory / temp file | During execution only |
| Generated reports (HTML) | User's machine | On demand |

### 10.3 Maybe Committed (Configurable)

| Data | Location | Argument For | Argument Against |
|------|----------|-------------|-----------------|
| Daily cost summary | `.ralph/traces/daily/<date>.json` | Quick historical lookup | Derivable from index.jsonl |
| Tuning recommendations | `.ralph/traces/tuning.json` | User sees suggestions in git | Stale quickly, regenerate on demand |
| Anomaly log | `.ralph/traces/anomalies.jsonl` | Persistent record of oddities | Already in individual trace files |

**Recommendation:** Don't commit the "maybe" items in V1. The trace index has all the data needed to regenerate them. Keep git clean.

### 10.4 .gitignore Entries

```gitignore
# Ralph ephemeral state
.ralph/heartbeat.json
.ralph/*.tmp
```

Everything else in `.ralph/` gets committed.

---

## 11. Implementation Priority for V1

### Must Have (Blocks basic operation)

1. **JSON output parsing** — Parse the `--output-format json` result for cost, duration, turns, session_id, success/error
2. **Execution trace creation** — Write `.ralph/traces/<task-id>.json` after each task
3. **Trace index** — Append to `.ralph/traces/index.jsonl`
4. **Cost in commit messages** — `ralph(task-001): completed [bugfix] $0.82 | 12 turns`
5. **Budget checking** — Read config budgets, check before claiming next task
6. **`ralph status`** — Basic queue status + today's cost

### Should Have (Significant value, moderate effort)

7. **Stream-JSON parsing** — Switch from `json` to `stream-json` for tool call tracking
8. **Tool call summary in traces** — Which tools, how many calls
9. **`ralph trace <id>`** — Detailed view of a single execution
10. **`ralph costs`** — Running totals and projections
11. **`ralph history`** — Recent task list with outcomes

### Nice to Have (V2)

12. **Anomaly detection** — Statistical outlier identification
13. **Tuning recommendations** — "Your turn limit is too low for features"
14. **`ralph analytics`** — Aggregate patterns
15. **Heartbeat file** — Real-time status on VPS disk
16. **HTML report generation** — Static dashboard file
17. **Obsidian integration** — Markdown dashboard note
18. **Per-type exit criteria** — Different limits for different task types

---

## 12. Key Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary output format | `stream-json` (V1 can start with `json`) | Richest data. JSON is fine for MVP, stream-json unlocks tool tracking. |
| Trace storage | One JSON file per task | Complete document per execution. Not append-only log. |
| Trace index | JSONL (append-only) | Fast to append, cheap to scan for analytics. |
| Heartbeat | File on disk, NOT in git | Ephemeral data, no git pollution. Consensus agrees. |
| Cost source of truth | `total_cost_usd` from Claude output | Authoritative. No estimation needed. |
| Observability architecture | Port + adapters (composite) | Core emits events, adapters consume. Clean separation. |
| Dashboard | CLI commands (V1), HTML report (V2) | No infrastructure to maintain. Files and terminal. |
| Budget enforcement | Pre-claim check against trace index | Fail-safe: won't claim tasks if budget is blown. |
| What gets committed | Traces + index + updated task frontmatter | Everything derivable stays out of git. |

---

## 13. Open Questions

1. **Stream-JSON vs JSON for V1?** Starting with plain `json` is simpler (one JSON.parse), but you lose tool call tracking. Is tool tracking a V1 requirement or can it wait?

2. **Token counts from stream-json — how reliable?** The `message_delta` event should include usage, but we need to verify this works consistently with `claude -p`.

3. **Agent SDK migration path?** If/when we move from CLI to Agent SDK, the observability port stays the same — only the executor adapter changes. But when does that migration make sense?

4. **Trace file size?** With 100+ tasks, `.ralph/traces/` could get large. Do we archive old traces? Move done tasks' traces to a separate branch? Or just let git handle it (it's good at storing text files)?

5. **Multi-attempt traces?** Current design: `task-001.json` and `task-001.attempt-2.json`. Alternative: single file with an `attempts` array. The latter is cleaner for querying but harder to append to.
