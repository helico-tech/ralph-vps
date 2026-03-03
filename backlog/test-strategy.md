# Ralph VPS Testing Strategy

> Derived from Architecture B deep dive consensus (2026-03-03)

---

## Testing Philosophy

Every layer of the hexagonal architecture has a corresponding test tier. The pure core is tested with fast, deterministic unit tests. Adapters are integration-tested against real infrastructure (filesystem, git). The orchestrator is tested with mock adapters. E2E tests validate the full loop.

**Test runner:** `bun test`
**Test location:** `test/` directory mirroring `src/` structure
**Naming convention:** `<module>.test.ts`

---

## Test Tiers

### Tier 1: Unit Tests (Pure Core Domain)

Zero I/O, zero dependencies. These tests import only from `src/core/` and run in <1 second total. They are the foundation -- if these fail, nothing above them matters.

---

#### T-U1: Task File Parse/Serialize

- **File:** `test/core/task-file.test.ts`
- **Covers:**
  - Parse valid task file with all fields (id, title, status, type, priority, created_at, author, acceptance_criteria, files, constraints, max_retries)
  - Parse minimal task file (title only, system-generated defaults applied)
  - Serialize task back to markdown+YAML frontmatter and re-parse (roundtrip identity)
  - Missing required field (`title`) throws `TaskError`
  - Extra/unknown frontmatter fields are preserved (forward compatibility)
  - Malformed YAML frontmatter (no closing `---`, invalid YAML syntax) throws descriptive error
  - Empty markdown body is valid
  - Frontmatter with completion fields (`cost_usd`, `turns`, `duration_s`, `attempt`, `branch`) parses correctly
  - Unicode in title and description
  - `acceptance_criteria` as string array vs missing (fallback behavior)
  - `type` field validation against canonical `TaskType` union
  - `priority` as number, not string
- **Dependencies:** Implementation of `src/core/task-file.ts`, `src/core/types.ts`
- **Size:** M

---

#### T-U2: State Machine Transitions

- **File:** `test/core/state-machine.test.ts`
- **Covers:**
  - **Valid transitions:**
    - `pending` -> `active` (claim)
    - `active` -> `review` (verification passed)
    - `active` -> `pending` (retry, retries remaining)
    - `active` -> `failed` (retry limit reached or permanent failure)
    - `review` -> `done` (user approved)
    - `review` -> `pending` (user rejected, re-queue)
    - `review` -> `failed` (user rejected permanently)
  - **Invalid transitions (all should throw):**
    - `pending` -> `review` (skip active)
    - `pending` -> `done` (skip everything)
    - `done` -> anything (terminal state)
    - `failed` -> anything (terminal state)
    - `active` -> `active` (self-transition)
    - `review` -> `active` (backwards into execution)
  - **Guard conditions:**
    - `active` -> `pending` requires `retryCount < maxRetries`
    - `active` -> `failed` requires `retryCount >= maxRetries` OR explicit permanent failure flag
  - **Frontmatter updates on transition:**
    - `pending` -> `active` sets `claimed_at`
    - `active` -> `review` adds `cost_usd`, `turns`, `duration_s`, `attempt`
    - `active` -> `pending` increments `retryCount`
- **Dependencies:** Implementation of `src/core/state-machine.ts`, `src/core/types.ts`
- **Size:** M

---

#### T-U3: Task Queue Selection

- **File:** `test/core/queue.test.ts`
- **Covers:**
  - Tasks sorted by priority (lower number = higher priority)
  - Tiebreak by `created_at` (earlier tasks first)
  - Empty pending directory returns `null`
  - Single task in queue returns that task
  - Multiple tasks with same priority use `created_at` tiebreaker
  - Tasks with missing priority use default (100)
  - `pickNextTask()` is a pure function over a task array (deterministic)
- **Dependencies:** Implementation of `src/core/queue.ts`, `src/core/types.ts`
- **Size:** S

---

#### T-U4: Prompt Builder

- **File:** `test/core/prompt-builder.test.ts`
- **Covers:**
  - Template interpolation with all variables (`{{title}}`, `{{description}}`, `{{acceptance_criteria}}`, `{{files}}`, `{{constraints}}`)
  - Missing optional variables produce clean output (no `{{undefined}}` artifacts)
  - Template selection by task type (`bugfix` -> `bugfix.md`, `feature` -> `feature.md`)
  - Unknown task type falls back to `default.md`
  - `acceptance_criteria` array rendered as bullet list
  - `files` array rendered as scoped file list
  - `constraints` array rendered as constraint list
  - Missing `acceptance_criteria` injects fallback: "The described change works correctly and all tests pass."
  - Snapshot tests for each template (default, bugfix, feature) with a representative task
  - `buildPrompt()` is pure: `(task, template) => string`
  - `buildExecutionPlan()` merges config defaults with per-type overrides
- **Dependencies:** Implementation of `src/core/prompt-builder.ts`, `src/core/types.ts`
- **Size:** M

---

#### T-U5: Budget Predicates

- **File:** `test/core/budget.test.ts`
- **Covers:**
  - `canClaimTask()` returns `true` when costs are within limits
  - `canClaimTask()` returns `false` when daily budget exceeded
  - `canClaimTask()` returns `false` when per-task budget exceeded
  - Edge case: costs exactly at limit -> returns `false` (no room for the next task)
  - Edge case: costs slightly under limit -> returns `true`
  - Edge case: zero costs, positive limits -> returns `true`
  - Edge case: positive costs, zero limit (unlimited) -> returns `true`
  - `calculateCosts()` aggregates from execution results
  - Pure function: no side effects, no I/O
- **Dependencies:** Implementation of `src/core/budget.ts`, `src/core/types.ts`
- **Size:** S

---

#### T-U6: Consistency Checks

- **File:** `test/core/consistency.test.ts`
- **Covers:**
  - Detects task in `active/` with no matching branch
  - Detects duplicate task IDs across directories
  - Skips terminal states (`done/`, `failed/`) -- not scanned
  - Returns clean result for consistent state
  - Reports multiple issues in a single scan
- **Dependencies:** Implementation of `src/core/consistency.ts`, `src/core/types.ts`
- **Size:** S

---

### Tier 2: Integration Tests (Adapters)

These tests touch real infrastructure: filesystem, git CLI, shell commands. They use temp directories and local bare repos. Slower than unit tests but still automated.

---

#### T-I1: Filesystem Task Repository

- **File:** `test/adapters/fs-task-repository.test.ts`
- **Covers:**
  - **Setup/teardown:** Creates temp directory with `pending/`, `active/`, `review/`, `done/`, `failed/` subdirectories
  - **CRUD operations:**
    - `create()` writes task file to `pending/` with correct filename (`<id>.md`)
    - `read()` reads and parses task file from any status directory
    - `update()` writes updated frontmatter + body to existing file location
    - `list()` scans a status directory and returns parsed tasks
    - `findById()` searches across all status directories
  - **Directory scanning:**
    - Lists only `.md` files (ignores `.DS_Store`, etc.)
    - Empty directory returns empty array
    - Handles special characters in filenames (if ID contains them)
  - **File content integrity:**
    - Written file is valid markdown with YAML frontmatter
    - Roundtrip: write -> read -> compare matches original task
  - **Error cases:**
    - Read nonexistent file throws `TaskError`
    - Write to nonexistent directory throws (adapter doesn't create dirs)
- **Dependencies:** Implementation of `src/adapters/fs-task-repository.ts`, `src/core/task-file.ts`
- **Size:** M

---

#### T-I2: Git Source Control

- **File:** `test/adapters/git-source-control.test.ts`
- **Covers:**
  - **Setup/teardown:** Creates local bare repo + cloned working copy in temp dirs
  - **Basic operations:**
    - `pull()` with `--ff-only` fetches and merges
    - `commit()` creates commit with correct message format
    - `push()` pushes to bare repo successfully
    - `push()` returns `false` on rejection (simulate with concurrent push)
    - `stageFiles()` stages specific files (not `git add -A`)
  - **Branch operations:**
    - `createBranch()` creates branch from current HEAD
    - `checkout()` switches to existing branch
    - `pushBranch()` pushes branch to remote
    - `deleteBranch()` deletes local and optionally remote branch
  - **Client operations:**
    - `fetch()` fetches without merging
    - `diff()` returns diff output for a spec
    - `merge()` merges branch into current
  - **Error handling:**
    - Operations on non-existent branch throw `GitError`
    - Push failure returns `false` (doesn't throw)
  - **git mv:**
    - Moving a task file between status directories preserves history
- **Dependencies:** Implementation of `src/adapters/git-source-control.ts`, git CLI available
- **Size:** L

---

#### T-I3: Claude CLI Executor

- **File:** `test/adapters/claude-cli-executor.test.ts`
- **Covers:**
  - **CLI argument construction:**
    - Builds correct `claude` CLI command from `ExecutionPlan`
    - Includes `--model`, `--max-turns`, `--max-budget-usd`, `--output-format json`
    - Includes `--append-system-prompt-file` pointing to `ralph-system.md`
    - Includes `--dangerously-skip-permissions` when `permission_mode` is `"skip_all"`
    - Prompt passed via `-p` flag
  - **Output parsing (with mock subprocess):**
    - Parses JSON output to `ExecutionResult`
    - Extracts `cost_usd`, `num_turns`, `stopReason` from JSON
    - Handles `end_turn` stop reason
    - Handles `max_turns` stop reason
  - **Error scenarios (with mock subprocess):**
    - CLI process exits non-zero -> `ExecutionError`
    - CLI process times out -> `ExecutionError` with timeout flag
    - Invalid JSON output -> `ExecutionError`
    - Empty output -> `ExecutionError`
  - **Timeout handling:**
    - Respects `timeoutMs` from execution plan
    - Kills process on timeout
- **Dependencies:** Implementation of `src/adapters/claude-cli-executor.ts`
- **Size:** M

---

#### T-I4: Shell Verifier

- **File:** `test/adapters/shell-verifier.test.ts`
- **Covers:**
  - **Pass scenarios:**
    - `runTests("echo ok")` returns `{ passed: true }`
    - `runBuild("echo ok")` returns `{ passed: true }`
    - `runLint("echo ok")` returns `{ passed: true }`
  - **Fail scenarios:**
    - `runTests("exit 1")` returns `{ passed: false, output: ... }`
    - Command with stderr output captures it
  - **Shell execution:**
    - Commands run through `sh -c` (handles pipes, redirects)
    - Working directory is set correctly
  - **Unconfigured commands:**
    - If `verify.build` is not in config, `runBuild()` returns `{ passed: true, skipped: true }`
- **Dependencies:** Implementation of `src/adapters/shell-verifier.ts`
- **Size:** S

---

#### T-I5: Composite Observability

- **File:** `test/adapters/composite-observability.test.ts`
- **Covers:**
  - **Fan-out:**
    - `emit(event)` calls `emit()` on all child adapters
    - Three children: all three receive every event
  - **Adapter composition:**
    - `ConsoleLogAdapter` receives events (verify output format manually or with snapshot)
    - `TraceWriterAdapter` receives events
    - `HeartbeatWriterAdapter` receives events
  - **Error isolation:**
    - If one child throws, other children still receive the event
  - **Event types:**
    - `task.claimed`, `execution.completed`, `verification.done`, `task.transitioned` all propagate
- **Dependencies:** Implementation of `src/adapters/composite-observability.ts` and child adapters
- **Size:** S

---

### Tier 3: Orchestrator Tests

These test the composition of core logic + adapters. Mock adapters (especially the executor) keep tests fast and deterministic.

---

#### T-O1: Orchestrator Loop (Full Cycle)

- **File:** `test/orchestrator/loop.test.ts`
- **Covers:**
  - **Happy path (full cycle with mock executor):**
    1. Seed `pending/` with a task file
    2. `processTask()` claims it (moves to `active/`)
    3. Mock executor returns successful `ExecutionResult`
    4. Verifier passes (mock or real with `echo ok`)
    5. Task moves to `review/`
    6. Branch `ralph/<task-id>` exists with commits
    7. Observability events emitted in correct order: `task.claimed` -> `execution.completed` -> `verification.done` -> `task.transitioned`
  - **Retry path:**
    1. Mock executor returns failure
    2. Verifier fails
    3. Task moves back to `pending/` with `retryCount` incremented
    4. Stale branch cleaned up
  - **Permanent failure path:**
    1. Task at max retries
    2. Executor fails
    3. Task moves to `failed/`
  - **Empty queue:**
    - No tasks in `pending/` -> `processTask()` returns null, loop sleeps
  - **Push failure on claim:**
    - Mock `SourceControl.push()` returns `false`
    - Task reverted, loop continues
  - **Budget exceeded:**
    - `canClaimTask()` returns `false`
    - Loop sleeps without claiming
  - **Verification on max_turns:**
    - Executor returns `stopReason: "max_turns"`
    - Verification still runs (not skipped)
  - **Verification skipped on error:**
    - Executor returns `stopReason: "error"` or `"timeout"`
    - Verification is skipped, task goes to retry/fail
- **Dependencies:** All core modules, mock adapters (`mock-executor.ts`, `mock-source-control.ts`, `mock-observability.ts`), real `FsTaskRepository` with temp dirs
- **Size:** L

---

#### T-O2: Crash Recovery

- **File:** `test/orchestrator/recovery.test.ts`
- **Covers:**
  - **Orphan detection:**
    - Task in `active/` with no heartbeat and stale `claimed_at` -> detected as orphan
    - Task in `active/` with recent `claimed_at` -> NOT detected (might be running)
  - **Recovery actions:**
    - Orphaned task with retries remaining -> moved back to `pending/`, `retryCount` incremented
    - Orphaned task at max retries -> moved to `failed/`
    - Stale branch `ralph/<task-id>` cleaned up on recovery
  - **Multiple orphans:**
    - Multiple tasks in `active/` all recovered in one pass
  - **No orphans:**
    - Empty `active/` -> `recoverOrphanedTasks()` completes cleanly
  - **Recovery runs at startup only:**
    - Called once in the init sequence, not during polling
- **Dependencies:** Core state machine, `FsTaskRepository` (or mock), `SourceControl` (or mock)
- **Size:** M

---

#### T-O3: Config Loading

- **File:** `test/orchestrator/config.test.ts`
- **Covers:**
  - **Valid config:**
    - Loads `.ralph/config.json` with all fields
    - Applies defaults for missing optional fields
  - **Validation:**
    - Missing `verify.test` -> error (test command is required)
    - Invalid `task_defaults.model` -> error or warning
    - Negative `max_retries` -> error
    - Non-numeric `max_budget_usd` -> error
  - **Defaults:**
    - `max_retries` defaults to 2
    - `model` defaults to `"opus"`
    - `max_turns` defaults to 50
    - `max_budget_usd` defaults to 5.0
    - `timeout_seconds` defaults to 1800
    - `main_branch` defaults to `"main"`
    - `branch_prefix` defaults to `"ralph/"`
  - **Environment override:**
    - Env vars override config values for one-off testing
  - **Missing config file:**
    - Throws descriptive error (not cryptic ENOENT)
- **Dependencies:** Implementation of `src/orchestrator/config.ts`
- **Size:** S

---

### Tier 4: Client Tests

Client commands that create, list, review, and inspect tasks.

---

#### T-C1: Create Task

- **File:** `test/client/create-task.test.ts`
- **Covers:**
  - **Minimal creation:**
    - `ralph task create --title "Fix bug"` creates file in `pending/`
    - Generated fields: `id` (unique), `status` (`pending`), `priority` (100), `type` (`default`), `created_at` (ISO timestamp), `author`
  - **Full creation:**
    - All optional fields: `--type bugfix`, `--priority 50`, `--files src/a.ts`, `--acceptance-criteria "tests pass"`
  - **ID generation:**
    - IDs are unique across calls
    - ID format is `task-NNN` (zero-padded or sequential)
  - **Validation:**
    - Missing `--title` -> error
    - Invalid `--type` value -> error or warning with fallback to `default`
    - Invalid `--priority` (non-numeric) -> error
  - **File output:**
    - Created file is valid task file (parseable by `parseTaskFile()`)
    - Frontmatter and markdown body are correctly formatted
  - **Git integration:**
    - File is staged and committed
    - Commit message format: `ralph(<id>): created`
- **Dependencies:** `src/client/create-task.ts`, `src/core/task-file.ts`, `SourceControl` adapter
- **Size:** M

---

#### T-C2: Review Task

- **File:** `test/client/review-task.test.ts`
- **Covers:**
  - **Approve flow:**
    - Task in `review/` -> approve -> moves to `done/`
    - Branch `ralph/<task-id>` merged into main
    - Branch deleted after merge (local + remote)
    - Commit message: `ralph(<id>): approved`
  - **Reject flow:**
    - Task in `review/` -> reject -> moves to `pending/` (re-queue) or `failed/`
    - Branch `ralph/<task-id>` deleted (work discarded)
    - `retryCount` incremented on re-queue
    - Commit message: `ralph(<id>): rejected`
  - **Validation:**
    - Review task not in `review/` -> error
    - Task ID not found -> error
  - **Diff display:**
    - `ralph review <id>` shows diff of `ralph/<task-id>` branch vs main before action
- **Dependencies:** `src/client/review-task.ts`, `SourceControl` adapter, `FsTaskRepository`
- **Size:** M

---

#### T-C3: List Tasks

- **File:** `test/client/list-tasks.test.ts`
- **Covers:**
  - Lists tasks across all status directories
  - Filters by status (`--status pending`)
  - Output formats: table (default), JSON (`--json`), plain
  - Empty queue shows appropriate message
  - Tasks sorted by priority within each status group
- **Dependencies:** `src/client/list-tasks.ts`, `FsTaskRepository`
- **Size:** S

---

### Tier 5: E2E Tests

Full system tests. These are slow, expensive, and primarily for confidence before deployment.

---

#### T-E1: Full Loop with Mock Claude (Automated)

- **File:** `test/e2e/full-loop-mock.test.ts`
- **Covers:**
  - **End-to-end cycle using mock executor:**
    1. Initialize `.ralph/` directory structure with config
    2. Create a task via client CLI (or directly via `create-task`)
    3. Start orchestrator loop (single iteration, not polling)
    4. Mock executor writes a file and returns success
    5. Verification passes (using `echo ok` as test command)
    6. Task ends up in `review/`
    7. Branch `ralph/<task-id>` has the mock executor's commits
    8. Approve task via client CLI
    9. Task ends up in `done/`
    10. Branch merged and deleted
  - **Validates full wiring:** All adapters connected, all ports bound, all events emitted
  - This is the cheapest automated confidence test for the full system.
- **Dependencies:** All implementation modules, mock executor
- **Size:** L

---

#### T-E2: Full Loop with Real Claude (Manual)

- **File:** `test/e2e/full-loop-real.test.ts` (skipped in CI, run manually)
- **Covers:**
  - Same cycle as T-E1 but with real `claude` CLI
  - Uses a trivial task: "Create a file `hello.txt` with contents 'Hello from Ralph'"
  - Verifies Claude actually creates the file
  - Verifies verification passes
  - Verifies task reaches `review/`
  - Requires `ANTHROPIC_API_KEY` in environment
  - **Tagged:** `@manual`, `@slow`, `@costs-money`
- **Dependencies:** All implementation modules, `claude` CLI installed, API key
- **Size:** L

---

#### T-E3: Crash Recovery E2E

- **File:** `test/e2e/crash-recovery.test.ts`
- **Covers:**
  - Simulate crash by placing task in `active/` with stale `claimed_at` (no running process)
  - Start orchestrator
  - Verify recovery runs: orphan detected, moved back to `pending/` or `failed/`
  - Verify orchestrator continues normal operation after recovery
- **Dependencies:** All implementation modules
- **Size:** M

---

### Tier 6: Doctor Tests

---

#### T-D1: Doctor Command

- **File:** `test/doctor.test.ts`
- **Covers:**
  - Detects missing `.ralph/` directory
  - Detects missing `.ralph/config.json`
  - Detects missing `.ralph/tasks/` subdirectories
  - Detects missing `ralph-system.md`
  - Detects git not initialized
  - Detects git remote not configured
  - Detects `claude` CLI not installed (or not in PATH)
  - Detects missing `ANTHROPIC_API_KEY` (for node mode)
  - All checks pass -> clean report
  - Reports multiple issues in one run
  - Same checks used by `ralph doctor`, orchestrator startup, and `ralph init`
- **Dependencies:** Implementation of `src/doctor.ts`
- **Size:** M

---

## Quality Gates

Gates define what must pass before moving to the next implementation phase. They are enforced by CI and by human review.

### Gate 1: Core Complete (Phase 1 -> Phase 2)

**All Tier 1 unit tests pass.**

| Task | Test File | Must Pass |
|------|-----------|-----------|
| T-U1 | `task-file.test.ts` | All scenarios |
| T-U2 | `state-machine.test.ts` | All valid + invalid transitions |
| T-U3 | `queue.test.ts` | All sorting scenarios |
| T-U4 | `prompt-builder.test.ts` | All interpolation + snapshots |
| T-U5 | `budget.test.ts` | All predicates |
| T-U6 | `consistency.test.ts` | All scenarios |

**Criteria:** `bun test test/core/` passes with 0 failures. Coverage: every public function in `src/core/` has at least one test.

---

### Gate 2: Adapters Complete (Phase 2 -> Phase 3)

**All Tier 2 integration tests pass.**

| Task | Test File | Must Pass |
|------|-----------|-----------|
| T-I1 | `fs-task-repository.test.ts` | All CRUD + scanning |
| T-I2 | `git-source-control.test.ts` | All git operations |
| T-I3 | `claude-cli-executor.test.ts` | CLI construction + output parsing |
| T-I4 | `shell-verifier.test.ts` | Pass/fail scenarios |
| T-I5 | `composite-observability.test.ts` | Fan-out behavior |

**Criteria:** `bun test test/adapters/` passes with 0 failures. Each adapter satisfies its port interface contract.

---

### Gate 3: Orchestrator Wired (Phase 3 -> Phase 4)

**Orchestrator loop test passes with mock executor.**

| Task | Test File | Must Pass |
|------|-----------|-----------|
| T-O1 | `loop.test.ts` | Happy path + retry + failure |
| T-O2 | `recovery.test.ts` | Orphan detection + recovery |
| T-O3 | `config.test.ts` | Load + validate + defaults |

**Criteria:** `bun test test/orchestrator/` passes with 0 failures. Full claim -> execute -> verify -> transition cycle completes with mock executor.

---

### Gate 4: Client Functional (Phase 4 -> Phase 5)

**Client tests pass.**

| Task | Test File | Must Pass |
|------|-----------|-----------|
| T-C1 | `create-task.test.ts` | Creation + validation + git commit |
| T-C2 | `review-task.test.ts` | Approve + reject flows |
| T-C3 | `list-tasks.test.ts` | Listing + filtering |
| T-D1 | `doctor.test.ts` | All checks |

**Criteria:** `bun test test/client/ test/doctor.test.ts` passes. CLI commands produce correct output and side effects.

---

### Gate 5: E2E with Mock (Phase 5 -> Phase 6)

**Full loop E2E passes with mock Claude.**

| Task | Test File | Must Pass |
|------|-----------|-----------|
| T-E1 | `full-loop-mock.test.ts` | Complete lifecycle |
| T-E3 | `crash-recovery.test.ts` | Recovery cycle |

**Criteria:** `bun test test/e2e/` passes (excluding `@manual` tagged tests). Full lifecycle from task creation to approval works without real Claude.

---

### Gate 6: Real Claude Verified (Phase 6 -> Deployment)

**Manual verification with real Claude.**

| Task | Test File | Must Pass |
|------|-----------|-----------|
| T-E2 | `full-loop-real.test.ts` | Manual run succeeds |

**Criteria:** A human runs T-E2 locally, observes the full cycle with a real `claude` CLI call, and confirms the task reaches `review/` with correct work product. This is a manual gate.

---

## Task Summary Table

| Task ID | Title | File | Tier | Size | Dependencies (impl tasks) |
|---------|-------|------|------|------|--------------------------|
| T-U1 | Task file parse/serialize | `test/core/task-file.test.ts` | Unit | M | `core/types.ts`, `core/task-file.ts` |
| T-U2 | State machine transitions | `test/core/state-machine.test.ts` | Unit | M | `core/types.ts`, `core/state-machine.ts` |
| T-U3 | Task queue selection | `test/core/queue.test.ts` | Unit | S | `core/types.ts`, `core/queue.ts` |
| T-U4 | Prompt builder | `test/core/prompt-builder.test.ts` | Unit | M | `core/types.ts`, `core/prompt-builder.ts` |
| T-U5 | Budget predicates | `test/core/budget.test.ts` | Unit | S | `core/types.ts`, `core/budget.ts` |
| T-U6 | Consistency checks | `test/core/consistency.test.ts` | Unit | S | `core/types.ts`, `core/consistency.ts` |
| T-I1 | Filesystem task repository | `test/adapters/fs-task-repository.test.ts` | Integration | M | `adapters/fs-task-repository.ts`, `core/task-file.ts` |
| T-I2 | Git source control | `test/adapters/git-source-control.test.ts` | Integration | L | `adapters/git-source-control.ts` |
| T-I3 | Claude CLI executor | `test/adapters/claude-cli-executor.test.ts` | Integration | M | `adapters/claude-cli-executor.ts` |
| T-I4 | Shell verifier | `test/adapters/shell-verifier.test.ts` | Integration | S | `adapters/shell-verifier.ts` |
| T-I5 | Composite observability | `test/adapters/composite-observability.test.ts` | Integration | S | `adapters/composite-observability.ts`, child adapters |
| T-O1 | Orchestrator loop | `test/orchestrator/loop.test.ts` | Orchestrator | L | All core + adapters + `orchestrator/loop.ts` |
| T-O2 | Crash recovery | `test/orchestrator/recovery.test.ts` | Orchestrator | M | `orchestrator/recovery.ts`, state machine, repos |
| T-O3 | Config loading | `test/orchestrator/config.test.ts` | Orchestrator | S | `orchestrator/config.ts` |
| T-C1 | Create task | `test/client/create-task.test.ts` | Client | M | `client/create-task.ts`, `core/task-file.ts` |
| T-C2 | Review task | `test/client/review-task.test.ts` | Client | M | `client/review-task.ts`, source control |
| T-C3 | List tasks | `test/client/list-tasks.test.ts` | Client | S | `client/list-tasks.ts`, task repository |
| T-D1 | Doctor command | `test/doctor.test.ts` | Client | M | `doctor.ts` |
| T-E1 | Full loop (mock Claude) | `test/e2e/full-loop-mock.test.ts` | E2E | L | All modules + mock executor |
| T-E2 | Full loop (real Claude) | `test/e2e/full-loop-real.test.ts` | E2E | L | All modules + `claude` CLI |
| T-E3 | Crash recovery E2E | `test/e2e/crash-recovery.test.ts` | E2E | M | All modules |

---

## Mock Strategy

### Mock Adapters (in `src/adapters/mock/`)

| Mock | Purpose |
|------|---------|
| `mock-executor.ts` | Returns canned `ExecutionResult` for orchestrator tests. Configurable: success, failure, timeout, max_turns. Optionally writes files to simulate Claude's work. |
| `mock-source-control.ts` | In-memory git state. Tracks branches, commits, files. No real git calls. Used for fast orchestrator unit tests. |
| `mock-observability.ts` | Records all emitted events in an array. Tests assert on event sequence and payloads. |

### When to Use Real vs Mock

| Component | Unit Tests | Integration Tests | E2E Tests |
|-----------|-----------|-------------------|-----------|
| TaskRepository | N/A (core is pure) | Real (temp dirs) | Real |
| SourceControl | Mock | Real (local bare repos) | Real |
| AgentExecutor | N/A | Mock (subprocess mock) | Mock (T-E1) / Real (T-E2) |
| Verifier | N/A | Real (`echo` commands) | Real |
| Observability | N/A | Real (composite) | Real |

---

## CI Pipeline

```
bun test test/core/          # Gate 1: ~1s
bun test test/adapters/       # Gate 2: ~5s
bun test test/orchestrator/   # Gate 3: ~3s
bun test test/client/         # Gate 4: ~3s
bun test test/doctor.test.ts  # Gate 4 cont.
bun test test/e2e/            # Gate 5: ~10s (excludes @manual)
```

Total automated suite target: <30 seconds.

Tests tagged `@manual` or `@slow` are excluded from CI and run on-demand by a developer.

---

## Test Writing Guidelines

1. **Each test file is self-contained.** Setup and teardown happen in `beforeEach`/`afterEach`. No shared mutable state between tests.
2. **Temp directories are cleaned up.** Use `mkdtemp` for filesystem tests and `rm -rf` in `afterAll`.
3. **Git tests use local bare repos.** No network calls. `git init --bare` in a temp dir, then clone.
4. **Snapshot tests for prompts.** The first time a snapshot is created, a developer reviews it. After that, regressions are caught automatically.
5. **No flaky tests.** If a test depends on timing, it's wrong. Mock time if needed.
6. **Test names describe behavior, not implementation.** `"returns null when queue is empty"` not `"tests pickNextTask with empty array"`.
