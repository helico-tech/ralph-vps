# Ralph VPS -- Product Backlog

> Generated from brainstorm consensus (2026-03-03)
> Architecture B: Typed Orchestrator | Hexagonal, 5 ports, pure core, git-only communication

---

## Overview

- **10 epics, 60 tasks** (39 implementation + 21 test tasks, merged into their parent epics)
- **Estimated effort:** 22 S + 25 M + 13 L
- **V1 scope:** Must-have covers Epics 1-8 and 10 (core system + deployment + E2E confidence). Should-have covers Epic 9 (skills) and selected tasks within other epics.
- **Critical path:** E1 -> E2 -> E3 -> E4 -> E5 -> E10 (setup -> core -> ports -> adapters -> orchestrator -> E2E validation)
- **Test runner:** `bun test` | **Test location:** `test/` mirroring `src/` | **Target CI time:** <30 seconds

---

## Phase Summary

| Phase | Epics | Estimated Size | Quality Gate |
|-------|-------|----------------|--------------|
| Phase 1: Pure Core | E1 (Setup) + E2 (Core Domain) + E7 (Templates) | 4S + 1M (E1), 3S + 4M (E2), 4S (E7), 6x M test | Gate 1: All Tier 1 unit tests pass |
| Phase 2: Adapters | E3 (Ports) + E4 (Adapters) | 1S (E3), 2S + 4M + 1L (E4), 1S + 2M + 1L test | Gate 2: All Tier 2 integration tests pass |
| Phase 3: Orchestrator | E5 (Orchestrator) | 2S + 1M + 1L (E5), 1S + 1M + 1L test | Gate 3: Orchestrator loop test passes with mock |
| Phase 4: Client | E6 (Client CLI) | 3S + 4M (E6), 1S + 2M + 1M test | Gate 4: Client tests pass |
| Phase 5: E2E | E10 (Integration & E2E) | 1M + 1L + 2M (E10), 1M + 2L test | Gate 5: Full loop E2E passes with mock Claude |
| Phase 6: Deployment | E8 (Deployment) + E9 (Skills) | 3S + 1M (E8), 4S (E9) | Gate 6: Manual verification with real Claude |

---

## V1 Scope Boundaries

### Must-Have
- Orchestrator loop (poll -> claim -> execute -> verify -> transition)
- 5 ports with real adapters (TaskRepository, SourceControl, AgentExecutor, Verifier, Observability)
- Task file format with YAML frontmatter
- 3 prompt templates (default, bugfix, feature) + system prompt (`ralph-system.md`)
- Client CLI (`ralph task create|list`, `ralph status`, `ralph review`)
- `ralph doctor`
- Docker deployment adapter
- Crash recovery on startup
- Explicit file staging (never `git add -A`)

### Should-Have (marked with `[SH]` in task list)
- Bare VPS (systemd) deployment adapter
- `ralph init project` scaffolding
- `ralph init node` (SSH-based provisioning)
- `ralph hello` first-task experience
- 4 Claude Code skills (Epic 9)
- Budget enforcement (per-task + daily limits)
- Trace files on disk with summary in frontmatter

---

## Epic 1: Project Setup

### Description
Scaffolding, tooling configuration, and directory structure. Everything needed before writing a single line of domain logic.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-001 | Initialize package.json and install dependencies | S | -- | 1 |
| TASK-002 | Configure TypeScript and Bun | S | TASK-001 | 1 |
| TASK-003 | Create directory structure and placeholder files | S | TASK-002 | 1 |
| TASK-004 | Set up .ralph/config.json with consensus schema | S | TASK-003 | 1 |

#### TASK-001: Initialize package.json and install dependencies
**Description:** Create `package.json` with Bun as the runtime. Install dev dependencies: `typescript`, `@types/bun`. Set up `scripts` for `dev`, `build`, `test`, `check` (type-check only). The project is a single binary with two modes (`ralph start` for orchestrator, `ralph task|status|review` for client).
**Files:** `package.json`
**Acceptance Criteria:**
- `bun install` succeeds with zero errors
- `bun run check` runs `tsc --noEmit` successfully
- `bun run test` runs `bun test` successfully (even if zero tests)
- `bin` entry points to `src/cli.ts`
**Size:** S
**Dependencies:** --

#### TASK-002: Configure TypeScript and Bun
**Description:** Create `tsconfig.json` with strict mode, path aliases if needed. Create `bunfig.toml` with test configuration. Target should be modern (ES2022+). Module resolution should be `bundler` for Bun compatibility.
**Files:** `tsconfig.json`, `bunfig.toml`
**Acceptance Criteria:**
- `bun run check` passes on an empty `src/cli.ts` stub
- `bun test` runs with no errors (empty test suite)
- Strict mode enabled (`strict: true`)
**Size:** S
**Dependencies:** TASK-001

#### TASK-003: Create directory structure and placeholder files
**Description:** Create the canonical directory structure from the deep dive consensus. Every directory gets a placeholder or minimal file so the structure is visible in git. Create the `.ralph/` runtime directories with appropriate `.gitkeep` files. Create `.ralph/.gitignore` for `heartbeat.json` and `traces/`.
**Files:** `src/core/`, `src/ports/`, `src/adapters/`, `src/adapters/mock/`, `src/orchestrator/`, `src/client/`, `src/cli.ts`, `src/doctor.ts`, `templates/`, `docker/`, `systemd/`, `skills/`, `test/core/`, `test/adapters/`, `test/orchestrator/`, `test/client/`, `.ralph/config.json`, `.ralph/tasks/{pending,active,review,done,failed}/`, `.ralph/.gitignore`
**Acceptance Criteria:**
- All directories exist and are tracked in git
- `.ralph/config.json` contains a valid skeleton config matching the consensus schema
- `.ralph/.gitignore` excludes `heartbeat.json` and `traces/`
- `bun run check` still passes
**Size:** S
**Dependencies:** TASK-002

#### TASK-004: Set up .ralph/config.json with consensus schema
**Description:** Create the canonical `.ralph/config.json` matching the schema from the deep dive consensus. Include all sections: `version`, `project`, `verify`, `task_defaults`, `exit_criteria`, `git`, `execution`. Use sensible defaults for a generic project.
**Files:** `.ralph/config.json`
**Acceptance Criteria:**
- Config matches the schema defined in DEEPDIVE-CONSENSUS.md Conflict 9
- All fields present with documented defaults
- `version: 1` is set
**Size:** S
**Dependencies:** TASK-003

---

## Epic 2: Pure Core Domain

### Description
All pure functions, zero I/O. This is the heart of the system. Every function here is deterministic, trivially testable, and has no external dependencies. The order follows the deep dive confidence ladder Phase 1.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-005 | Define core types | M | TASK-002 | 1 |
| TASK-006 | Define error types | S | TASK-002 | 1 |
| TASK-007 | Implement task file parser and serializer | M | TASK-005 | 1 |
| TASK-008 | Test: Task file parse/serialize | M | TASK-007 | 1 |
| TASK-009 | Implement state machine | S | TASK-005, TASK-006 | 1 |
| TASK-010 | Test: State machine transitions | M | TASK-009 | 1 |
| TASK-011 | Implement task queue / picker | S | TASK-005 | 1 |
| TASK-012 | Test: Task queue selection | S | TASK-011 | 1 |
| TASK-013 | Implement prompt builder | M | TASK-005 | 1 |
| TASK-014 | Test: Prompt builder | M | TASK-013 | 1 |
| TASK-015 | Implement budget enforcement | S | TASK-005 | 1 |
| TASK-016 | Test: Budget predicates | S | TASK-015 | 1 |
| TASK-017 | Implement consistency checks | -- | TASK-005 | 1 |
| TASK-018 | Test: Consistency checks | S | TASK-017 | 1 |

#### TASK-005: Define core types
**Description:** Create all core type definitions: `Task`, `TaskStatus`, `TaskType`, `ExecutionResult`, `ExecutionPlan`, `DomainEvent`, `RalphConfig`, `PromptTemplate`, `VerificationResult`, and supporting types. `TaskStatus` is a union of `"pending" | "active" | "review" | "done" | "failed"`. `TaskType` is `"bugfix" | "feature" | "refactor" | "research" | "test" | "chore"`. Include all frontmatter fields from the canonical task file format.
**Files:** `src/core/types.ts`
**Acceptance Criteria:**
- All types from the consensus documents are defined
- `bun run check` passes (types compile)
- No I/O imports
- `DomainEvent` is a discriminated union covering: `task.claimed`, `task.completed`, `task.failed`, `task.retried`, `execution.started`, `execution.completed`, `verification.started`, `verification.completed`, `budget.exceeded`, `orchestrator.started`, `orchestrator.stopped`
**Size:** M
**Dependencies:** TASK-002

#### TASK-006: Define error types
**Description:** Define custom error classes: `TaskError` (invalid transitions, parse errors), `GitError` (git operation failures), `ExecutionError` (Claude CLI failures), `ConfigError` (invalid configuration), `VerificationError` (test/build/lint failures). Each error should have a `code` string for programmatic handling and a human-readable `message`.
**Files:** `src/core/errors.ts`
**Acceptance Criteria:**
- All error types extend `Error`
- Each has a `code` property (e.g., `"INVALID_TRANSITION"`, `"GIT_PUSH_FAILED"`)
- All error classes compile and are importable
- Zero I/O imports
**Size:** S
**Dependencies:** TASK-002

#### TASK-007: Implement task file parser and serializer
**Description:** Implement `parseTaskFile(content: string): Task` and `serializeTaskFile(task: Task): string`. Parses Markdown with YAML frontmatter. Extracts all structured fields from frontmatter, body is the markdown content below the frontmatter. Must handle all frontmatter fields: `id`, `title`, `status`, `type`, `priority`, `created_at`, `author`, `acceptance_criteria`, `files`, `constraints`, `max_retries`, `cost_usd`, `turns`, `duration_s`, `attempt`, `branch`. Roundtrip must be stable: `serializeTaskFile(parseTaskFile(input))` preserves data.
**Files:** `src/core/task-file.ts`
**Acceptance Criteria:**
- Parses the canonical task file format from DEEPDIVE-CONSENSUS.md
- Serializes back to valid frontmatter + markdown body
- Roundtrip stability: parse then serialize preserves all data
- Handles missing optional fields gracefully (defaults applied)
- Handles edge cases: empty body, no frontmatter, malformed YAML
- Zero I/O imports -- operates on strings only
**Size:** M
**Dependencies:** TASK-005

#### TASK-008: Test: Task file parse/serialize
**Description:** Comprehensive test suite for task file parsing and serialization.
**Files:** `test/core/task-file.test.ts`
**Acceptance Criteria:**
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
**Size:** M
**Dependencies:** TASK-007

#### TASK-009: Implement state machine
**Description:** Implement `transitionTask(task: Task, targetStatus: TaskStatus): Task` as a pure function. Enforces valid state transitions: `pending -> active`, `active -> review`, `active -> pending` (retry), `active -> failed`, `review -> done`, `review -> pending` (rejected). All other transitions throw `TaskError`. Returns a new Task object with updated status (and `claimed_at` for active, `completed_at` for done/failed). Also implement `getValidTransitions(status: TaskStatus): TaskStatus[]`.
**Files:** `src/core/state-machine.ts`
**Acceptance Criteria:**
- All valid transitions work and return updated Task
- All invalid transitions throw `TaskError` with descriptive message
- `getValidTransitions()` returns correct targets for each status
- Terminal states (`done`, `failed`) have no valid transitions out
- Zero I/O imports
**Size:** S
**Dependencies:** TASK-005, TASK-006

#### TASK-010: Test: State machine transitions
**Description:** Comprehensive test suite for the state machine.
**Files:** `test/core/state-machine.test.ts`
**Acceptance Criteria:**
- **Valid transitions:** `pending` -> `active` (claim), `active` -> `review` (verification passed), `active` -> `pending` (retry, retries remaining), `active` -> `failed` (retry limit reached), `review` -> `done` (approved), `review` -> `pending` (rejected, re-queue), `review` -> `failed` (rejected permanently)
- **Invalid transitions (all throw):** `pending` -> `review`, `pending` -> `done`, `done` -> anything, `failed` -> anything, `active` -> `active`, `review` -> `active`
- **Guard conditions:** `active` -> `pending` requires `retryCount < maxRetries`, `active` -> `failed` requires `retryCount >= maxRetries` OR explicit permanent failure flag
- **Frontmatter updates:** `pending` -> `active` sets `claimed_at`, `active` -> `review` adds `cost_usd`/`turns`/`duration_s`/`attempt`, `active` -> `pending` increments `retryCount`
**Size:** M
**Dependencies:** TASK-009

#### TASK-011: Implement task queue / picker
**Description:** Implement `pickNextTask(tasks: Task[]): Task | null`. Pure function that selects the highest-priority pending task. Sorting: primary by `priority` (lower number = higher priority), secondary by `created_at` (oldest first). Filters to only `pending` status. Returns `null` if no pending tasks.
**Files:** `src/core/queue.ts`
**Acceptance Criteria:**
- Returns highest priority task
- Breaks ties by `created_at` (oldest wins)
- Returns `null` for empty array or no pending tasks
- Ignores non-pending tasks
- Zero I/O imports
**Size:** S
**Dependencies:** TASK-005

#### TASK-012: Test: Task queue selection
**Description:** Test suite for the task queue picker.
**Files:** `test/core/queue.test.ts`
**Acceptance Criteria:**
- Tasks sorted by priority (lower number = higher priority)
- Tiebreak by `created_at` (earlier tasks first)
- Empty pending directory returns `null`
- Single task in queue returns that task
- Multiple tasks with same priority use `created_at` tiebreaker
- Tasks with missing priority use default (100)
- `pickNextTask()` is a pure function over a task array (deterministic)
**Size:** S
**Dependencies:** TASK-011

#### TASK-013: Implement prompt builder
**Description:** Implement `buildPrompt(task: Task, template: string): string`. Pure function that interpolates task data into a template string. Template variables use `{{variable}}` syntax. Also implement `buildExecutionPlan(task: Task, template: string, config: RalphConfig): ExecutionPlan` that wraps `buildPrompt` and adds model, maxTurns, budgetUsd, timeoutMs, systemPromptFile from config.
**Files:** `src/core/prompt-builder.ts`
**Acceptance Criteria:**
- All template variables are interpolated correctly
- Missing `acceptance_criteria` gets the fallback: "The described change works correctly and all tests pass."
- Missing `files` renders as "No specific files targeted."
- Missing `constraints` renders as empty (no placeholder)
- `buildExecutionPlan` correctly merges task + template + config
- Zero I/O imports
**Size:** M
**Dependencies:** TASK-005

#### TASK-014: Test: Prompt builder
**Description:** Test suite for prompt building and execution plan creation.
**Files:** `test/core/prompt-builder.test.ts`
**Acceptance Criteria:**
- Template interpolation with all variables (`{{title}}`, `{{description}}`, `{{acceptance_criteria}}`, `{{files}}`, `{{constraints}}`)
- Missing optional variables produce clean output (no `{{undefined}}` artifacts)
- Template selection by task type (`bugfix` -> `bugfix.md`, `feature` -> `feature.md`)
- Unknown task type falls back to `default.md`
- `acceptance_criteria` array rendered as bullet list
- `files` array rendered as scoped file list
- `constraints` array rendered as constraint list
- Missing `acceptance_criteria` injects fallback
- Snapshot tests for each template (default, bugfix, feature) with a representative task
- `buildPrompt()` is pure: `(task, template) => string`
- `buildExecutionPlan()` merges config defaults with per-type overrides
**Size:** M
**Dependencies:** TASK-013

#### TASK-015: Implement budget enforcement `[SH]`
**Description:** Implement `canClaimTask(costs, limits, taskBudget): boolean` and `calculateCosts(tasks, date): { today, total }`. Pure predicates. Budget enforcement is a should-have feature for V1.
**Files:** `src/core/budget.ts`
**Acceptance Criteria:**
- `canClaimTask` returns `false` when any limit would be exceeded
- `canClaimTask` returns `true` when all limits have headroom
- `calculateCosts` correctly sums costs from done and failed tasks
- `calculateCosts` handles tasks without `cost_usd` (treats as 0)
- `calculateCosts` correctly identifies "today" based on a date parameter (not `Date.now()` -- keep it pure)
- Zero I/O imports
**Size:** S
**Dependencies:** TASK-005

#### TASK-016: Test: Budget predicates `[SH]`
**Description:** Test suite for budget enforcement predicates.
**Files:** `test/core/budget.test.ts`
**Acceptance Criteria:**
- `canClaimTask()` returns `true` when costs are within limits
- `canClaimTask()` returns `false` when daily budget exceeded
- `canClaimTask()` returns `false` when per-task budget exceeded
- Edge case: costs exactly at limit -> returns `false`
- Edge case: costs slightly under limit -> returns `true`
- Edge case: zero costs, positive limits -> returns `true`
- Edge case: positive costs, zero limit (unlimited) -> returns `true`
- `calculateCosts()` aggregates from execution results
- Pure function: no side effects, no I/O
**Size:** S
**Dependencies:** TASK-015

#### TASK-017: Implement consistency checks
**Description:** Implement `checkConsistency()` -- scans `pending/`, `active/`, `review/` for inconsistencies like tasks in `active/` with no matching branch, duplicate task IDs across directories. Skips terminal states (`done/`, `failed/`).
**Files:** `src/core/consistency.ts`
**Acceptance Criteria:**
- Detects task in `active/` with no matching branch
- Detects duplicate task IDs across directories
- Skips terminal states
- Returns clean result for consistent state
- Reports multiple issues in a single scan
**Size:** S (implied from test strategy)
**Dependencies:** TASK-005

#### TASK-018: Test: Consistency checks
**Description:** Test suite for consistency checking logic.
**Files:** `test/core/consistency.test.ts`
**Acceptance Criteria:**
- Detects task in `active/` with no matching branch
- Detects duplicate task IDs across directories
- Skips terminal states (`done/`, `failed/`) -- not scanned
- Returns clean result for consistent state
- Reports multiple issues in a single scan
**Size:** S
**Dependencies:** TASK-017

---

## Epic 7: Prompt Templates & System Prompt

### Description
The prompt templates and system prompt that guide Claude's behavior during task execution. These are standalone markdown files with no code dependencies -- can be built in parallel with core domain work.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-019 | Create default.md template | S | -- | 1 |
| TASK-020 | Create bugfix.md template | S | -- | 1 |
| TASK-021 | Create feature.md template | S | -- | 1 |
| TASK-022 | Create ralph-system.md system prompt | S | -- | 1 |

#### TASK-019: Create default.md template
**Description:** Create the default prompt template used when a task has an unknown type or `type: "feature"` with no specialized template. Uses `{{variable}}` interpolation.
**Files:** `templates/default.md`
**Acceptance Criteria:**
- Contains all template variables: `{{title}}`, `{{description}}`, `{{acceptance_criteria}}`, `{{files}}`, `{{constraints}}`, `{{id}}`
- Provides clear instructions for: understanding the task, making changes, running tests, not overstepping scope
- Works as a sensible fallback for any task type
- Readable and well-structured
**Size:** S
**Dependencies:** --

#### TASK-020: Create bugfix.md template
**Description:** Create the bugfix-specific prompt template. Emphasizes: reproducing the bug first, understanding root cause before fixing, writing a regression test, minimal change surface.
**Files:** `templates/bugfix.md`
**Acceptance Criteria:**
- Contains all standard template variables
- Includes bugfix-specific instructions: reproduce, root cause, minimal fix, regression test
- Differentiates from default template in workflow guidance
**Size:** S
**Dependencies:** --

#### TASK-021: Create feature.md template
**Description:** Create the feature-specific prompt template. Emphasizes: understanding existing patterns before adding code, following project conventions, writing tests for new functionality, keeping scope tight.
**Files:** `templates/feature.md`
**Acceptance Criteria:**
- Contains all standard template variables
- Includes feature-specific instructions: study patterns, follow conventions, test new code, stay in scope
- Differentiates from default template in workflow guidance
**Size:** S
**Dependencies:** --

#### TASK-022: Create ralph-system.md system prompt
**Description:** Create `.ralph/ralph-system.md` -- the system prompt appended to every Claude invocation. Contains Ralph behavioral rules: work autonomously, commit with `ralph(<id>): <action>` format, never force push, never `git add -A`, never modify `.ralph/config.json`, report when stuck, stay within task scope, run tests after every change, explicit file staging only.
**Files:** `.ralph/ralph-system.md`
**Acceptance Criteria:**
- Covers all behavioral rules from consensus: commit format, no force push, no `git add -A`, scope discipline, test after changes, explicit staging
- Does NOT duplicate CLAUDE.md content (no build commands, no project architecture)
- Includes "stuck protocol" -- what to do when blocked
**Size:** S
**Dependencies:** --

---

> **GATE 1: Core Complete** -- All Tier 1 unit tests pass (`bun test test/core/` with 0 failures). Every public function in `src/core/` has at least one test. **Required before starting Epic 4.**

---

## Epic 3: Port Interfaces

### Description
Define the 5 port interfaces. TypeScript interfaces only -- no implementations. They establish the contract between the pure core and the I/O world.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-023 | Define all port interfaces | S | TASK-005 | 2 |

#### TASK-023: Define all port interfaces
**Description:** Define the 5 port interfaces as specified in the deep dive consensus. Each port is a separate file. Interfaces only, no implementations.
**Files:** `src/ports/task-repository.ts`, `src/ports/source-control.ts`, `src/ports/agent-executor.ts`, `src/ports/verifier.ts`, `src/ports/observability.ts`
**Acceptance Criteria:**
- All 5 interfaces defined and compile
- No implementations, only type signatures
- Interfaces use types from `core/types.ts`
- `bun run check` passes
- `TaskRepository`: `list`, `read`, `write`, `exists`, `getPath`
- `SourceControl`: `pull`, `commit`, `push`, `pushBranch`, `createBranch`, `checkout`, `stageFiles`, `moveFile`, `fetch`, `diff`, `merge`, `deleteBranch`, `log`
- `AgentExecutor`: `run(plan: ExecutionPlan): Promise<ExecutionResult>`
- `Verifier`: `runTests`, `runBuild`, `runLint`
- `Observability`: `emit(event: DomainEvent): void`
**Size:** S
**Dependencies:** TASK-005

---

## Epic 4: Adapters

### Description
Real implementations of the port interfaces. All I/O lives here. Each adapter wraps an external dependency (filesystem, git CLI, Claude CLI, shell).

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-024 | Implement FsTaskRepository | M | TASK-007, TASK-023 | 2 |
| TASK-025 | Test: Filesystem task repository | M | TASK-024 | 2 |
| TASK-026 | Implement GitSourceControl | L | TASK-006, TASK-023 | 2 |
| TASK-027 | Test: Git source control | L | TASK-026 | 2 |
| TASK-028 | Implement ShellVerifier | M | TASK-005, TASK-023 | 2 |
| TASK-029 | Test: Shell verifier | S | TASK-028 | 2 |
| TASK-030 | Implement ClaudeCliExecutor | M | TASK-005, TASK-023 | 2 |
| TASK-031 | Test: Claude CLI executor | M | TASK-030 | 2 |
| TASK-032 | Implement CompositeObservability and child adapters | M | TASK-005, TASK-023 | 2 |
| TASK-033 | Test: Composite observability | S | TASK-032 | 2 |
| TASK-034 | Implement mock adapters for testing | S | TASK-023 | 2 |

#### TASK-024: Implement FsTaskRepository
**Description:** Implement `TaskRepository` backed by the filesystem. Task files live in `.ralph/tasks/<status>/`. Uses `parseTaskFile` and `serializeTaskFile` from core.
**Files:** `src/adapters/fs-task-repository.ts`
**Acceptance Criteria:**
- `list()` returns all tasks from disk, optionally filtered by status
- `read()` finds a task by ID across all status directories
- `write()` creates/updates a task file in the correct status directory
- `exists()` checks if a task file exists
- `getPath()` returns the correct path based on task status
**Size:** M
**Dependencies:** TASK-007, TASK-023

#### TASK-025: Test: Filesystem task repository
**Description:** Integration tests for FsTaskRepository using real filesystem with temp directories.
**Files:** `test/adapters/fs-task-repository.test.ts`
**Acceptance Criteria:**
- **Setup/teardown:** Creates temp directory with `pending/`, `active/`, `review/`, `done/`, `failed/` subdirectories
- `create()` writes task file to `pending/` with correct filename (`<id>.md`)
- `read()` reads and parses task file from any status directory
- `update()` writes updated frontmatter + body to existing file location
- `list()` scans a status directory and returns parsed tasks
- `findById()` searches across all status directories
- Lists only `.md` files (ignores `.DS_Store`, etc.)
- Empty directory returns empty array
- Roundtrip: write -> read -> compare matches original task
- Read nonexistent file throws `TaskError`
**Size:** M
**Dependencies:** TASK-024

#### TASK-026: Implement GitSourceControl
**Description:** Implement `SourceControl` by shelling out to `git` via `Bun.spawn`. Each method maps to one or more git CLI commands. All methods propagate errors as `GitError`.
**Files:** `src/adapters/git-source-control.ts`
**Acceptance Criteria:**
- All `SourceControl` interface methods implemented
- Each method shells out to git CLI correctly
- Errors are caught and wrapped in `GitError`
- `moveFile` uses `git mv` to preserve history
**Size:** L
**Dependencies:** TASK-006, TASK-023

#### TASK-027: Test: Git source control
**Description:** Integration tests for GitSourceControl using real git with temporary bare repos.
**Files:** `test/adapters/git-source-control.test.ts`
**Acceptance Criteria:**
- **Setup/teardown:** Creates local bare repo + cloned working copy in temp dirs
- `pull()` with `--ff-only` fetches and merges
- `commit()` creates commit with correct message format
- `push()` pushes to bare repo successfully
- `push()` returns `false` on rejection (simulate with concurrent push)
- `stageFiles()` stages specific files (not `git add -A`)
- `createBranch()` creates branch from current HEAD
- `checkout()` switches to existing branch
- `pushBranch()` pushes branch to remote
- `deleteBranch()` deletes local and optionally remote branch
- `fetch()`, `diff()`, `merge()` work correctly
- Operations on non-existent branch throw `GitError`
- Moving a task file between status directories preserves history via `git mv`
**Size:** L
**Dependencies:** TASK-026

#### TASK-028: Implement ShellVerifier
**Description:** Implement `Verifier` that runs shell commands via `Bun.spawn(["sh", "-c", command])`. Commands come from `.ralph/config.json` `verify` section.
**Files:** `src/adapters/shell-verifier.ts`
**Acceptance Criteria:**
- Runs commands through `sh -c` (handles pipes, quotes, redirects)
- Returns structured `VerificationResult`
- Skipped commands return pass with "skipped" output
- Captures stdout + stderr in output
- Timeout support (kill process if it takes too long)
- Does not throw -- always returns a result
**Size:** M
**Dependencies:** TASK-005, TASK-023

#### TASK-029: Test: Shell verifier
**Description:** Test suite for ShellVerifier with pass/fail scenarios.
**Files:** `test/adapters/shell-verifier.test.ts`
**Acceptance Criteria:**
- `runTests("echo ok")` returns `{ passed: true }`
- `runBuild("echo ok")` returns `{ passed: true }`
- `runLint("echo ok")` returns `{ passed: true }`
- `runTests("exit 1")` returns `{ passed: false, output: ... }`
- Command with stderr output captures it
- Commands run through `sh -c` (handles pipes, redirects)
- Working directory is set correctly
- If `verify.build` is not in config, `runBuild()` returns `{ passed: true, skipped: true }`
**Size:** S
**Dependencies:** TASK-028

#### TASK-030: Implement ClaudeCliExecutor
**Description:** Implement `AgentExecutor` that shells out to `claude` CLI. Takes an `ExecutionPlan` and constructs the CLI invocation with appropriate flags. Parse the JSON output into `ExecutionResult`.
**Files:** `src/adapters/claude-cli-executor.ts`
**Acceptance Criteria:**
- Constructs correct CLI arguments from `ExecutionPlan`
- Parses JSON output into `ExecutionResult`
- Handles timeout (kills process, returns error result)
- Handles non-zero exit codes gracefully
- Handles missing `claude` binary (clear error message)
- Captures `cost_usd`, `turns`, `duration_s`, `stop_reason` from JSON output
**Size:** M
**Dependencies:** TASK-005, TASK-023

#### TASK-031: Test: Claude CLI executor
**Description:** Test suite for ClaudeCliExecutor with mock subprocess.
**Files:** `test/adapters/claude-cli-executor.test.ts`
**Acceptance Criteria:**
- Builds correct `claude` CLI command from `ExecutionPlan`
- Includes `--model`, `--max-turns`, `--max-budget-usd`, `--output-format json`
- Includes `--append-system-prompt-file` pointing to `ralph-system.md`
- Includes `--dangerously-skip-permissions` when `permission_mode` is `"skip_all"`
- Prompt passed via `-p` flag
- Parses JSON output to `ExecutionResult`
- Extracts `cost_usd`, `num_turns`, `stopReason` from JSON
- Handles `end_turn` and `max_turns` stop reasons
- CLI process exits non-zero -> `ExecutionError`
- CLI process times out -> `ExecutionError` with timeout flag
- Invalid JSON output -> `ExecutionError`
- Empty output -> `ExecutionError`
**Size:** M
**Dependencies:** TASK-030

#### TASK-032: Implement CompositeObservability and child adapters `[SH]`
**Description:** Implement the observability stack: `CompositeObservabilityAdapter` fans out `emit(event)` to child adapters. Three children: `ConsoleLoggerAdapter`, `TraceWriterAdapter`, `HeartbeatWriterAdapter`. Trace files are a should-have feature.
**Files:** `src/adapters/composite-observability.ts`, `src/adapters/console-logger.ts`, `src/adapters/trace-writer.ts`, `src/adapters/heartbeat-writer.ts`
**Acceptance Criteria:**
- `CompositeObservabilityAdapter` calls `emit` on all children
- `ConsoleLoggerAdapter` writes one structured JSON line per event to stdout
- `TraceWriterAdapter` writes per-task trace files and appends to `index.jsonl`
- `HeartbeatWriterAdapter` writes/updates `.ralph/heartbeat.json`
- If a child adapter throws, other children still receive the event (error isolation)
**Size:** M
**Dependencies:** TASK-005, TASK-023

#### TASK-033: Test: Composite observability `[SH]`
**Description:** Test suite for the composite observability fan-out pattern.
**Files:** `test/adapters/composite-observability.test.ts`
**Acceptance Criteria:**
- `emit(event)` calls `emit()` on all child adapters
- Three children: all three receive every event
- `ConsoleLogAdapter`, `TraceWriterAdapter`, `HeartbeatWriterAdapter` all receive events
- If one child throws, other children still receive the event
- `task.claimed`, `execution.completed`, `verification.done`, `task.transitioned` all propagate
**Size:** S
**Dependencies:** TASK-032

#### TASK-034: Implement mock adapters for testing
**Description:** Create test doubles: `MockExecutor`, `MockSourceControl`, `MockObservability`. Used by orchestrator and client tests.
**Files:** `src/adapters/mock/mock-executor.ts`, `src/adapters/mock/mock-source-control.ts`, `src/adapters/mock/mock-observability.ts`
**Acceptance Criteria:**
- Each mock implements its respective port interface
- Each mock records all method calls for assertion
- `MockExecutor` supports configurable success/failure results
- `MockSourceControl` tracks calls and can simulate push failures
- `MockObservability` captures all emitted events for inspection
**Size:** S
**Dependencies:** TASK-023

---

> **GATE 2: Adapters Complete** -- All Tier 2 integration tests pass (`bun test test/adapters/` with 0 failures). Each adapter satisfies its port interface contract. **Required before starting Epic 5.**

---

## Epic 5: Orchestrator

### Description
The main loop. Wires adapters to ports, handles startup, recovery, shutdown, and the poll-claim-execute-verify-transition cycle.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-035 | Implement config loader | S | TASK-005, TASK-006 | 3 |
| TASK-036 | Test: Config loading | S | TASK-035 | 3 |
| TASK-037 | Implement crash recovery | M | TASK-009, TASK-023, TASK-034 | 3 |
| TASK-038 | Test: Crash recovery | M | TASK-037 | 3 |
| TASK-039 | Implement shutdown handler | S | TASK-005, TASK-023 | 3 |
| TASK-040 | Implement main orchestrator loop | L | TASK-035, TASK-037, TASK-039, TASK-024, TASK-026, TASK-028, TASK-030, TASK-032, TASK-011, TASK-013, TASK-015 | 3 |
| TASK-041 | Test: Orchestrator loop (full cycle) | L | TASK-040 | 3 |

#### TASK-035: Implement config loader
**Description:** Implement `loadConfig(configPath: string): RalphConfig`. Reads `.ralph/config.json`, validates all required fields, applies defaults for missing optional fields. Env vars override config values. Throws `ConfigError` for invalid configs.
**Files:** `src/orchestrator/config.ts`
**Acceptance Criteria:**
- Loads and parses `.ralph/config.json`
- Validates required fields (`version`, `verify.test`)
- Applies defaults: `max_retries` (2), `model` ("opus"), `max_turns` (50), `max_budget_usd` (5.0), `timeout_seconds` (1800), `main_branch` ("main"), `branch_prefix` ("ralph/")
- Env var overrides work
- Invalid config throws `ConfigError` with specific messages
- Missing config file throws descriptive error (not cryptic ENOENT)
**Size:** S
**Dependencies:** TASK-005, TASK-006

#### TASK-036: Test: Config loading
**Description:** Test suite for config loading, validation, and defaults.
**Files:** `test/orchestrator/config.test.ts`
**Acceptance Criteria:**
- Loads `.ralph/config.json` with all fields
- Applies defaults for missing optional fields
- Missing `verify.test` -> error (test command is required)
- Invalid `task_defaults.model` -> error or warning
- Negative `max_retries` -> error
- Non-numeric `max_budget_usd` -> error
- Environment override: env vars override config values
- Missing config file: throws descriptive error
**Size:** S
**Dependencies:** TASK-035

#### TASK-037: Implement crash recovery
**Description:** Implement `recoverOrphanedTasks()`. On startup, scans `active/` directory. For tasks found in `active/` (previous run crashed): move back to `pending/` with `retryCount++`, delete stale branches, commit and push. Emits domain events.
**Files:** `src/orchestrator/recovery.ts`
**Acceptance Criteria:**
- Finds all tasks in `active/` status
- Moves each back to `pending/` with incremented `retryCount`
- If `retryCount >= max_retries`, moves to `failed/` instead
- Deletes stale branches for recovered tasks
- Commits recovery changes
- Emits appropriate domain events
**Size:** M
**Dependencies:** TASK-009, TASK-023, TASK-034

#### TASK-038: Test: Crash recovery
**Description:** Test suite for crash recovery behavior.
**Files:** `test/orchestrator/recovery.test.ts`
**Acceptance Criteria:**
- Orphan detection: task in `active/` with no heartbeat and stale `claimed_at` -> detected
- Task in `active/` with recent `claimed_at` -> NOT detected (might be running)
- Orphaned task with retries remaining -> moved back to `pending/`, `retryCount` incremented
- Orphaned task at max retries -> moved to `failed/`
- Stale branch `ralph/<task-id>` cleaned up on recovery
- Multiple tasks in `active/` all recovered in one pass
- Empty `active/` -> completes cleanly
**Size:** M
**Dependencies:** TASK-037

#### TASK-039: Implement shutdown handler
**Description:** Implement graceful shutdown on `SIGTERM` and `SIGINT`. Sets a `shuttingDown` flag, waits for current task to finish, emits `orchestrator.stopped` event.
**Files:** `src/orchestrator/shutdown.ts`
**Acceptance Criteria:**
- Registers handlers for `SIGTERM` and `SIGINT`
- Sets a flag that the main loop can check
- Provides `isShuttingDown(): boolean` and `waitForShutdown(): Promise<void>`
- Emits `orchestrator.stopped` event before exit
- Does not kill active task execution
**Size:** S
**Dependencies:** TASK-005, TASK-023

#### TASK-040: Implement main orchestrator loop
**Description:** Implement the core orchestrator loop: startup (loadConfig, runDoctor, recoverOrphanedTasks, wire adapters) -> poll (checkout main, fetch+merge, canClaimTask, pickNextTask) -> claim (git mv, update frontmatter, commit, push) -> execute (createBranch, buildExecutionPlan, executor.run) -> verify (tests/build/lint) -> transition (review/pending/failed). Emit domain events at each step.
**Files:** `src/orchestrator/loop.ts`
**Acceptance Criteria:**
- Full poll-claim-execute-verify-transition cycle works with mock executor
- Claim failure (push rejected) causes retry from poll step
- Verification runs for both `end_turn` and `max_turns` stop reasons
- Verification is skipped for `refusal`, `timeout`, `error` stop reasons
- Failed tasks with retries left go back to `pending/`
- Failed tasks at max retries go to `failed/`
- Verified tasks go to `review/` and branch is pushed
- Stale branches cleaned up before creating new ones on retry
- Shutdown flag checked between cycles
- Sleep 30s when no task found
- Domain events emitted at each stage
**Size:** L
**Dependencies:** TASK-035, TASK-037, TASK-039, TASK-024, TASK-026, TASK-028, TASK-030, TASK-032, TASK-011, TASK-013, TASK-015

#### TASK-041: Test: Orchestrator loop (full cycle)
**Description:** Comprehensive test suite for the orchestrator loop using mock adapters.
**Files:** `test/orchestrator/loop.test.ts`
**Acceptance Criteria:**
- **Happy path:** Seed `pending/` -> `processTask()` claims -> mock executor succeeds -> verifier passes -> task in `review/` -> branch exists -> events in correct order
- **Retry path:** Mock executor fails -> verifier fails -> task back to `pending/` with `retryCount++` -> stale branch cleaned
- **Permanent failure:** Task at max retries -> executor fails -> task to `failed/`
- **Empty queue:** No tasks -> returns null, loop sleeps
- **Push failure on claim:** Mock push returns `false` -> task reverted
- **Budget exceeded:** `canClaimTask()` returns `false` -> loop sleeps
- **Verification on max_turns:** Executor returns `stopReason: "max_turns"` -> verification still runs
- **Verification skipped on error:** Executor returns error/timeout -> verification skipped
**Size:** L
**Dependencies:** TASK-040

---

> **GATE 3: Orchestrator Wired** -- `bun test test/orchestrator/` passes with 0 failures. Full claim -> execute -> verify -> transition cycle completes with mock executor. **Required before starting Epic 6.**

---

## Epic 6: Client CLI

### Description
User-facing commands for creating tasks, reviewing results, and checking system status. All commands use the same core libraries as the orchestrator.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-042 | Implement create-task command | M | TASK-007, TASK-023, TASK-034 | 4 |
| TASK-043 | Test: Create task | M | TASK-042 | 4 |
| TASK-044 | Implement list-tasks command | S | TASK-007, TASK-024 | 4 |
| TASK-045 | Test: List tasks | S | TASK-044 | 4 |
| TASK-046 | Implement review-task command | M | TASK-009, TASK-023, TASK-034 | 4 |
| TASK-047 | Test: Review task | M | TASK-046 | 4 |
| TASK-048 | Implement status command | S | TASK-024, TASK-026 | 4 |
| TASK-049 | Implement output formatting | S | TASK-005 | 4 |
| TASK-050 | Implement CLI entry point and arg parsing | M | TASK-042, TASK-044, TASK-046, TASK-048, TASK-049, TASK-040 | 4 |
| TASK-051 | Implement doctor command | M | TASK-035 | 4 |
| TASK-052 | Test: Doctor command | M | TASK-051 | 4 |

#### TASK-042: Implement create-task command
**Description:** Implement `createTask(options)`. Takes at minimum a `title`. Generates `id`, sets defaults, serializes to task file, writes to `pending/`, stages, commits, pushes.
**Files:** `src/client/create-task.ts`
**Acceptance Criteria:**
- Creates a valid task file in `pending/` directory
- Auto-generates `id`, `status`, `created_at`, `author`
- Applies defaults for optional fields
- Commits with message `ralph(<id>): created`
- Pushes to remote
- Returns the created `Task` object
**Size:** M
**Dependencies:** TASK-007, TASK-023, TASK-034

#### TASK-043: Test: Create task
**Description:** Test suite for the create-task command.
**Files:** `test/client/create-task.test.ts`
**Acceptance Criteria:**
- Minimal creation: `--title "Fix bug"` creates file in `pending/` with generated fields
- Full creation: all optional fields specified
- IDs are unique across calls
- Missing `--title` -> error
- Invalid `--type` value -> error or warning with fallback
- Created file is valid task file (parseable by `parseTaskFile()`)
- File is staged and committed with correct message format
**Size:** M
**Dependencies:** TASK-042

#### TASK-044: Implement list-tasks command
**Description:** Implement `listTasks(options?)`. Reads task files from `.ralph/tasks/`, optionally filtered by status. Returns parsed Tasks sorted sensibly.
**Files:** `src/client/list-tasks.ts`
**Acceptance Criteria:**
- Lists all tasks or filters by status
- Returns parsed Task objects
- Sorted: active > pending (by priority) > review > done/failed (by date)
- Handles empty directories gracefully
**Size:** S
**Dependencies:** TASK-007, TASK-024

#### TASK-045: Test: List tasks
**Description:** Test suite for the list-tasks command.
**Files:** `test/client/list-tasks.test.ts`
**Acceptance Criteria:**
- Lists tasks across all status directories
- Filters by status (`--status pending`)
- Output formats: table (default), JSON (`--json`), plain
- Empty queue shows appropriate message
- Tasks sorted by priority within each status group
**Size:** S
**Dependencies:** TASK-044

#### TASK-046: Implement review-task command
**Description:** Implement `reviewTask(taskId, action, comment?)`. Approve: merge branch into main, move to `done/`, delete branch. Reject: move to `pending/` or `failed/`, delete branch.
**Files:** `src/client/review-task.ts`
**Acceptance Criteria:**
- Approve: merges branch, moves to `done/`, cleans up branch
- Reject: moves to `pending/`, cleans up branch
- Both actions commit and push
- Optional comment appended to task body under `## Review`
- Errors if task is not in `review/` status
**Size:** M
**Dependencies:** TASK-009, TASK-023, TASK-034

#### TASK-047: Test: Review task
**Description:** Test suite for the review-task command.
**Files:** `test/client/review-task.test.ts`
**Acceptance Criteria:**
- **Approve flow:** Task in `review/` -> approve -> moves to `done/` -> branch merged -> branch deleted -> commit message: `ralph(<id>): approved`
- **Reject flow:** Task in `review/` -> reject -> moves to `pending/` or `failed/` -> branch deleted -> `retryCount` incremented on re-queue
- Review task not in `review/` -> error
- Task ID not found -> error
- `ralph review <id>` shows diff of branch vs main before action
**Size:** M
**Dependencies:** TASK-046

#### TASK-048: Implement status command
**Description:** Implement `getStatus()`. Returns queue summary: counts per status, active task details, last activity timestamp, health inference.
**Files:** `src/client/status.ts`
**Acceptance Criteria:**
- Returns counts per status
- Includes details of currently active task (if any)
- Includes last activity timestamp from git log
- Health inference: "healthy" if recent activity, "possibly down" if stale
- Works with local git data only (after a fetch)
**Size:** S
**Dependencies:** TASK-024, TASK-026

#### TASK-049: Implement output formatting
**Description:** Implement formatters: `table` (aligned columns with ANSI colors), `json` (machine-readable), `plain` (minimal, pipe-friendly).
**Files:** `src/client/format.ts`
**Acceptance Criteria:**
- `formatTable(tasks)` produces aligned columns with ANSI colors
- `formatJson(data)` produces valid JSON
- `formatPlain(tasks)` produces minimal tab-separated output
- `formatStatusReport(report)` formats the status summary
- Handles empty data gracefully
**Size:** S
**Dependencies:** TASK-005

#### TASK-050: Implement CLI entry point and arg parsing
**Description:** Implement `src/cli.ts` as the main entry point. Parse arguments to dispatch to subcommands. Handle `--help`, `--version`, `--format` globally.
**Files:** `src/cli.ts`
**Acceptance Criteria:**
- All subcommands dispatch correctly: `start`, `task create`, `task list`, `review`, `status`, `doctor`
- `--help` prints usage for each command
- `--version` prints version from package.json
- `--format` flag works globally
- Invalid commands print usage and exit 2
- Errors print to stderr and exit 1
**Size:** M
**Dependencies:** TASK-042, TASK-044, TASK-046, TASK-048, TASK-049, TASK-040

#### TASK-051: Implement doctor command
**Description:** Implement `ralph doctor` as a contract checker. Checks: git, `.ralph/` structure, config, `claude` CLI, verify commands, git remote, `ralph-system.md`, templates.
**Files:** `src/doctor.ts`
**Acceptance Criteria:**
- All checks run independently (one failure doesn't skip others)
- Each check outputs pass/fail with actionable message
- Exit code 0 if all pass, 1 if any fail
- Usable both programmatically and as CLI output
**Size:** M
**Dependencies:** TASK-035

#### TASK-052: Test: Doctor command
**Description:** Test suite for the doctor command.
**Files:** `test/doctor.test.ts`
**Acceptance Criteria:**
- Detects missing `.ralph/` directory
- Detects missing `.ralph/config.json`
- Detects missing `.ralph/tasks/` subdirectories
- Detects missing `ralph-system.md`
- Detects git not initialized
- Detects git remote not configured
- Detects `claude` CLI not installed (or not in PATH)
- All checks pass -> clean report
- Reports multiple issues in one run
- Same checks used by `ralph doctor`, orchestrator startup, and `ralph init`
**Size:** M
**Dependencies:** TASK-051

---

> **GATE 4: Client Functional** -- `bun test test/client/ test/doctor.test.ts` passes. CLI commands produce correct output and side effects. **Required before starting Epic 10.**

---

## Epic 10: Integration & E2E Testing

### Description
Full loop testing -- from task creation through execution to review. Validates the complete system wiring.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-053 | Create mock Claude executor for E2E tests | M | TASK-034 | 5 |
| TASK-054 | E2E test: Happy path full cycle | L | TASK-040, TASK-042, TASK-046, TASK-053 | 5 |
| TASK-055 | E2E test: Failure and retry cycle | M | TASK-040, TASK-053 | 5 |
| TASK-056 | E2E test: Crash recovery | M | TASK-037, TASK-040, TASK-053 | 5 |
| TASK-057 | E2E test: Full loop with real Claude (manual) | L | All modules | 6 |

#### TASK-053: Create mock Claude executor for E2E tests
**Description:** Extend the mock executor to simulate realistic Claude behavior. The mock should make predictable file changes, return realistic `ExecutionResult` with cost/turns/duration. Support configurable scenarios.
**Files:** `src/adapters/mock/mock-executor.ts` (extend), `test/e2e/helpers.ts`
**Acceptance Criteria:**
- Mock can simulate file modifications
- Mock produces realistic `ExecutionResult` JSON
- Configurable scenarios: success, partial success (tests fail), timeout, error
- Usable in E2E tests without real Claude API calls
**Size:** M
**Dependencies:** TASK-034

#### TASK-054: E2E test: Happy path full cycle
**Description:** Full happy path: create task -> orchestrator processes it -> task moves to `review/` -> approve -> task moves to `done/`. Uses real filesystem and real git (temp repos) but mock Claude.
**Files:** `test/e2e/happy-path.test.ts`
**Acceptance Criteria:**
- Full cycle completes without errors
- Task transitions: pending -> active -> review -> done
- Git operations verified (branch exists, branch merged)
- Task file frontmatter updated with cost/turns/duration
- All domain events emitted in correct order
**Size:** L
**Dependencies:** TASK-040, TASK-042, TASK-046, TASK-053

#### TASK-055: E2E test: Failure and retry cycle
**Description:** Failure/retry path with `max_retries: 2`. Task fails verification repeatedly until it exhausts retries and moves to `failed/`.
**Files:** `test/e2e/failure-retry.test.ts`
**Acceptance Criteria:**
- Task retries correct number of times
- `retryCount` increments correctly in frontmatter
- Stale branches cleaned up between retries
- Task eventually moves to `failed/` when retries exhausted
- All domain events emitted correctly
**Size:** M
**Dependencies:** TASK-040, TASK-053

#### TASK-056: E2E test: Crash recovery
**Description:** Simulate crash by placing task in `active/` with stale `claimed_at`. Start orchestrator, verify recovery runs and task is re-processed normally.
**Files:** `test/e2e/crash-recovery.test.ts`
**Acceptance Criteria:**
- Orphaned task in `active/` detected on startup
- Task moved back to `pending/`
- Stale branch deleted
- Task then processed normally in next loop iteration
- Recovery commits created with appropriate messages
**Size:** M
**Dependencies:** TASK-037, TASK-040, TASK-053

#### TASK-057: E2E test: Full loop with real Claude (manual) `[SH]`
**Description:** Same cycle as TASK-054 but with real `claude` CLI. Uses a trivial task. Requires `ANTHROPIC_API_KEY`. Tagged `@manual`, `@slow`, `@costs-money`. Skipped in CI.
**Files:** `test/e2e/full-loop-real.test.ts`
**Acceptance Criteria:**
- Same cycle as happy path E2E but with real Claude CLI
- Trivial task: "Create a file `hello.txt` with contents 'Hello from Ralph'"
- Verifies Claude actually creates the file
- Verifies task reaches `review/`
- Requires `ANTHROPIC_API_KEY` in environment
**Size:** L
**Dependencies:** All modules

---

> **GATE 5: E2E with Mock** -- `bun test test/e2e/` passes (excluding `@manual` tagged tests). Full lifecycle from task creation to approval works without real Claude. **Required before deployment.**

---

## Epic 8: Deployment

### Description
Docker and systemd deployment adapters for running Ralph on a VPS.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-058 | Create Dockerfile | M | TASK-040 | 6 |
| TASK-059 | Create docker-compose.yml | S | TASK-058 | 6 |
| TASK-060 | Create systemd service file `[SH]` | S | TASK-040 | 6 |
| TASK-061 | Create VPS provisioning notes | S | TASK-058, TASK-059, TASK-060 | 6 |

#### TASK-058: Create Dockerfile
**Description:** Create a Dockerfile based on `node:20-slim`. Install git, bun, `claude` CLI. Entry point: `bun run src/cli.ts start`. Include `HEALTHCHECK` that reads `.ralph/heartbeat.json`.
**Files:** `docker/Dockerfile`, `docker/.dockerignore`
**Acceptance Criteria:**
- `docker build` succeeds
- Image contains: node, bun, git, claude CLI
- Entry point runs the orchestrator
- HEALTHCHECK works (reads heartbeat, checks timestamp)
- Image size < 500MB
- `.dockerignore` excludes: `node_modules`, `.git`, `test/`, `.ralph/traces/`
**Size:** M
**Dependencies:** TASK-040

#### TASK-059: Create docker-compose.yml
**Description:** Create `docker-compose.yml` for easy deployment. Mounts repo as volume, loads `.env` for secrets, restart policy `unless-stopped`.
**Files:** `docker/docker-compose.yml`
**Acceptance Criteria:**
- `docker compose up` starts the orchestrator
- `.env` loaded for secrets
- Restart policy is `unless-stopped`
- Volume mount for git repo access
**Size:** S
**Dependencies:** TASK-058

#### TASK-060: Create systemd service file `[SH]`
**Description:** Create `ralph.service` for bare VPS deployment. Runs as dedicated `ralph` user. Auto-restarts on failure.
**Files:** `systemd/ralph.service`, `systemd/ralph-logrotate.conf`
**Acceptance Criteria:**
- Valid service file (`systemd-analyze verify`)
- Runs as non-root user
- Auto-restarts on failure
- Environment loaded from `/etc/ralph/env`
- Logrotate config handles log output
**Size:** S
**Dependencies:** TASK-040

#### TASK-061: Create VPS provisioning notes
**Description:** Minimal provisioning guide (documentation, not automation) for Hetzner CX22 setup. Covers both Docker and systemd paths.
**Files:** `docker/DEPLOY.md`
**Acceptance Criteria:**
- Step-by-step instructions for Hetzner CX22 setup
- Covers both Docker and systemd deployment paths
- Includes `.env` template with required variables
- Includes verification steps (`ralph doctor`, `systemctl status`)
**Size:** S
**Dependencies:** TASK-058, TASK-059, TASK-060

---

## Epic 9: Claude Code Skills `[SH]`

### Description
Thin presentation wrappers that shell out to the `ralph` CLI. Skills never reimplement core logic. This entire epic is should-have for V1.

### Tasks
| ID | Task | Size | Deps | Phase |
|----|------|------|------|-------|
| TASK-062 | Create ralph-task skill `[SH]` | S | TASK-042, TASK-050 | 6 |
| TASK-063 | Create ralph-status skill `[SH]` | S | TASK-048, TASK-050 | 6 |
| TASK-064 | Create ralph-review skill `[SH]` | S | TASK-046, TASK-050 | 6 |
| TASK-065 | Create ralph-list skill `[SH]` | S | TASK-044, TASK-050 | 6 |

#### TASK-062: Create ralph-task skill `[SH]`
**Description:** Create the `/ralph-task` Claude Code skill. Guides user through task creation, shells out to `ralph task create --json`.
**Files:** `skills/ralph-task.md`
**Acceptance Criteria:**
- Skill file follows Claude Code skill format
- Prompts user for task details
- Shells out to `ralph task create` with appropriate flags
- Displays result in human-friendly format
**Size:** S
**Dependencies:** TASK-042, TASK-050

#### TASK-063: Create ralph-status skill `[SH]`
**Description:** Create the `/ralph-status` Claude Code skill. Shells out to `ralph status --format json`, presents human-friendly summary.
**Files:** `skills/ralph-status.md`
**Acceptance Criteria:**
- Shells out to `ralph status --format json`
- Presents status in readable format
- Shows queue counts, active task, health
**Size:** S
**Dependencies:** TASK-048, TASK-050

#### TASK-064: Create ralph-review skill `[SH]`
**Description:** Create the `/ralph-review` Claude Code skill. Lists reviewable tasks, shows diff, prompts for approve/reject.
**Files:** `skills/ralph-review.md`
**Acceptance Criteria:**
- Lists reviewable tasks
- Shows diff for selected task
- Prompts for approve/reject
- Supports optional review comment
**Size:** S
**Dependencies:** TASK-046, TASK-050

#### TASK-065: Create ralph-list skill `[SH]`
**Description:** Create the `/ralph-list` Claude Code skill. Shells out to `ralph task list --format json`, displays formatted table.
**Files:** `skills/ralph-list.md`
**Acceptance Criteria:**
- Shells out to `ralph task list --format json`
- Displays tasks in readable table format
- Supports optional status filter
**Size:** S
**Dependencies:** TASK-044, TASK-050

---

> **GATE 6: Real Claude Verified** -- A human runs TASK-057 locally, observes the full cycle with real `claude` CLI, and confirms the task reaches `review/` with correct work product. This is a manual gate.

---

## Cross-Reference Table

| Unified ID | Architect ID | Test Engineer ID | Title |
|------------|-------------|-----------------|-------|
| TASK-001 | E1-T1 | -- | Initialize package.json and install dependencies |
| TASK-002 | E1-T2 | -- | Configure TypeScript and Bun |
| TASK-003 | E1-T3 | -- | Create directory structure and placeholder files |
| TASK-004 | E1-T4 | -- | Set up .ralph/config.json with consensus schema |
| TASK-005 | E2-T1 | -- | Define core types |
| TASK-006 | E2-T7 | -- | Define error types |
| TASK-007 | E2-T2 | -- | Implement task file parser and serializer |
| TASK-008 | -- | T-U1 | Test: Task file parse/serialize |
| TASK-009 | E2-T3 | -- | Implement state machine |
| TASK-010 | -- | T-U2 | Test: State machine transitions |
| TASK-011 | E2-T4 | -- | Implement task queue / picker |
| TASK-012 | -- | T-U3 | Test: Task queue selection |
| TASK-013 | E2-T5 | -- | Implement prompt builder |
| TASK-014 | -- | T-U4 | Test: Prompt builder |
| TASK-015 | E2-T6 | -- | Implement budget enforcement |
| TASK-016 | -- | T-U5 | Test: Budget predicates |
| TASK-017 | -- | -- | Implement consistency checks |
| TASK-018 | -- | T-U6 | Test: Consistency checks |
| TASK-019 | E7-T1 | -- | Create default.md template |
| TASK-020 | E7-T2 | -- | Create bugfix.md template |
| TASK-021 | E7-T3 | -- | Create feature.md template |
| TASK-022 | E7-T4 | -- | Create ralph-system.md system prompt |
| TASK-023 | E3-T1 | -- | Define all port interfaces |
| TASK-024 | E4-T1 | -- | Implement FsTaskRepository |
| TASK-025 | -- | T-I1 | Test: Filesystem task repository |
| TASK-026 | E4-T2 | -- | Implement GitSourceControl |
| TASK-027 | -- | T-I2 | Test: Git source control |
| TASK-028 | E4-T3 | -- | Implement ShellVerifier |
| TASK-029 | -- | T-I4 | Test: Shell verifier |
| TASK-030 | E4-T4 | -- | Implement ClaudeCliExecutor |
| TASK-031 | -- | T-I3 | Test: Claude CLI executor |
| TASK-032 | E4-T5 | -- | Implement CompositeObservability and child adapters |
| TASK-033 | -- | T-I5 | Test: Composite observability |
| TASK-034 | E4-T6 | -- | Implement mock adapters for testing |
| TASK-035 | E5-T1 | -- | Implement config loader |
| TASK-036 | -- | T-O3 | Test: Config loading |
| TASK-037 | E5-T2 | -- | Implement crash recovery |
| TASK-038 | -- | T-O2 | Test: Crash recovery |
| TASK-039 | E5-T3 | -- | Implement shutdown handler |
| TASK-040 | E5-T4 | -- | Implement main orchestrator loop |
| TASK-041 | -- | T-O1 | Test: Orchestrator loop (full cycle) |
| TASK-042 | E6-T1 | -- | Implement create-task command |
| TASK-043 | -- | T-C1 | Test: Create task |
| TASK-044 | E6-T2 | -- | Implement list-tasks command |
| TASK-045 | -- | T-C3 | Test: List tasks |
| TASK-046 | E6-T3 | -- | Implement review-task command |
| TASK-047 | -- | T-C2 | Test: Review task |
| TASK-048 | E6-T4 | -- | Implement status command |
| TASK-049 | E6-T5 | -- | Implement output formatting |
| TASK-050 | E6-T6 | -- | Implement CLI entry point and arg parsing |
| TASK-051 | E6-T7 | -- | Implement doctor command |
| TASK-052 | -- | T-D1 | Test: Doctor command |
| TASK-053 | E10-T1 | -- | Create mock Claude executor for E2E tests |
| TASK-054 | E10-T2 | T-E1 | E2E test: Happy path full cycle |
| TASK-055 | E10-T3 | -- | E2E test: Failure and retry cycle |
| TASK-056 | E10-T4 | T-E3 | E2E test: Crash recovery |
| TASK-057 | -- | T-E2 | E2E test: Full loop with real Claude (manual) |
| TASK-058 | E8-T1 | -- | Create Dockerfile |
| TASK-059 | E8-T2 | -- | Create docker-compose.yml |
| TASK-060 | E8-T3 | -- | Create systemd service file |
| TASK-061 | E8-T4 | -- | Create VPS provisioning notes |
| TASK-062 | E9-T1 | -- | Create ralph-task skill |
| TASK-063 | E9-T2 | -- | Create ralph-status skill |
| TASK-064 | E9-T3 | -- | Create ralph-review skill |
| TASK-065 | E9-T4 | -- | Create ralph-list skill |

---

## Dependency Graph & Critical Path

### Critical Path (minimum time to V1)

The longest sequential chain that determines minimum time to delivery:

```
TASK-001 -> TASK-002 -> TASK-005 -> TASK-007 -> TASK-024 -> TASK-040 -> TASK-054
  (setup)    (tsconfig)   (types)    (parser)    (fs-repo)   (orch loop)  (E2E)
     S          S            M          M            M            L          L
```

**Critical path estimate:** S + S + M + M + M + L + L = ~5 working days of sequential work.

### Parallelization Opportunities

```
Phase 1 (can run in parallel):
  ├── TASK-001 -> TASK-002 -> TASK-003 -> TASK-004  (project setup, sequential)
  ├── TASK-019, TASK-020, TASK-021, TASK-022         (templates, fully parallel, no deps)
  └── After TASK-005:
      ├── TASK-006 (errors)
      ├── TASK-007 -> TASK-008 (task-file + test)
      ├── TASK-009 -> TASK-010 (state machine + test) [needs TASK-006]
      ├── TASK-011 -> TASK-012 (queue + test)
      ├── TASK-013 -> TASK-014 (prompt builder + test)
      ├── TASK-015 -> TASK-016 (budget + test)
      └── TASK-017 -> TASK-018 (consistency + test)

Phase 2 (can run in parallel after TASK-023):
  ├── TASK-024 -> TASK-025 (fs-task-repo + test)
  ├── TASK-026 -> TASK-027 (git + test)
  ├── TASK-028 -> TASK-029 (shell verifier + test)
  ├── TASK-030 -> TASK-031 (claude executor + test)
  ├── TASK-032 -> TASK-033 (observability + test)
  └── TASK-034 (mock adapters)

Phase 3 (partial parallelism):
  ├── TASK-035 -> TASK-036 (config + test)
  ├── TASK-037 -> TASK-038 (recovery + test)
  ├── TASK-039 (shutdown)
  └── TASK-040 -> TASK-041 (loop + test) [waits on all above]

Phase 4 (can run in parallel after Phase 3):
  ├── TASK-042 -> TASK-043 (create task + test)
  ├── TASK-044 -> TASK-045 (list tasks + test)
  ├── TASK-046 -> TASK-047 (review task + test)
  ├── TASK-048 (status)
  ├── TASK-049 (formatting)
  ├── TASK-051 -> TASK-052 (doctor + test)
  └── TASK-050 (CLI entry, waits on all client commands)

Phase 5 (after Phase 4):
  ├── TASK-053 (E2E mock executor)
  ├── TASK-054 (happy path E2E)
  ├── TASK-055 (failure retry E2E)
  └── TASK-056 (crash recovery E2E)

Phase 6 (after Phase 5):
  ├── TASK-058 -> TASK-059 (Docker)
  ├── TASK-060 (systemd, parallel with Docker)
  ├── TASK-061 (provisioning notes)
  ├── TASK-062, TASK-063, TASK-064, TASK-065 (skills, all parallel)
  └── TASK-057 (manual E2E with real Claude)
```

### Size Summary

| Size | Count |
|------|-------|
| S | 22 |
| M | 25 |
| L | 6 |
| Implied (TASK-017) | 1 |
| **Total** | **65 tasks** |

### CI Pipeline (Gate Verification)

```
bun test test/core/          # Gate 1: ~1s
bun test test/adapters/       # Gate 2: ~5s
bun test test/orchestrator/   # Gate 3: ~3s
bun test test/client/         # Gate 4: ~3s
bun test test/doctor.test.ts  # Gate 4 cont.
bun test test/e2e/            # Gate 5: ~10s (excludes @manual)
```

Total automated suite target: <30 seconds.
