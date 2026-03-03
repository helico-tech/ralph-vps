# Ralph VPS - Epic & Task Breakdown

> Architecture B: Typed Orchestrator
> Derived from CONSENSUS.md + DEEPDIVE-CONSENSUS.md (2026-03-03)

---

## Epic 1: Project Setup

Scaffolding, tooling configuration, and directory structure. Everything needed before writing a single line of domain logic.

### E1-T1: Initialize package.json and install dependencies

- **Description:** Create `package.json` with Bun as the runtime. Install dev dependencies: `typescript`, `@types/bun`. Set up `scripts` for `dev`, `build`, `test`, `check` (type-check only). The project is a single binary with two modes (`ralph start` for orchestrator, `ralph task|status|review` for client).
- **Files to create:** `package.json`
- **Acceptance criteria:**
  - `bun install` succeeds with zero errors
  - `bun run check` runs `tsc --noEmit` successfully
  - `bun run test` runs `bun test` successfully (even if zero tests)
  - `bin` entry points to `src/cli.ts`
- **Size:** S
- **Dependencies:** None

### E1-T2: Configure TypeScript and Bun

- **Description:** Create `tsconfig.json` with strict mode, path aliases if needed. Create `bunfig.toml` with test configuration. Target should be modern (ES2022+). Module resolution should be `bundler` for Bun compatibility.
- **Files to create:** `tsconfig.json`, `bunfig.toml`
- **Acceptance criteria:**
  - `bun run check` passes on an empty `src/cli.ts` stub
  - `bun test` runs with no errors (empty test suite)
  - Strict mode enabled (`strict: true`)
- **Size:** S
- **Dependencies:** E1-T1

### E1-T3: Create directory structure and placeholder files

- **Description:** Create the canonical directory structure from the deep dive consensus. Every directory gets a placeholder or minimal file so the structure is visible in git. Create the `.ralph/` runtime directories with appropriate `.gitkeep` files. Create `.ralph/.gitignore` for `heartbeat.json` and `traces/`.
- **Files to create:**
  - `src/core/` (empty dir)
  - `src/ports/` (empty dir)
  - `src/adapters/` (empty dir)
  - `src/adapters/mock/` (empty dir)
  - `src/orchestrator/` (empty dir)
  - `src/client/` (empty dir)
  - `src/cli.ts` (minimal stub: `console.log("ralph")`)
  - `src/doctor.ts` (minimal stub)
  - `templates/` (empty dir)
  - `docker/` (empty dir)
  - `systemd/` (empty dir)
  - `skills/` (empty dir)
  - `test/core/` (empty dir)
  - `test/adapters/` (empty dir)
  - `test/orchestrator/` (empty dir)
  - `test/client/` (empty dir)
  - `.ralph/config.json` (minimal valid config)
  - `.ralph/tasks/pending/` `.ralph/tasks/active/` `.ralph/tasks/review/` `.ralph/tasks/done/` `.ralph/tasks/failed/` (with `.gitkeep`)
  - `.ralph/.gitignore` (heartbeat.json, traces/)
- **Acceptance criteria:**
  - All directories exist and are tracked in git
  - `.ralph/config.json` contains a valid skeleton config matching the consensus schema
  - `.ralph/.gitignore` excludes `heartbeat.json` and `traces/`
  - `bun run check` still passes
- **Size:** S
- **Dependencies:** E1-T2

### E1-T4: Set up .ralph/config.json with consensus schema

- **Description:** Create the canonical `.ralph/config.json` matching the schema from the deep dive consensus. Include all sections: `version`, `project`, `verify`, `task_defaults`, `exit_criteria`, `git`, `execution`. Use sensible defaults for a generic project.
- **Files to create/modify:** `.ralph/config.json`
- **Acceptance criteria:**
  - Config matches the schema defined in DEEPDIVE-CONSENSUS.md Conflict 9
  - All fields present with documented defaults
  - `version: 1` is set
- **Size:** S
- **Dependencies:** E1-T3

---

## Epic 2: Pure Core Domain

All pure functions, zero I/O. This is the heart of the system. Every function here is deterministic, trivially testable, and has no external dependencies. The order follows the deep dive confidence ladder Phase 1.

### E2-T1: Define core types

- **Description:** Create all core type definitions: `Task`, `TaskStatus`, `TaskType`, `ExecutionResult`, `ExecutionPlan`, `DomainEvent`, `RalphConfig`, `PromptTemplate`, `VerificationResult`, and supporting types. `TaskStatus` is a union of `"pending" | "active" | "review" | "done" | "failed"`. `TaskType` is `"bugfix" | "feature" | "refactor" | "research" | "test" | "chore"`. Include all frontmatter fields from the canonical task file format.
- **Files to create:** `src/core/types.ts`
- **Acceptance criteria:**
  - All types from the consensus documents are defined
  - `bun run check` passes (types compile)
  - No I/O imports
  - `DomainEvent` is a discriminated union covering: `task.claimed`, `task.completed`, `task.failed`, `task.retried`, `execution.started`, `execution.completed`, `verification.started`, `verification.completed`, `budget.exceeded`, `orchestrator.started`, `orchestrator.stopped`
- **Size:** M
- **Dependencies:** E1-T2

### E2-T2: Implement task file parser and serializer

- **Description:** Implement `parseTaskFile(content: string): Task` and `serializeTaskFile(task: Task): string`. Parses Markdown with YAML frontmatter. Extracts all structured fields from frontmatter, body is the markdown content below the frontmatter. Must handle all frontmatter fields: `id`, `title`, `status`, `type`, `priority`, `created_at`, `author`, `acceptance_criteria`, `files`, `constraints`, `max_retries`, `cost_usd`, `turns`, `duration_s`, `attempt`, `branch`. Roundtrip must be stable: `serializeTaskFile(parseTaskFile(input))` preserves data.
- **Files to create:** `src/core/task-file.ts`, `test/core/task-file.test.ts`
- **Acceptance criteria:**
  - Parses the canonical task file format from DEEPDIVE-CONSENSUS.md
  - Serializes back to valid frontmatter + markdown body
  - Roundtrip stability: parse then serialize preserves all data
  - Handles missing optional fields gracefully (defaults applied)
  - Handles edge cases: empty body, no frontmatter, malformed YAML
  - Tests cover: valid task, minimal task (title only + defaults), missing fields, invalid YAML, empty file
  - Zero I/O imports - operates on strings only
- **Size:** M
- **Dependencies:** E2-T1

### E2-T3: Implement state machine

- **Description:** Implement `transitionTask(task: Task, targetStatus: TaskStatus): Task` as a pure function. Enforces valid state transitions: `pending -> active`, `active -> review`, `active -> pending` (retry), `active -> failed`, `review -> done`, `review -> pending` (rejected). All other transitions throw `TaskError`. Returns a new Task object with updated status (and `claimed_at` for active, `completed_at` for done/failed). Also implement `getValidTransitions(status: TaskStatus): TaskStatus[]`.
- **Files to create:** `src/core/state-machine.ts`, `test/core/state-machine.test.ts`
- **Acceptance criteria:**
  - All valid transitions work and return updated Task
  - All invalid transitions throw `TaskError` with descriptive message
  - `getValidTransitions()` returns correct targets for each status
  - Tests cover every valid transition and every invalid transition
  - Terminal states (`done`, `failed`) have no valid transitions out
  - Zero I/O imports
- **Size:** S
- **Dependencies:** E2-T1, E2-T7

### E2-T4: Implement task queue / picker

- **Description:** Implement `pickNextTask(tasks: Task[]): Task | null`. Pure function that selects the highest-priority pending task. Sorting: primary by `priority` (higher number = higher priority), secondary by `created_at` (oldest first). Filters to only `pending` status. Returns `null` if no pending tasks.
- **Files to create:** `src/core/queue.ts`, `test/core/queue.test.ts`
- **Acceptance criteria:**
  - Returns highest priority task
  - Breaks ties by `created_at` (oldest wins)
  - Returns `null` for empty array or no pending tasks
  - Ignores non-pending tasks
  - Tests cover: single task, multiple priorities, tie-breaking, empty list, no pending tasks, mixed statuses
  - Zero I/O imports
- **Size:** S
- **Dependencies:** E2-T1

### E2-T5: Implement prompt builder

- **Description:** Implement `buildPrompt(task: Task, template: string): string`. Pure function that interpolates task data into a template string. Template variables use `{{variable}}` syntax. Supported variables: `{{title}}`, `{{description}}`, `{{type}}`, `{{acceptance_criteria}}`, `{{files}}`, `{{constraints}}`, `{{id}}`. If `acceptance_criteria` is missing, inject fallback: "The described change works correctly and all tests pass." `{{files}}` renders as a bulleted list or "No specific files targeted." `{{constraints}}` renders as a bulleted list or empty. Also implement `buildExecutionPlan(task: Task, template: string, config: RalphConfig): ExecutionPlan` that wraps `buildPrompt` and adds model, maxTurns, budgetUsd, timeoutMs, systemPromptFile from config.
- **Files to create:** `src/core/prompt-builder.ts`, `test/core/prompt-builder.test.ts`
- **Acceptance criteria:**
  - All template variables are interpolated correctly
  - Missing `acceptance_criteria` gets the fallback
  - Missing `files` renders as "No specific files targeted."
  - Missing `constraints` renders as empty (no placeholder)
  - `buildExecutionPlan` correctly merges task + template + config
  - Tests include snapshot tests for each template (default, bugfix, feature) once templates exist
  - Zero I/O imports
- **Size:** M
- **Dependencies:** E2-T1

### E2-T6: Implement budget enforcement

- **Description:** Implement `canClaimTask(costs: { today: number; total: number }, limits: { dailyUsd: number; totalUsd: number; perTaskUsd: number }, taskBudget: number): boolean`. Pure predicate. Returns `false` if daily limit would be exceeded, total limit would be exceeded, or per-task budget exceeds the configured max. Also implement `calculateCosts(tasks: Task[]): { today: number; total: number }` that sums `cost_usd` from completed tasks (done + failed with cost data).
- **Files to create:** `src/core/budget.ts`, `test/core/budget.test.ts`
- **Acceptance criteria:**
  - `canClaimTask` returns `false` when any limit would be exceeded
  - `canClaimTask` returns `true` when all limits have headroom
  - `calculateCosts` correctly sums costs from done and failed tasks
  - `calculateCosts` handles tasks without `cost_usd` (treats as 0)
  - `calculateCosts` correctly identifies "today" based on a date parameter (not `Date.now()` -- keep it pure)
  - Tests cover: under budget, at limit, over limit, no cost data, mixed states
  - Zero I/O imports
- **Size:** S
- **Dependencies:** E2-T1

### E2-T7: Define error types

- **Description:** Define custom error classes: `TaskError` (invalid transitions, parse errors), `GitError` (git operation failures), `ExecutionError` (Claude CLI failures), `ConfigError` (invalid configuration), `VerificationError` (test/build/lint failures). Each error should have a `code` string for programmatic handling and a human-readable `message`.
- **Files to create:** `src/core/errors.ts`
- **Acceptance criteria:**
  - All error types extend `Error`
  - Each has a `code` property (e.g., `"INVALID_TRANSITION"`, `"GIT_PUSH_FAILED"`)
  - All error classes compile and are importable
  - Zero I/O imports
- **Size:** S
- **Dependencies:** E1-T2

---

## Epic 3: Port Interfaces

Define the 5 port interfaces. These are TypeScript interfaces only -- no implementations. They establish the contract between the pure core and the I/O world.

### E3-T1: Define all port interfaces

- **Description:** Define the 5 port interfaces as specified in the deep dive consensus. Each port is a separate file. These are interfaces only, no implementations. The interfaces must be narrow -- only the methods needed by the core and orchestrator.
- **Files to create:**
  - `src/ports/task-repository.ts` -- `TaskRepository`: `list(status?: TaskStatus): Promise<Task[]>`, `read(id: string): Promise<Task>`, `write(task: Task): Promise<void>`, `exists(id: string): Promise<boolean>`, `getPath(task: Task): string`
  - `src/ports/source-control.ts` -- `SourceControl`: `pull(options?: { ffOnly?: boolean }): Promise<void>`, `commit(message: string): Promise<string>`, `push(): Promise<boolean>`, `pushBranch(branch: string): Promise<boolean>`, `createBranch(name: string): Promise<void>`, `checkout(branch: string): Promise<void>`, `stageFiles(paths: string[]): Promise<void>`, `moveFile(from: string, to: string): Promise<void>`, `fetch(): Promise<void>`, `diff(spec: string): Promise<string>`, `merge(branch: string, options?: { ffOnly?: boolean }): Promise<void>`, `deleteBranch(name: string, options?: { remote?: boolean }): Promise<void>`, `log(options?: { limit?: number }): Promise<GitLogEntry[]>`
  - `src/ports/agent-executor.ts` -- `AgentExecutor`: `run(plan: ExecutionPlan): Promise<ExecutionResult>`
  - `src/ports/verifier.ts` -- `Verifier`: `runTests(): Promise<VerificationResult>`, `runBuild(): Promise<VerificationResult>`, `runLint(): Promise<VerificationResult>`
  - `src/ports/observability.ts` -- `Observability`: `emit(event: DomainEvent): void`
- **Acceptance criteria:**
  - All 5 interfaces defined and compile
  - No implementations, only type signatures
  - Interfaces use types from `core/types.ts`
  - `bun run check` passes
- **Size:** S
- **Dependencies:** E2-T1

---

## Epic 4: Adapters

Real implementations of the port interfaces. All I/O lives here. Each adapter wraps an external dependency (filesystem, git CLI, Claude CLI, shell).

### E4-T1: Implement FsTaskRepository

- **Description:** Implement `TaskRepository` backed by the filesystem. Task files live in `.ralph/tasks/<status>/`. `list()` scans the appropriate directory (or all status directories if no filter). `read()` finds and parses a task file by ID. `write()` serializes and writes a task file to its current status directory. `getPath()` returns the filesystem path for a task. Uses `parseTaskFile` and `serializeTaskFile` from core.
- **Files to create:** `src/adapters/fs-task-repository.ts`, `test/adapters/fs-task-repository.test.ts`
- **Acceptance criteria:**
  - `list()` returns all tasks from disk, optionally filtered by status
  - `read()` finds a task by ID across all status directories
  - `write()` creates/updates a task file in the correct status directory
  - `exists()` checks if a task file exists
  - `getPath()` returns the correct path based on task status
  - Tests use real filesystem with temp directories
  - Tests cover: write and read back, list by status, list all, task not found, write over existing
- **Size:** M
- **Dependencies:** E2-T2, E3-T1

### E4-T2: Implement GitSourceControl

- **Description:** Implement `SourceControl` by shelling out to `git` via `Bun.spawn`. Each method maps to one or more git CLI commands. `pull` does `git fetch + git merge --ff-only`. `commit` does `git add` (already staged) + `git commit -m`. `push` does `git push origin`. `createBranch` does `git checkout -b`. `moveFile` does `git mv`. All methods propagate errors as `GitError`.
- **Files to create:** `src/adapters/git-source-control.ts`, `test/adapters/git-source-control.test.ts`
- **Acceptance criteria:**
  - All `SourceControl` interface methods implemented
  - Each method shells out to git CLI correctly
  - Errors are caught and wrapped in `GitError`
  - Tests use real git with temporary bare repos (init a temp repo, clone it, run operations, verify results)
  - Tests cover: pull, commit, push, branch creation, checkout, moveFile, push failure handling
- **Size:** L
- **Dependencies:** E2-T7, E3-T1

### E4-T3: Implement ShellVerifier

- **Description:** Implement `Verifier` that runs shell commands via `Bun.spawn(["sh", "-c", command])`. Commands come from `.ralph/config.json` `verify` section (`test`, `build`, `lint`). Each method runs its respective command and returns a `VerificationResult` with `pass`, `output`, and `duration_ms`. If a command is not configured (empty string or missing), return `{ pass: true, output: "skipped", duration_ms: 0 }`.
- **Files to create:** `src/adapters/shell-verifier.ts`
- **Acceptance criteria:**
  - Runs commands through `sh -c` (handles pipes, quotes, redirects)
  - Returns structured `VerificationResult`
  - Skipped commands return pass with "skipped" output
  - Captures stdout + stderr in output
  - Timeout support (kill process if it takes too long)
  - Does not throw -- always returns a result
- **Size:** M
- **Dependencies:** E2-T1, E3-T1

### E4-T4: Implement ClaudeCliExecutor

- **Description:** Implement `AgentExecutor` that shells out to `claude` CLI. Takes an `ExecutionPlan` and constructs the CLI invocation: `claude -p <prompt> --model <model> --max-turns <n> --output-format json --max-budget-usd <n> --append-system-prompt-file <path>`. Add `--dangerously-skip-permissions` or `--permission-mode` based on config. Parse the JSON output into `ExecutionResult`. Handle timeout via `setTimeout` on the child process.
- **Files to create:** `src/adapters/claude-cli-executor.ts`
- **Acceptance criteria:**
  - Constructs correct CLI arguments from `ExecutionPlan`
  - Parses JSON output into `ExecutionResult`
  - Handles timeout (kills process, returns error result)
  - Handles non-zero exit codes gracefully
  - Handles missing `claude` binary (clear error message)
  - Captures `cost_usd`, `turns`, `duration_s`, `stop_reason` from JSON output
- **Size:** M
- **Dependencies:** E2-T1, E3-T1

### E4-T5: Implement CompositeObservability and child adapters

- **Description:** Implement the observability stack: `CompositeObservabilityAdapter` fans out `emit(event)` to child adapters. Three children: `ConsoleLoggerAdapter` (writes structured log lines to stdout), `TraceWriterAdapter` (appends events to `.ralph/traces/<task-id>.json` and summary to `.ralph/traces/index.jsonl`), `HeartbeatWriterAdapter` (updates `.ralph/heartbeat.json` on every emit with current state, active task, PID, uptime).
- **Files to create:**
  - `src/adapters/composite-observability.ts`
  - `src/adapters/console-logger.ts`
  - `src/adapters/trace-writer.ts`
  - `src/adapters/heartbeat-writer.ts`
- **Acceptance criteria:**
  - `CompositeObservabilityAdapter` calls `emit` on all children
  - `ConsoleLoggerAdapter` writes one structured JSON line per event to stdout
  - `TraceWriterAdapter` writes per-task trace files and appends to `index.jsonl`
  - `HeartbeatWriterAdapter` writes/updates `.ralph/heartbeat.json` with `state`, `active_task`, `pid`, `uptime`, `last_event_at`
  - If a child adapter throws, other children still receive the event (error isolation)
- **Size:** M
- **Dependencies:** E2-T1, E3-T1

### E4-T6: Implement mock adapters for testing

- **Description:** Create test doubles for the three I/O-heavy ports: `MockExecutor` (returns configurable `ExecutionResult`), `MockSourceControl` (records method calls, returns configurable results), `MockObservability` (records emitted events). These are used by orchestrator and client tests to avoid real git/Claude/filesystem calls.
- **Files to create:**
  - `src/adapters/mock/mock-executor.ts`
  - `src/adapters/mock/mock-source-control.ts`
  - `src/adapters/mock/mock-observability.ts`
- **Acceptance criteria:**
  - Each mock implements its respective port interface
  - Each mock records all method calls for assertion
  - `MockExecutor` supports configurable success/failure results
  - `MockSourceControl` tracks calls and can simulate push failures
  - `MockObservability` captures all emitted events for inspection
  - Mocks are importable and usable in test files
- **Size:** S
- **Dependencies:** E3-T1

---

## Epic 5: Orchestrator

The main loop. Wires adapters to ports, handles startup, recovery, shutdown, and the poll-claim-execute-verify-transition cycle.

### E5-T1: Implement config loader

- **Description:** Implement `loadConfig(configPath: string): RalphConfig`. Reads `.ralph/config.json`, validates all required fields, applies defaults for missing optional fields, and returns a typed `RalphConfig` object. Env vars override config values: `ANTHROPIC_API_KEY`, `TASK_REPO_URL`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`. Throws `ConfigError` for invalid configs.
- **Files to create:** `src/orchestrator/config.ts`, `test/orchestrator/config.test.ts`
- **Acceptance criteria:**
  - Loads and parses `.ralph/config.json`
  - Validates required fields (`version`, `verify.test`)
  - Applies defaults for optional fields
  - Env var overrides work
  - Invalid config throws `ConfigError` with specific messages
  - Tests cover: valid config, missing required fields, env overrides, corrupt JSON
- **Size:** S
- **Dependencies:** E2-T1, E2-T7

### E5-T2: Implement crash recovery

- **Description:** Implement `recoverOrphanedTasks(repo: TaskRepository, git: SourceControl, obs: Observability): Promise<void>`. On startup, scans `active/` directory. For any tasks found in `active/` (meaning the previous run crashed mid-execution): move them back to `pending/` with `retryCount++`, delete any stale `ralph/<task-id>` branches, commit and push the recovery. Emits `task.retried` events.
- **Files to create:** `src/orchestrator/recovery.ts`, `test/orchestrator/recovery.test.ts`
- **Acceptance criteria:**
  - Finds all tasks in `active/` status
  - Moves each back to `pending/` with incremented `retryCount`
  - If `retryCount >= max_retries`, moves to `failed/` instead
  - Deletes stale branches for recovered tasks
  - Commits recovery changes
  - Emits appropriate domain events
  - Tests use mock adapters to verify the correct sequence of operations
  - Tests cover: no orphans, one orphan, multiple orphans, orphan exceeding max retries
- **Size:** M
- **Dependencies:** E2-T3, E3-T1, E4-T6

### E5-T3: Implement shutdown handler

- **Description:** Implement graceful shutdown on `SIGTERM` and `SIGINT`. When a signal is received: (1) set a `shuttingDown` flag that the main loop checks, (2) if a task is currently executing, wait for it to finish (do NOT kill mid-execution), (3) once the current cycle completes, exit cleanly. Emit `orchestrator.stopped` event.
- **Files to create:** `src/orchestrator/shutdown.ts`
- **Acceptance criteria:**
  - Registers handlers for `SIGTERM` and `SIGINT`
  - Sets a flag that the main loop can check
  - Provides `isShuttingDown(): boolean` and `waitForShutdown(): Promise<void>`
  - Emits `orchestrator.stopped` event before exit
  - Does not kill active task execution
- **Size:** S
- **Dependencies:** E2-T1, E3-T1

### E5-T4: Implement main orchestrator loop

- **Description:** Implement the core orchestrator loop as described in the deep dive consensus flow diagram. The loop: (1) startup: `loadConfig`, `runDoctor`, `recoverOrphanedTasks`, wire adapters; (2) poll: `git checkout main`, `git fetch + merge --ff-only`, `canClaimTask`, `pickNextTask`; (3) claim: `git mv pending -> active`, update frontmatter, commit, push; (4) execute: `createBranch`, `buildExecutionPlan`, `executor.run`; (5) verify: run tests/build/lint; (6) transition: if verified -> push branch + move to review; if failed + retries left -> move to pending; if failed permanently -> move to failed. Emit domain events at each step. Check `isShuttingDown()` between cycles.
- **Files to create:** `src/orchestrator/loop.ts`, `test/orchestrator/loop.test.ts`
- **Acceptance criteria:**
  - Full poll-claim-execute-verify-transition cycle works end-to-end with mock executor
  - Claim failure (push rejected) causes retry from poll step
  - Verification runs for both `end_turn` and `max_turns` stop reasons
  - Verification is skipped for `refusal`, `timeout`, `error` stop reasons
  - Failed tasks with retries left go back to `pending/` with incremented count
  - Failed tasks at max retries go to `failed/`
  - Verified tasks go to `review/` and branch is pushed
  - Stale branches are cleaned up before creating new ones on retry
  - Shutdown flag is checked between cycles
  - Sleep 30s when no task is found
  - Domain events emitted at each stage
  - Tests use mock adapters to verify the full cycle
  - Tests cover: happy path, verification failure with retry, permanent failure, no tasks available, push conflict on claim, shutdown mid-cycle
- **Size:** L
- **Dependencies:** E5-T1, E5-T2, E5-T3, E4-T1, E4-T2, E4-T3, E4-T4, E4-T5, E2-T4, E2-T5, E2-T6

---

## Epic 6: Client CLI

User-facing commands for creating tasks, reviewing results, and checking system status. All commands use the same core libraries (task-file parser, types) as the orchestrator.

### E6-T1: Implement create-task command

- **Description:** Implement `createTask(options: CreateTaskOptions): Promise<Task>`. Takes at minimum a `title`. Generates `id` (timestamp-based or short hash), sets defaults (`status: pending`, `priority: 100`, `type: "feature"`, `created_at: now`, `author` from git config). Optionally accepts `type`, `priority`, `acceptance_criteria`, `files`, `constraints`. Serializes to task file, writes to `.ralph/tasks/pending/`, stages, commits, and pushes.
- **Files to create:** `src/client/create-task.ts`, `test/client/create-task.test.ts`
- **Acceptance criteria:**
  - Creates a valid task file in `pending/` directory
  - Auto-generates `id`, `status`, `created_at`, `author`
  - Applies defaults for optional fields
  - Commits with message `ralph(<id>): created`
  - Pushes to remote
  - Returns the created `Task` object
  - Tests verify file contents, frontmatter, defaults, and git operations (using mocks for git)
- **Size:** M
- **Dependencies:** E2-T2, E3-T1, E4-T6

### E6-T2: Implement list-tasks command

- **Description:** Implement `listTasks(options?: { status?: TaskStatus }): Promise<Task[]>`. Reads task files from `.ralph/tasks/`, optionally filtered by status. Returns parsed `Task` objects sorted by status group (active first, then pending by priority, then review, then done/failed by date).
- **Files to create:** `src/client/list-tasks.ts`
- **Acceptance criteria:**
  - Lists all tasks or filters by status
  - Returns parsed Task objects
  - Sorted sensibly: active > pending (by priority) > review > done/failed (by date)
  - Handles empty directories gracefully
- **Size:** S
- **Dependencies:** E2-T2, E4-T1

### E6-T3: Implement review-task command

- **Description:** Implement `reviewTask(taskId: string, action: "approve" | "reject", comment?: string): Promise<Task>`. For approve: merges the `ralph/<task-id>` branch into main (or the configured main branch), moves task from `review/` to `done/`, deletes the feature branch (local + remote), commits and pushes. For reject: moves task from `review/` back to `pending/` (resetting for re-execution), deletes the feature branch, commits and pushes. Optionally appends a review comment to the task body.
- **Files to create:** `src/client/review-task.ts`, `test/client/review-task.test.ts`
- **Acceptance criteria:**
  - Approve: merges branch, moves to `done/`, cleans up branch
  - Reject: moves to `pending/`, cleans up branch
  - Both actions commit and push
  - Optional comment is appended to task body under `## Review`
  - Errors if task is not in `review/` status
  - Tests use mock git to verify correct sequence of operations
- **Size:** M
- **Dependencies:** E2-T3, E3-T1, E4-T6

### E6-T4: Implement status command

- **Description:** Implement `getStatus(): Promise<StatusReport>`. Returns a summary of the queue: count of tasks per status, currently active task details (if any), last activity timestamp (from git log), and basic health inference (if no commits in >5 minutes during expected active period, warn). No SSH required -- purely git-based.
- **Files to create:** `src/client/status.ts`
- **Acceptance criteria:**
  - Returns counts per status: `{ pending: N, active: N, review: N, done: N, failed: N }`
  - Includes details of currently active task (if any)
  - Includes last activity timestamp from git log
  - Health inference: "healthy" if recent activity, "possibly down" if stale
  - Works with local git data only (after a fetch)
- **Size:** S
- **Dependencies:** E4-T1, E4-T2

### E6-T5: Implement output formatting

- **Description:** Implement output formatters for CLI display. Three modes: `table` (human-readable aligned columns), `json` (machine-readable), `plain` (minimal, pipe-friendly). Each client command uses these formatters. The `table` format should show: id, title (truncated), status, type, priority, created_at. Colors via ANSI codes for status (green=done, yellow=active, red=failed, blue=review, white=pending).
- **Files to create:** `src/client/format.ts`
- **Acceptance criteria:**
  - `formatTable(tasks)` produces aligned columns with ANSI colors
  - `formatJson(data)` produces valid JSON
  - `formatPlain(tasks)` produces minimal tab-separated output
  - `formatStatusReport(report)` formats the status summary
  - Handles empty data gracefully
  - Truncates long titles to fit terminal width
- **Size:** S
- **Dependencies:** E2-T1

### E6-T6: Implement CLI entry point and arg parsing

- **Description:** Implement `src/cli.ts` as the main entry point. Parse arguments to dispatch to subcommands: `ralph start` (orchestrator), `ralph task create [options]`, `ralph task list [--status X]`, `ralph review <task-id> --approve|--reject`, `ralph status`, `ralph doctor`. Use a minimal arg parser (no heavy dependency -- parse `process.argv` directly or use a lightweight lib). Handle `--help`, `--version`, `--format` (table|json|plain) globally. Exit codes: 0 success, 1 error, 2 usage error.
- **Files to create/modify:** `src/cli.ts`
- **Acceptance criteria:**
  - All subcommands dispatch correctly
  - `--help` prints usage for each command
  - `--version` prints version from package.json
  - `--format` flag works globally
  - Invalid commands print usage and exit 2
  - Errors print to stderr and exit 1
  - Works as `bun run src/cli.ts <command>` and as installed binary `ralph <command>`
- **Size:** M
- **Dependencies:** E6-T1, E6-T2, E6-T3, E6-T4, E6-T5, E5-T4

### E6-T7: Implement doctor command

- **Description:** Implement `ralph doctor` as a contract checker that validates the environment and configuration. Checks: (1) git is installed and repo is valid, (2) `.ralph/` directory structure exists, (3) `.ralph/config.json` is valid, (4) `claude` CLI is installed and authenticated (check `claude --version`), (5) verify commands work (`bun test` etc.), (6) git remote is configured and reachable, (7) `.ralph/ralph-system.md` exists, (8) templates directory has at least `default.md`. Output: pass/fail per check with actionable error messages. Used by orchestrator startup (`runDoctor()`) and directly by users.
- **Files to create:** `src/doctor.ts`
- **Acceptance criteria:**
  - All checks run independently (one failure doesn't skip others)
  - Each check outputs pass/fail with actionable message
  - Exit code 0 if all pass, 1 if any fail
  - Usable both programmatically (returns results) and as CLI output
  - Works in both orchestrator context (fail fast) and user context (informational)
- **Size:** M
- **Dependencies:** E5-T1

---

## Epic 7: Prompt Templates & System Prompt

The prompt templates and system prompt that guide Claude's behavior during task execution.

### E7-T1: Create default.md template

- **Description:** Create the default prompt template used when a task has an unknown type or `type: "feature"` with no specialized template. Uses `{{variable}}` interpolation. Should include: task title, description, acceptance criteria, file scope, constraints, and general instructions for making changes, running tests, and committing.
- **Files to create:** `templates/default.md`
- **Acceptance criteria:**
  - Contains all template variables: `{{title}}`, `{{description}}`, `{{acceptance_criteria}}`, `{{files}}`, `{{constraints}}`, `{{id}}`
  - Provides clear instructions for: understanding the task, making changes, running tests, not overstepping scope
  - Works as a sensible fallback for any task type
  - Readable and well-structured
- **Size:** S
- **Dependencies:** None

### E7-T2: Create bugfix.md template

- **Description:** Create the bugfix-specific prompt template. Emphasizes: reproducing the bug first, understanding root cause before fixing, writing a regression test, minimal change surface, verifying the fix doesn't break existing tests.
- **Files to create:** `templates/bugfix.md`
- **Acceptance criteria:**
  - Contains all standard template variables
  - Includes bugfix-specific instructions: reproduce, root cause, minimal fix, regression test
  - Differentiates from default template in workflow guidance
- **Size:** S
- **Dependencies:** None

### E7-T3: Create feature.md template

- **Description:** Create the feature-specific prompt template. Emphasizes: understanding existing patterns before adding code, following project conventions, writing tests for new functionality, keeping scope tight to the described feature.
- **Files to create:** `templates/feature.md`
- **Acceptance criteria:**
  - Contains all standard template variables
  - Includes feature-specific instructions: study patterns, follow conventions, test new code, stay in scope
  - Differentiates from default template in workflow guidance
- **Size:** S
- **Dependencies:** None

### E7-T4: Create ralph-system.md system prompt

- **Description:** Create `.ralph/ralph-system.md` -- the system prompt appended to every Claude invocation via `--append-system-prompt-file`. Contains Ralph behavioral rules: work autonomously, commit with `ralph(<id>): <action>` format, never force push, never `git add -A`, never modify `.ralph/config.json`, report when stuck, stay within task scope, run tests after every change, explicit file staging only. This is separate from CLAUDE.md (project conventions) -- zero overlap per consensus.
- **Files to create:** `.ralph/ralph-system.md`
- **Acceptance criteria:**
  - Covers all behavioral rules from consensus: commit format, no force push, no `git add -A`, scope discipline, test after changes, explicit staging
  - Does NOT duplicate CLAUDE.md content (no build commands, no project architecture)
  - Clear, concise instructions that fit within system prompt context
  - Includes "stuck protocol" -- what to do when blocked
- **Size:** S
- **Dependencies:** None

---

## Epic 8: Deployment

Docker and systemd deployment adapters for running Ralph on a VPS.

### E8-T1: Create Dockerfile

- **Description:** Create a Dockerfile based on `node:20-slim`. Install: `git`, `bun`, `claude` CLI (via npm or direct install). Copy source. Set working directory. Entry point: `bun run src/cli.ts start`. Include `HEALTHCHECK` that reads `.ralph/heartbeat.json` and checks freshness. Use multi-stage build if beneficial for image size.
- **Files to create:** `docker/Dockerfile`, `docker/.dockerignore`
- **Acceptance criteria:**
  - `docker build` succeeds
  - Image contains: node, bun, git, claude CLI
  - Entry point runs the orchestrator
  - HEALTHCHECK works (reads heartbeat, checks timestamp)
  - Image size is reasonable (< 500MB)
  - `.dockerignore` excludes: `node_modules`, `.git`, `test/`, `.ralph/traces/`
- **Size:** M
- **Dependencies:** E5-T4

### E8-T2: Create docker-compose.yml

- **Description:** Create `docker-compose.yml` for easy local and VPS deployment. Mounts: project repo as volume (or clones it), `.env` file for secrets. Defines restart policy (`unless-stopped`). Maps no ports (Ralph doesn't serve HTTP). Defines environment variables from `.env`.
- **Files to create:** `docker/docker-compose.yml`
- **Acceptance criteria:**
  - `docker compose up` starts the orchestrator
  - `.env` file is loaded for `ANTHROPIC_API_KEY` and git config
  - Restart policy is `unless-stopped`
  - Volume mount allows the container to access the git repo
  - `docker compose logs -f` shows orchestrator output
- **Size:** S
- **Dependencies:** E8-T1

### E8-T3: Create systemd service file

- **Description:** Create `ralph.service` for bare VPS deployment (no Docker). Runs as a dedicated `ralph` user. Starts `bun run src/cli.ts start` in the project directory. Restart on failure with 10s delay. Logs to journald. Environment file at `/etc/ralph/env` for secrets.
- **Files to create:** `systemd/ralph.service`, `systemd/ralph-logrotate.conf`
- **Acceptance criteria:**
  - Service file is valid (`systemd-analyze verify ralph.service`)
  - Runs as non-root user
  - Auto-restarts on failure
  - Environment loaded from `/etc/ralph/env`
  - Logrotate config handles log output
- **Size:** S
- **Dependencies:** E5-T4

### E8-T4: Create VPS provisioning notes

- **Description:** Create a minimal provisioning guide (not a script) documenting how to set up a Hetzner CX22 for Ralph. Steps: create server, install dependencies (git, node, bun), create `ralph` user, clone repo, install systemd service or docker, configure `.env`, start service, verify with `ralph doctor`. This is documentation, not automation (automation is V2).
- **Files to create:** `docker/DEPLOY.md`
- **Acceptance criteria:**
  - Step-by-step instructions for Hetzner CX22 setup
  - Covers both Docker and systemd deployment paths
  - Includes `.env` template with required variables
  - Includes verification steps (`ralph doctor`, `systemctl status`)
  - Does not include automation scripts (V2)
- **Size:** S
- **Dependencies:** E8-T1, E8-T2, E8-T3

---

## Epic 9: Claude Code Skills

Thin presentation wrappers that shell out to the `ralph` CLI. Skills never reimplement core logic.

### E9-T1: Create ralph-task skill

- **Description:** Create the `/ralph-task` Claude Code skill. When invoked, it guides the user through task creation by asking for title (required), type, priority, acceptance criteria, files, and constraints. Then shells out to `ralph task create --json --title "..." --type ... [etc]`. Displays the created task. Handles errors from the CLI.
- **Files to create:** `skills/ralph-task.md`
- **Acceptance criteria:**
  - Skill file follows Claude Code skill format
  - Prompts user for task details
  - Shells out to `ralph task create` with appropriate flags
  - Displays result in a human-friendly format
  - Handles CLI errors gracefully
- **Size:** S
- **Dependencies:** E6-T1, E6-T6

### E9-T2: Create ralph-status skill

- **Description:** Create the `/ralph-status` Claude Code skill. Shells out to `ralph status --format json`, parses the output, and presents it in a human-friendly summary: queue counts, active task details, health status.
- **Files to create:** `skills/ralph-status.md`
- **Acceptance criteria:**
  - Shells out to `ralph status --format json`
  - Presents status in readable format
  - Shows queue counts, active task, health
- **Size:** S
- **Dependencies:** E6-T4, E6-T6

### E9-T3: Create ralph-review skill

- **Description:** Create the `/ralph-review` Claude Code skill. Lists tasks in `review` status, lets user pick one, shows the diff (`ralph review <id> --diff`), then prompts for approve/reject with optional comment. Shells out to `ralph review <id> --approve|--reject`.
- **Files to create:** `skills/ralph-review.md`
- **Acceptance criteria:**
  - Lists reviewable tasks
  - Shows diff for selected task
  - Prompts for approve/reject
  - Supports optional review comment
  - Shells out to `ralph review` with appropriate flags
- **Size:** S
- **Dependencies:** E6-T3, E6-T6

### E9-T4: Create ralph-list skill

- **Description:** Create the `/ralph-list` Claude Code skill. Shells out to `ralph task list --format json`, parses output, and displays a formatted table of tasks with status, type, priority, and title.
- **Files to create:** `skills/ralph-list.md`
- **Acceptance criteria:**
  - Shells out to `ralph task list --format json`
  - Displays tasks in a readable table format
  - Supports optional status filter
- **Size:** S
- **Dependencies:** E6-T2, E6-T6

---

## Epic 10: Integration & E2E Testing

Full loop testing -- from task creation through execution to review.

### E10-T1: Create mock Claude executor for E2E tests

- **Description:** Extend the mock executor to simulate realistic Claude behavior for E2E testing. The mock should: receive a prompt, make predictable file changes (create/modify files based on task content), return realistic `ExecutionResult` with cost, turns, and duration. Support configurable scenarios: success, test failure, timeout, refusal. This mock replaces the real Claude CLI in E2E tests.
- **Files to create/modify:** `src/adapters/mock/mock-executor.ts` (extend), `test/e2e/helpers.ts`
- **Acceptance criteria:**
  - Mock can simulate file modifications
  - Mock produces realistic `ExecutionResult` JSON
  - Configurable scenarios: success, partial success (tests fail), timeout, error
  - Can be used in E2E tests without any real Claude API calls
- **Size:** M
- **Dependencies:** E4-T6

### E10-T2: E2E test - happy path full cycle

- **Description:** Write an E2E test that exercises the full happy path: (1) create a task via `createTask`, (2) run one iteration of the orchestrator loop with mock executor that "succeeds", (3) verify task moves to `review/`, (4) verify branch was created and pushed, (5) approve the task via `reviewTask`, (6) verify task moves to `done/` and branch is merged. Uses real filesystem and real git (temp repos) but mock Claude.
- **Files to create:** `test/e2e/happy-path.test.ts`
- **Acceptance criteria:**
  - Full cycle completes without errors
  - Task transitions: pending -> active -> review -> done
  - Git operations are verified (branch exists, branch merged)
  - Task file frontmatter is updated with cost/turns/duration
  - All domain events emitted in correct order
- **Size:** L
- **Dependencies:** E5-T4, E6-T1, E6-T3, E10-T1

### E10-T3: E2E test - failure and retry cycle

- **Description:** Write an E2E test for the failure/retry path: (1) create a task with `max_retries: 2`, (2) run orchestrator loop with mock executor that fails verification, (3) verify task goes back to `pending/` with `retryCount: 1`, (4) run again, fails again, (5) verify task goes to `pending/` with `retryCount: 2`, (6) run again, fails again, (7) verify task goes to `failed/`. Verify stale branches are cleaned up between retries.
- **Files to create:** `test/e2e/failure-retry.test.ts`
- **Acceptance criteria:**
  - Task retries correct number of times
  - `retryCount` increments correctly in frontmatter
  - Stale branches cleaned up between retries
  - Task eventually moves to `failed/` when retries exhausted
  - All domain events emitted correctly
- **Size:** M
- **Dependencies:** E5-T4, E10-T1

### E10-T4: E2E test - crash recovery

- **Description:** Write an E2E test for crash recovery: (1) create a task, (2) manually move it to `active/` (simulating a crash mid-execution), (3) start the orchestrator (which runs `recoverOrphanedTasks`), (4) verify task is moved back to `pending/`, (5) verify stale branch is cleaned up, (6) verify the orchestrator then picks up and processes the task normally.
- **Files to create:** `test/e2e/crash-recovery.test.ts`
- **Acceptance criteria:**
  - Orphaned task in `active/` is detected on startup
  - Task is moved back to `pending/`
  - Stale branch is deleted
  - Task is then processed normally in the next loop iteration
  - Recovery commits are created with appropriate messages
- **Size:** M
- **Dependencies:** E5-T2, E5-T4, E10-T1

---

## Dependency Graph Summary

```
E1 (Setup) ──────────────────────────────────────────────────────┐
  └─► E2 (Core Domain) ──────────────────────────────────────────┤
        ├─► E3 (Ports) ──────────────────────────────────────────┤
        │     └─► E4 (Adapters) ─────────────────────────────────┤
        │           └─► E5 (Orchestrator) ───────────────────────┤
        │                 └─► E8 (Deployment) ───────────────────┤
        │                 └─► E10 (Integration/E2E) ─────────────┘
        └─► E7 (Templates) [parallel with E3-E5]
              │
E6 (Client CLI) [depends on E2, E3, E4]
  └─► E9 (Skills) [depends on E6]
```

Templates (E7) can be built in parallel with adapters and orchestrator work since they are standalone markdown files.

Client CLI (E6) can start once adapters are available, parallel with orchestrator development.

Skills (E9) are the last functional piece since they depend on the finished CLI.

---

## Size Summary

| Size | Count | Description |
|------|-------|-------------|
| S    | 22    | Few hours each |
| M    | 14    | Half day each |
| L    | 3     | Full day+ each |
| **Total** | **39 tasks** | |

## Epic Summary

| Epic | Tasks | Focus |
|------|-------|-------|
| E1: Project Setup | 4 | Scaffolding, config, tooling |
| E2: Pure Core Domain | 7 | Types, parser, state machine, queue, prompt builder, budget, errors |
| E3: Port Interfaces | 1 | 5 port interfaces |
| E4: Adapters | 6 | Filesystem, git, shell, Claude CLI, observability, mocks |
| E5: Orchestrator | 4 | Config, recovery, shutdown, main loop |
| E6: Client CLI | 7 | Create, list, review, status, formatting, CLI entry, doctor |
| E7: Templates & System Prompt | 4 | default.md, bugfix.md, feature.md, ralph-system.md |
| E8: Deployment | 4 | Dockerfile, docker-compose, systemd, provisioning guide |
| E9: Skills | 4 | ralph-task, ralph-status, ralph-review, ralph-list |
| E10: Integration & E2E | 4 | Mock executor, happy path, failure/retry, crash recovery |
