# Architecture B Deep Dive: Final Consensus

> Synthesized from 6 specialist deep-dives + cross-reviews (2026-03-03)
> Specialists: core-arch, observability, prompt-templates, client-interface, onboarding, node-runtime

---

## Universal Agreement (All 6 Specialists)

1. **Hexagonal architecture without ceremony.** 5 ports, adapters behind them, pure core domain with zero I/O. No DI framework, no abstract factories. Just interfaces and discipline.
2. **"Docker is an adapter, not the architecture."** The orchestrator contains zero Docker/systemd references. Deployment configs live at the project root (`docker/`, `systemd/`), not under `src/adapters/`.
3. **Git as sole communication channel.** Client and node communicate exclusively through git. No SSH required for normal operations. SSH is optional for live diagnostics.
4. **Shared task file parsing.** `parseTaskFile()` and `serializeTaskFile()` are pure functions in `core/task-file.ts`, used by both orchestrator and client. No duplication.
5. **Single binary, two modes.** `ralph start` runs the orchestrator. `ralph task|status|review` runs client commands. One `package.json`, one codebase.
6. **Skills shell out to CLI.** `/ralph-task` calls `ralph task create --json`. Skills never reimplement core logic. They are thin presentation wrappers.
7. **`ralph doctor` is one command** used by onboarding, orchestrator startup, and user directly. Same checks, different presentation contexts.
8. **Three templates for V1.** `default.md`, `bugfix.md`, `feature.md`. Add more when data shows the default isn't good enough.
9. **`--output-format json` for V1.** Not `stream-json`. Stream parsing is complex and tool-call tracking is a V2 nicety.
10. **Fresh prompt on retry.** No retry-aware prompting in V1. LLM non-determinism gives retries a reasonable chance without added complexity.

---

## Resolved Conflicts

### Conflict 1: Logger Port vs Observability Port

| Position | Advocates | Resolution |
|----------|-----------|------------|
| Logger port (`info/warn/error`) | core-arch (original) | **LOST** |
| ObservabilityPort (`emit(DomainEvent)`) | observability, client-interface | **WON** |

**Resolution:** Logger is replaced by Observability. Same 5-port count. `ConsoleLogAdapter` becomes one leaf adapter behind `CompositeObservabilityAdapter`. You cannot build execution traces from log lines -- domain events are structurally richer.

**Final 5 ports:**

| # | Port | Purpose |
|---|------|---------|
| 1 | TaskRepository | Read/write task files on filesystem |
| 2 | SourceControl | Git operations (pull, commit, push, branch, merge, diff) |
| 3 | AgentExecutor | Run Claude Code CLI |
| 4 | Verifier | Run test/build/lint shell commands |
| 5 | Observability | Emit typed domain events |

### Conflict 2: Budget Enforcement Location

| Position | Advocates | Resolution |
|----------|-----------|------------|
| Inside ObservabilityPort | observability | **LOST** |
| Core domain function | core-arch | **WON** |

**Resolution:** `canClaimTask(costs, limits): boolean` is a pure function in `core/budget.ts`. The observability port *provides* cost data via trace aggregation. The core *decides* whether to proceed. Ports never make domain decisions.

### Conflict 3: CLI Arg Construction Ownership

| Position | Advocates | Resolution |
|----------|-----------|------------|
| Stage 5 of prompt pipeline | prompt-templates | **LOST** |
| `ClaudeCliExecutor` adapter | core-arch | **WON** |

**Resolution:** The core builds the prompt string (stages 1-4). The adapter takes the prompt + execution config and constructs `--max-turns`, `--output-format`, etc. If we ever switch from CLI to direct API calls, the prompt stays the same.

### Conflict 4: `FsTaskRepository.transition()` vs `git mv`

| Position | Advocates | Resolution |
|----------|-----------|------------|
| Repository does `writeFile` + `unlink` | core-arch (original) | **LOST** |
| Repository writes content, `git mv` handles the move | node-runtime, core-arch (revised) | **WON** |

**Resolution:** `TaskRepository.update(task)` writes content to the file wherever it currently is. `SourceControl` handles moving with `git mv` (atomic rename that preserves history). The orchestrator coordinates: `git mv` first, then update content, then `git add`, then `git commit`.

### Conflict 5: Heartbeat Location

| Agent | Location | In Git? |
|-------|----------|---------|
| node-runtime | `/home/ralph/heartbeat.json` (outside workspace) | No |
| observability | `.ralph/heartbeat.json` (inside workspace, gitignored) | No |
| client-interface | `.ralph/status.json` (different file) | Yes |

**Resolution: Two separate files, two separate purposes.**

1. **`.ralph/heartbeat.json`** -- disk-only, gitignored, updated every poll cycle. Used by Docker HEALTHCHECK and SSH-based diagnostics. Contains: state, active_task, PID, uptime.

2. **No `status.json` in git.** Instead, node health is inferred from git log timestamps. No claim commit in >5 minutes? Probably down. The claim/complete/fail commits ARE the status updates. Adding a separate file creates the commit noise the consensus prohibited.

`ralph status` reads git log for last activity. `ralph status --live` SSHes to the node for real-time heartbeat.

### Conflict 6: Trace Storage

| Position | Advocates | Resolution |
|----------|-----------|------------|
| Full traces in git | observability | **MODIFIED** |
| Traces not in git at all | node-runtime | **MODIFIED** |

**Resolution: Summary in git, full trace on disk.**

- When a task completes, add summary fields to task frontmatter: `cost_usd`, `turns`, `duration_s`, `attempt`.
- Full trace JSON written to `.ralph/traces/<task-id>.json` on disk (gitignored).
- One-line summary appended to `.ralph/traces/index.jsonl` (gitignored).
- Client reads summaries from task frontmatter (via git). Full traces available via `ralph trace <id>` which SSHes to the node.

This avoids git bloat while keeping useful data accessible through the git channel.

### Conflict 7: `acceptance_criteria` Location

| Component | Location |
|-----------|----------|
| prompt-templates, core-arch, onboarding | YAML frontmatter |
| client-interface skill | Markdown body (`## Acceptance Criteria`) |

**Resolution:** Frontmatter wins. All structured data (`acceptance_criteria`, `files`, `constraints`) belongs in YAML frontmatter where the parser extracts it. The Markdown body is for the free-form description only. The skill must be updated.

### Conflict 8: Task Type Vocabulary

| Component | Types |
|-----------|-------|
| prompt-templates | bugfix, feature, refactor, research, test, chore |
| core-arch | bugfix, feature, refactor, test, research, default |
| client-interface | feature, bugfix, refactor, test, docs |

**Resolution: Canonical list:**

```typescript
type TaskType = "bugfix" | "feature" | "refactor" | "research" | "test" | "chore";
```

`default` is not a type -- it's a template fallback. When a task has an unknown type, the `default.md` template is used.

### Conflict 9: Config Schema

Five documents proposed different config shapes. **Resolution:**

`.env` (not committed, node-only) -- secrets and deployment identity:
```
ANTHROPIC_API_KEY=sk-ant-...
TASK_REPO_URL=git@github.com:user/project.git
GIT_AUTHOR_NAME=Ralph
GIT_AUTHOR_EMAIL=ralph@helico.dev
```

`.ralph/config.json` (committed, per-project) -- everything else:
```json
{
  "version": 1,
  "project": { "name": "my-project" },
  "verify": {
    "test": "bun test",
    "build": "bun run build",
    "lint": "bun run lint"
  },
  "task_defaults": {
    "max_retries": 2,
    "model": "opus",
    "max_turns": 50,
    "max_budget_usd": 5.0,
    "timeout_seconds": 1800
  },
  "exit_criteria": {
    "require_tests": true,
    "require_build": false,
    "require_lint": false
  },
  "git": {
    "main_branch": "main",
    "branch_prefix": "ralph/"
  },
  "execution": {
    "permission_mode": "skip_all"
  }
}
```

Rule: `.env` holds secrets. `config.json` holds everything else. Env vars override config for one-off testing.

### Conflict 10: Required Fields for Task Creation

**Resolution: Two validation layers.**

User provides (minimum): **title** only.

System generates: `id`, `status` (pending), `priority` (100), `type` (default -> uses `default.md`), `created_at`, `author`.

Recommended but not required: `acceptance_criteria`, `files`, `constraints`.

If `acceptance_criteria` is missing, the prompt builder injects a fallback: "The described change works correctly and all tests pass." The node logs a warning but doesn't skip the task.

### Conflict 11: `buildPrompt()` Signature

| Position | Advocates |
|----------|-----------|
| `buildPrompt(task, template): string` (pure, narrow) | core-arch |
| `buildPrompt(task, config): PromptOutput` (config-aware, broad) | prompt-templates |

**Resolution: Both.** Core keeps the pure `buildPrompt(task, template): string`. The orchestrator uses a wrapper:

```typescript
function buildExecutionPlan(task: Task, template: PromptTemplate, config: RalphConfig): ExecutionPlan {
  const prompt = buildPrompt(task, template);  // core's pure function
  const tools = getToolProfile(task.type, config);
  return {
    prompt,
    tools,
    model: config.perType?.[task.type]?.model ?? config.model,
    maxTurns: config.perType?.[task.type]?.maxTurns ?? config.maxTurns,
    budgetUsd: config.perType?.[task.type]?.budgetUsd ?? config.budgetUsd,
    timeoutMs: config.perType?.[task.type]?.timeoutMs ?? config.taskTimeoutMs,
    systemPromptFile: config.systemPromptFile ?? ".ralph/ralph-system.md",
  };
}
```

### Conflict 12: SourceControl Port Scope

**Resolution:** Extended for client use:

```typescript
interface SourceControl {
  // Node + Client
  pull(options?: { ffOnly?: boolean }): Promise<void>;
  commit(message: string): Promise<string>;
  push(): Promise<boolean>;
  pushBranch(branch: string): Promise<boolean>;
  createBranch(name: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  stageFiles(paths: string[]): Promise<void>;
  // Client additions
  fetch(): Promise<void>;
  diff(spec: string): Promise<string>;
  merge(branch: string, options?: { ffOnly?: boolean }): Promise<void>;
  deleteBranch(name: string, options?: { remote?: boolean }): Promise<void>;
}
```

One interface. Node adapter ignores methods it doesn't use.

---

## Canonical File Structure (~45 files)

```
ralph/
├── src/
│   ├── core/                          # Pure domain logic. Zero I/O imports.
│   │   ├── types.ts                   # Task, TaskStatus, ExecutionResult, DomainEvent
│   │   ├── task-file.ts               # parseTaskFile(), serializeTaskFile() -- SHARED
│   │   ├── state-machine.ts           # transitionTask() -- pure state transitions
│   │   ├── queue.ts                   # pickNextTask() -- deterministic task selection
│   │   ├── prompt-builder.ts          # buildPrompt() -- template interpolation
│   │   ├── budget.ts                  # canClaimTask(), calculateCosts()
│   │   ├── consistency.ts             # checkConsistency()
│   │   └── errors.ts                  # TaskError, GitError, ExecutionError
│   │
│   ├── ports/                         # Interfaces only. No implementations.
│   │   ├── task-repository.ts         # TaskRepository
│   │   ├── source-control.ts          # SourceControl (extended for client)
│   │   ├── agent-executor.ts          # AgentExecutor
│   │   ├── verifier.ts                # Verifier
│   │   └── observability.ts           # Observability -- emit(event: DomainEvent)
│   │
│   ├── adapters/                      # Port implementations. All I/O lives here.
│   │   ├── fs-task-repository.ts      # TaskRepository -> filesystem
│   │   ├── git-source-control.ts      # SourceControl -> git CLI
│   │   ├── claude-cli-executor.ts     # AgentExecutor -> claude -p
│   │   ├── shell-verifier.ts          # Verifier -> sh -c commands
│   │   ├── composite-observability.ts # Observability -> fan-out to children
│   │   ├── trace-writer.ts            # Observability child -> trace JSON files
│   │   ├── heartbeat-writer.ts        # Observability child -> heartbeat.json
│   │   ├── console-logger.ts          # Observability child -> stdout
│   │   └── mock/                      # Test doubles
│   │       ├── mock-executor.ts
│   │       ├── mock-source-control.ts
│   │       └── mock-observability.ts
│   │
│   ├── orchestrator/                  # Main loop. Composition root.
│   │   ├── loop.ts                    # processTask(), main polling loop
│   │   ├── recovery.ts               # recoverOrphanedTasks() -- startup
│   │   ├── shutdown.ts               # SIGTERM/SIGINT handling
│   │   └── config.ts                 # loadConfig()
│   │
│   ├── client/                        # Client-side operations
│   │   ├── create-task.ts             # Create task file, commit, push
│   │   ├── list-tasks.ts             # Read task files, format for display
│   │   ├── review-task.ts            # Approve/reject, merge branch
│   │   ├── status.ts                 # Queue status, node health from git log
│   │   └── format.ts                 # Output formatting (table, json, plain)
│   │
│   ├── doctor.ts                      # ralph doctor -- contract checker
│   └── cli.ts                         # CLI entry point -- arg parsing, dispatch
│
├── templates/                         # User-editable prompt templates
│   ├── default.md
│   ├── bugfix.md
│   └── feature.md
│
├── docker/                            # Docker deployment adapter
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .dockerignore
│
├── systemd/                           # Bare VPS deployment adapter
│   ├── ralph.service
│   └── ralph-logrotate.conf
│
├── skills/                            # Claude Code skills (thin CLI wrappers)
│   ├── ralph-task.md
│   ├── ralph-status.md
│   ├── ralph-review.md
│   └── ralph-list.md
│
├── test/                              # Tests mirror src/ structure
│   ├── core/
│   │   ├── state-machine.test.ts
│   │   ├── queue.test.ts
│   │   ├── prompt-builder.test.ts
│   │   ├── budget.test.ts
│   │   └── task-file.test.ts
│   ├── adapters/
│   │   ├── fs-task-repository.test.ts
│   │   ├── git-source-control.test.ts
│   │   └── claude-cli-executor.test.ts
│   ├── orchestrator/
│   │   ├── loop.test.ts
│   │   └── recovery.test.ts
│   └── client/
│       ├── create-task.test.ts
│       └── review-task.test.ts
│
├── .ralph/                            # Runtime directory
│   ├── config.json
│   ├── ralph-system.md
│   ├── tasks/
│   │   ├── pending/
│   │   ├── active/
│   │   ├── review/
│   │   ├── done/
│   │   └── failed/
│   ├── heartbeat.json                 # Gitignored -- disk only
│   └── traces/                        # Gitignored -- disk only
│       └── index.jsonl
│
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## Task File Format (Canonical)

```markdown
---
id: task-013
title: "Fix null check in authenticate()"
status: pending
type: bugfix
priority: 100
created_at: "2026-03-03T14:00:00Z"
author: "Arjan"
acceptance_criteria:
  - "authenticate() handles null email without crashing"
  - "All existing tests pass"
  - "New test covers the null email case"
files:
  - src/auth.ts
  - test/auth.test.ts
constraints:
  - "Do not modify the User model"
max_retries: 2
---
## Description

The `authenticate()` function in `src/auth.ts` crashes with a TypeError
when `user.email` is null. This happens when OAuth providers don't return
an email address.

## Context

Reported by user in issue #42. Affects Google OAuth flow specifically.
```

**Frontmatter fields:**
- **Required by user:** `title`
- **System-generated:** `id`, `status`, `created_at`, `author`
- **Defaults if omitted:** `type` (default), `priority` (100), `max_retries` (2)
- **Recommended:** `acceptance_criteria`, `files`, `constraints`
- **Added by orchestrator on completion:** `cost_usd`, `turns`, `duration_s`, `attempt`, `branch`

---

## The Orchestrator Loop

```
                  ┌─────────────────────────────────────────────┐
                  │           STARTUP                           │
                  │  1. loadConfig()                            │
                  │  2. runDoctor() -- fail fast                │
                  │  3. recoverOrphanedTasks() -- crash recovery│
                  │  4. Wire adapters to ports                  │
                  └──────────────┬──────────────────────────────┘
                                 │
                  ┌──────────────▼──────────────────────────────┐
              ┌──►│           POLL                              │
              │   │  1. git checkout main                      │
              │   │  2. git fetch + merge --ff-only             │
              │   │  3. canClaimTask(costs, limits)?            │
              │   │  4. pickNextTask(pending/)                  │
              │   │  5. No task? sleep(30s) → loop              │
              │   └──────────────┬──────────────────────────────┘
              │                  │ task found
              │   ┌──────────────▼──────────────────────────────┐
              │   │           CLAIM                             │
              │   │  1. git mv pending/<task> active/<task>     │
              │   │  2. Update frontmatter (status, claimed_at) │
              │   │  3. git add + commit "ralph(<id>): claimed" │
              │   │  4. git push (fail? reset + retry)          │
              │   │  5. observability.emit(task.claimed)        │
              │   └──────────────┬──────────────────────────────┘
              │                  │
              │   ┌──────────────▼──────────────────────────────┐
              │   │           EXECUTE                           │
              │   │  1. git checkout -b ralph/<task-id>         │
              │   │  2. buildExecutionPlan(task, template, cfg) │
              │   │  3. executor.run(plan) → ExecutionResult    │
              │   │  4. observability.emit(execution.completed) │
              │   └──────────────┬──────────────────────────────┘
              │                  │
              │   ┌──────────────▼──────────────────────────────┐
              │   │           VERIFY                            │
              │   │  (runs for end_turn AND max_turns)          │
              │   │  1. verifier.runTests()                     │
              │   │  2. verifier.runBuild() (if configured)     │
              │   │  3. verifier.runLint() (if configured)      │
              │   │  4. observability.emit(verification.done)   │
              │   └──────────────┬──────────────────────────────┘
              │                  │
              │   ┌──────────────▼──────────────────────────────┐
              │   │           TRANSITION                        │
              │   │  Verified?                                  │
              │   │    → git push ralph/<task-id>               │
              │   │    → git mv active/<task> review/<task>     │
              │   │    → Add cost_usd, turns, duration_s to FM  │
              │   │    → commit + push to main                  │
              │   │  Failed + retries left?                     │
              │   │    → git mv active/<task> pending/<task>    │
              │   │    → retryCount++, commit + push            │
              │   │    → delete stale branch                    │
              │   │  Failed permanently?                        │
              │   │    → git mv active/<task> failed/<task>     │
              │   │    → commit + push                          │
              │   └──────────────┬──────────────────────────────┘
              │                  │
              └──────────────────┘
```

---

## Key Architectural Decisions

### 1. Verification Runs on `max_turns` Too

Previous design skipped verification when `stopReason !== "end_turn"`. This wastes valid work -- Claude may have completed changes before hitting the turn limit. Verification now runs for both `end_turn` and `max_turns`. Only `refusal`, `timeout`, and `error` skip verification.

### 2. CLAUDE.md vs System Prompt: Zero Overlap

- **CLAUDE.md** = project conventions only (build commands, naming, architecture)
- **`ralph-system.md`** = Ralph behavioral rules only (autonomy, commits, scope, stuck protocol)
- **Task template** = task-specific workflow
- `ralph init project` adds build/test/lint commands to CLAUDE.md. NOT Ralph rules.

### 3. No `status.json` in Git

Node health is inferred from git commit timestamps. The last `ralph(<id>): claimed` commit tells you the node was alive at that time. No separate status file, no commit spam.

### 4. `permission_mode` is Configurable

```json
{ "execution": { "permission_mode": "skip_all" } }
```

- Docker users: `"skip_all"` (container IS the sandbox)
- Bare VPS users: `"allowed_tools_only"` with per-type tool profiles
- The executor adapter reads this from config. The core doesn't know or care.

### 5. Shell Commands Run Through `sh -c`

The `ShellVerifier` runs commands via `Bun.spawn(["sh", "-c", command])`, not by splitting on spaces. This handles quoted arguments, pipes, and redirects correctly.

### 6. Consistency Checks Skip Terminal States

`checkConsistency()` only scans `pending/`, `active/`, and `review/`. `done/` and `failed/` are terminal -- if they were consistent when they entered, they're consistent now. Prevents O(n) slowdown as completed tasks accumulate.

### 7. Templates Live Outside `src/`

`templates/` is at the project root, not under `src/`. Templates are user-editable configuration, not compiled code. Loaded at runtime per-task (hot-reloadable).

### 8. Stale Branch Cleanup on Retry

Before creating `ralph/<task-id>` branch, check if it exists from a previous attempt and delete it. Use `git checkout -B` or explicit cleanup. Retries start from a clean slate.

---

## Build Order (Confidence Ladder)

Each step is independently verifiable before proceeding.

### Phase 1: Pure Core (no I/O, no dependencies)

| Step | File | Test | Verification |
|------|------|------|-------------|
| 1 | `core/types.ts` | Type-check only | `bun check` passes |
| 2 | `core/task-file.ts` | `task-file.test.ts` | Parse/serialize roundtrip |
| 3 | `core/state-machine.ts` | `state-machine.test.ts` | All valid/invalid transitions |
| 4 | `core/queue.ts` | `queue.test.ts` | Priority + created_at sorting |
| 5 | `core/prompt-builder.ts` | `prompt-builder.test.ts` | Template snapshot tests |
| 6 | `core/budget.ts` | `budget.test.ts` | Budget predicates |
| 7 | `core/errors.ts` | Used by above | Compiles |

### Phase 2: Adapters (filesystem + git + shell)

| Step | File | Test | Verification |
|------|------|------|-------------|
| 8 | `adapters/fs-task-repository.ts` | `fs-task-repository.test.ts` | Real filesystem, temp dirs |
| 9 | `adapters/git-source-control.ts` | `git-source-control.test.ts` | Real git, local bare repos |
| 10 | `adapters/shell-verifier.ts` | Manual test with `bun test` | Passes on this project |
| 11 | `adapters/composite-observability.ts` | Manual test | Events fan out correctly |
| 12 | `adapters/console-logger.ts` | Visual inspection | Structured JSON output |
| 13 | `adapters/mock/*` | Used by later tests | N/A |

### Phase 3: Orchestrator (wire it up, mock Claude)

| Step | File | Test | Verification |
|------|------|------|-------------|
| 14 | `orchestrator/config.ts` | Unit test | Loads and validates config |
| 15 | `orchestrator/recovery.ts` | `recovery.test.ts` | Orphan detection works |
| 16 | `orchestrator/shutdown.ts` | Manual SIGTERM test | Graceful exit |
| 17 | `orchestrator/loop.ts` | `loop.test.ts` (mock executor) | Full cycle with fake Claude |

### Phase 4: Client

| Step | File | Test | Verification |
|------|------|------|-------------|
| 18 | `client/create-task.ts` | `create-task.test.ts` | Creates valid task file |
| 19 | `client/list-tasks.ts` | Manual test | Lists pending/active/etc |
| 20 | `client/review-task.ts` | `review-task.test.ts` | Approve/reject flow |
| 21 | `client/status.ts` | Manual test | Shows queue state |
| 22 | `cli.ts` | Manual test | All commands dispatch correctly |
| 23 | `doctor.ts` | Manual test | Checks pass/fail correctly |

### Phase 5: Real Claude (locally)

| Step | Verification |
|------|-------------|
| 24 | Replace mock executor with `claude-cli-executor.ts` |
| 25 | Run with a trivial task locally |
| 26 | Run with a real bugfix task locally |
| 27 | Verify full cycle: create -> claim -> execute -> verify -> review |

### Phase 6: Deployment

| Step | Verification |
|------|-------------|
| 28 | Build Docker image |
| 29 | Run in Docker locally |
| 30 | Deploy to Hetzner CX22 |
| 31 | Run `ralph hello` from laptop against VPS |
| 32 | Skills + full round-trip |

### Phase 7: Skills

| Step | File | Verification |
|------|------|-------------|
| 33 | `skills/ralph-task.md` | Creates task via CLI |
| 34 | `skills/ralph-status.md` | Shows status via CLI |
| 35 | `skills/ralph-review.md` | Review flow via CLI |
| 36 | `skills/ralph-list.md` | Lists tasks via CLI |

---

## Specialist Scores (Phase 2 Cross-Review Averages)

| Agent | core-arch | observability | prompt-templates | client-interface | onboarding | node-runtime | **Avg** |
|-------|-----------|---------------|------------------|------------------|------------|--------------|---------|
| core-arch | -- | 7/10 | 8/10 | 8/10 | 9/10 | 9/10 | **8.2** |
| observability | 8/10 | -- | 7/10 | 9/10 | 7.5/10 | 8/10 | **7.9** |
| node-runtime | 7/10 | 8/10 | 7/10 | 7/10 | 8.5/10 | -- | **7.5** |
| prompt-templates | -- | 7/10 | -- | 8/10 | 7/10 | 7/10 | **7.3** |
| onboarding | 6/10 | 7.5/10 | 6/10 | 8/10 | -- | 7/10 | **6.9** |
| client-interface | 5/10 | 8/10 | -- | -- | 8/10 | 7/10 | **7.0** |

**Rankings:**
1. **core-arch** (8.2) -- Cleanest hexagonal split. The canonical file structure.
2. **observability** (7.9) -- Best research. Trace design and ObservabilityPort won the Logger debate.
3. **node-runtime** (7.5) -- "Docker is an adapter" framing. Strongest boundary understanding.
4. **prompt-templates** (7.3) -- Production-ready templates. Pipeline model is sound.
5. **client-interface** (7.0) -- Three-adapter model correct in theory. `acceptance_criteria` contract bug was critical.
6. **onboarding** (6.9) -- Best UX design. `ralph hello` is excellent. But provisioning scripts had real gaps.

---

## V1 Scope

### Must Have
- Orchestrator loop (poll -> claim -> execute -> verify -> transition)
- 5 ports with real adapters
- Task file format with YAML frontmatter
- 3 prompt templates (default, bugfix, feature)
- System prompt (`ralph-system.md`)
- Client CLI (`ralph task create|list`, `ralph status`, `ralph review`)
- `ralph doctor`
- Docker deployment adapter
- Crash recovery on startup
- Explicit file staging (never `git add -A`)

### Should Have
- Bare VPS (systemd) deployment adapter
- `ralph init project` scaffolding
- `ralph init node` (SSH-based provisioning)
- `ralph hello` first-task experience
- 4 Claude Code skills
- Budget enforcement (per-task + daily limits)
- Trace files on disk with summary in frontmatter

### Won't Have (V2)
- `stream-json` parsing for tool call tracking
- Retry-aware prompting (include failure context)
- Per-type execution limits in config
- `ralph analytics` with tuning recommendations
- Programmatic API adapter
- Multi-worker orchestration
- Auto-accept mode
- Custom entry criteria scripts
- Obsidian/HTML report export

---

## Open Questions for Implementation

1. **Template hot-reload.** If a user edits `templates/bugfix.md` while the orchestrator is running, should it pick up changes? (Recommendation: yes, load per-task.)

2. **Skill installation.** How do skills in `skills/` get into `.claude/skills/`? Symlink during `ralph init project`? Copy?

3. **Trace pruning.** At 1000+ tasks, `.ralph/traces/` grows. Archive older than 30 days? Monthly rotation of `index.jsonl`?

4. **Node discovery.** Should `.ralph/config.json` include optional `node.host` for `ralph doctor --node` and `ralph status --live`? Or should that live in `~/.ralph/nodes.json` (global, not per-project)?

5. **`ralph update node`.** Should the CLI support remote updates (`git pull && bun install && systemctl restart`) over SSH?
