# Phase 2 Cross-Review: Core Architecture Perspective

> By **core-arch** | 2026-03-03
>
> Reviewing all deep-dives through the lens of hexagonal architecture, port
> boundaries, and structural integrity.

---

## 1. Critique of Each Deep-Dive

### 1.1 Observability (`observability.md`)

**The Central Question: Does the ObservabilityPort fit into the 5-port model, or do we need a 6th?**

Short answer: **it replaces the Logger port, not supplements it.** My original 5-port model included a `Logger` port that was arguably the weakest of the five -- it was a glorified `console.log` wrapper with no domain semantics. The observability deep-dive proposes an `ObservabilityPort` with `emit(event: DomainEvent)`, which is strictly superior.

Here's why I accept it:

1. **Logger is infrastructure, not domain.** Logging "task claimed" as a string vs emitting `{ type: 'task.claimed', taskId, timestamp }` -- the latter is a domain event. The former is printf debugging with extra steps.
2. **Single-method port.** `emit(event: DomainEvent)` is beautifully minimal. One method, one discriminated union. No sprawling interface.
3. **Composite adapter pattern works.** `CompositeObservabilityAdapter` dispatching to `TraceWriterAdapter`, `HeartbeatAdapter`, and `ConsoleLogAdapter` means logging is just one adapter behind the port, not a separate port.

**Verdict: 5 ports, not 6.** The model becomes:

| # | Port | Purpose |
|---|------|---------|
| 1 | TaskRepository | Read/write task files |
| 2 | SourceControl | Git operations |
| 3 | AgentExecutor | Run Claude Code CLI |
| 4 | Verifier | Run test/build/lint |
| 5 | Observability | Emit domain events |

Logger disappears. `ConsoleLogAdapter` becomes one leaf adapter behind `CompositeObservabilityAdapter`. This is cleaner.

**Where observability.md goes wrong:**

- **Budget enforcement inside the port.** The doc proposes `checkBudget()` as an observability concern. No. Budget checking is a **core domain function** -- it's a predicate on cost data that gates task pickup. The observability port *provides* cost data; the core *decides* whether to proceed. Mixing the decision into the port violates the "core has no side effects" principle.
- **`stream-json` complexity.** The doc correctly identifies `--output-format stream-json` as the gold mine for tool-call tracking, but underestimates the parsing burden. Streaming NDJSON from a subprocess, handling partial lines, and correlating `content_block_start`/`content_block_stop` pairs is non-trivial. For V1, `--output-format json` with post-hoc JSONL parsing is simpler and gives us 80% of the value. Stream-json should be a V2 enhancement.
- **Trace file location.** `.ralph/traces/<task-id>.json` means trace files are inside the git-tracked `.ralph/` directory. Are traces committed to git? They shouldn't be -- they're ephemeral execution artifacts. Either `.ralph/traces/` goes in `.gitignore`, or traces live outside `.ralph/` entirely (e.g., `~/.ralph/traces/` on the node). The doc doesn't address this clearly.

**Grade: B+.** Strong conceptual model, correctly identifies the port shape. Loses points for muddying domain/infrastructure boundaries on budget enforcement and not resolving the trace storage question.

---

### 1.2 Client Interface (`client-interface.md`)

**The Central Question: Does the client create unnecessary port duplication?**

Yes. But it's *justified* duplication.

The client-interface doc proposes its own hexagonal architecture with `GitPort`, `TaskFilePort`, and `RalphClientPort`. At first glance, this looks like it's re-inventing the orchestrator's `SourceControl` and `TaskRepository` ports. But the concerns are different:

| Concern | Orchestrator | Client |
|---------|-------------|--------|
| Git operations | Branch create/checkout, push results, ff-only merge | Pull status, read branches, create task commits |
| Task files | Parse for execution, move between status dirs | Create new tasks, read for display, modify for review |
| Direction | Writes results | Writes requests |

The orchestrator *consumes* tasks and *produces* results. The client *produces* tasks and *consumes* results. They touch the same files but with opposite intent. Sharing a port interface would force both sides into an awkward "god interface" that does everything.

**Where client-interface.md goes wrong:**

- **`RalphClientPort` is too fat.** The interface has `createTask`, `listTasks`, `getTask`, `getQueueStatus`, `getNodeStatus`, `reviewTask`, `getExecutionTrace`, `getCosts` -- that's 8 methods and growing. This smells like a service facade, not a port. Split it: `TaskManagementPort` (create/list/get), `ReviewPort` (approve/reject), `IntrospectionPort` (status/costs/traces). Each port gets its own adapter, testable in isolation.
- **Three adapters is premature.** Skills adapter, CLI adapter, Programmatic API adapter. For V1, we need *one*: the CLI. Skills are sugar on top of the CLI (they shell out to `ralph` commands). The programmatic API has zero users until someone builds a dashboard. Building three adapters before shipping one is exactly the over-engineering the "no ceremony" test catches.
- **`TaskFilePort` vs `TaskRepository`.** The client's `TaskFilePort` reads/writes YAML frontmatter task files -- which is exactly what the orchestrator's `FsTaskRepository` does. This is shared code, not a separate port. Extract a `taskFile` module (pure functions: `parseTask(content: string): Task`, `serializeTask(task: Task): string`) and use it on both sides.

**What client-interface.md gets right:**

- **Review workflow.** The approve/reject flow with branch merging is well-designed and addresses the consensus requirement of "no auto-accept." The `ralph review approve <task-id>` -> merge branch -> move to `done/` flow is correct.
- **Error taxonomy.** Actionable error messages with suggestions (`"No tasks in review. Did you mean 'ralph list --status active'?"`) is good UX design.
- **Skill design.** The `/ralph-task`, `/ralph-status`, `/ralph-review` skills are well-scoped. Each does one thing.

**Grade: B.** Good UX instincts, correct separation of client vs orchestrator concerns. Over-engineered on adapter count, under-engineered on port granularity. The `TaskFilePort` duplication is a code smell that should be resolved with shared parsing functions.

---

### 1.3 Prompt Templates (`prompt-templates.md`)

**The Central Question: Does the prompt construction pipeline match the core domain's `buildPrompt()` function?**

Mostly yes, with one important correction.

My core-arch.md defined `buildPrompt(task: Task, config: RalphConfig): string` as a pure function in the core domain. The prompt-templates doc defines a 5-stage pipeline:

```
parse task -> select template -> interpolate -> inject context -> build CLI args
```

Stages 1-3 map cleanly to my `buildPrompt()`. Stage 4 (inject context) is still pure -- it reads from the task and config, no I/O. Stage 5 (build CLI args) is where it gets interesting.

**Building CLI args is NOT a core concern.** `--max-turns 50 --max-budget-usd 5 --output-format json` are adapter details. The core builds the prompt string. The `ClaudeCliExecutor` adapter takes that string and constructs the CLI invocation. If we ever switch from Claude CLI to direct API calls, the prompt stays the same but the invocation mechanism changes entirely. This confirms: stages 1-4 are core, stage 5 is adapter.

**Where prompt-templates.md shines:**

- **System prompt design.** The 20-rule system prompt at `.ralph/ralph-system.md` is excellent. Under 80 lines, every rule earns its place. The "stuck protocol" (write `RALPH-STUCK.md` after 3 failed attempts) is particularly clever -- it turns agent failure into a reviewable artifact.
- **Template variables.** Clean `{{variable}}` interpolation without conditionals or loops. Logic in the builder, not the template. This is correct.
- **Entry/exit criteria per task type.** `maxTurns`, `maxBudget`, `timeout` as configurable knobs per task type is well-designed. The default of 30 turns / $2 budget / 15 min timeout is reasonable for V1.
- **Tool profiles.** `BASE_TOOLS`, `EDIT_TOOLS`, `FULL_TOOLS` as tool allowlists per task type. Research tasks get read-only tools. Feature tasks get everything. This is smart scope control.

**Where prompt-templates.md goes wrong:**

- **Six templates from day one.** Default, bugfix, feature, refactor, test, research. The doc itself says "start with one default template that handles any task type reasonably well. Then specialize." Then it proceeds to define six. Pick one: either we start with the default template and specialize later, or we ship six. I say start with default + bugfix + feature (the three most distinct), and add the rest when we have data showing the default isn't good enough.
- **`{{#list}}` syntax.** The doc introduces `{{#list items}}{{.}}{{/list}}` for array interpolation. This is creeping toward Mustache/Handlebars territory. For V1, `{{acceptanceCriteria}}` that joins an array with newlines is simpler. If we need list rendering, `items.map(i => '- ' + i).join('\n')` in the builder is one line of code, not a template language feature.
- **Agent definition file.** `.claude/agents/ralph-worker.md` duplicates system prompt concerns. The system prompt IS the agent definition for headless mode. Adding a second file means two places to update, two places that can conflict. Use `--append-system-prompt-file` with one file.

**Grade: A-.** The strongest deep-dive after core-arch (biased? maybe). Prompt design is clearly this agent's expertise. Loses points for template count and the `{{#list}}` creep. The pipeline model is architecturally sound.

---

### 1.4 Node Runtime (`node-runtime.md`)

**The Central Question: Does the node runtime respect the core/adapter boundary?**

Emphatically yes. This is the deep-dive that most explicitly understands hexagonal architecture from the deployment perspective.

**"Docker is an adapter, not the architecture"** -- this is the correct framing. The orchestrator code contains zero references to Docker, systemd, or any deployment mechanism. All environment-specific configuration enters via environment variables or config file. The doc proposes `docker/` and `systemd/` as sibling directories to `src/`, which are deployment adapters that wrap the same `src/` binary.

**What node-runtime.md gets right:**

- **Runtime contract.** The table of requirements (git >= 2.25, bun >= 1.1, claude CLI, network, writable fs) is the correct abstraction. The orchestrator depends on the *contract*, not the *provider*.
- **`ralph doctor` as contract checker.** Running before the orchestrator starts, checking every requirement. This is the "fast fail" pattern done right.
- **Graceful shutdown.** SIGTERM handling that varies by execution phase (idle: exit immediately; between tasks: finish current, don't pick next; mid-execution: wait for Claude to finish, then exit). This respects the domain's state machine.
- **Crash recovery.** Orphan detection on startup (tasks in `active/` with no running process), stale branch cleanup. This aligns with my `recoverOrphanedTasks()` function.
- **Resource estimates.** CX22 (2 vCPU, 4GB RAM) handles 1-3 orchestrators. Concrete, useful, grounded in reality.

**Where node-runtime.md goes wrong:**

- **File structure divergence.** The doc proposes:
  ```
  docker/
    Dockerfile
    entrypoint.sh
    docker-compose.yml
  systemd/
    ralph.service
    ralph-logrotate.conf
  src/
    ...
  ```
  This conflicts with my proposed structure where everything lives under `src/` with `adapters/` as a subdirectory. But actually -- deployment adapters are NOT code adapters. `Dockerfile` and `ralph.service` don't implement a port interface. They're infrastructure-as-code. Keeping them at the project root alongside `src/` is correct. I was wrong to try to put everything under `src/`.

- **`entrypoint.sh` does too much.** The proposed entrypoint script runs `ralph doctor`, sets up git config, and starts the orchestrator. This is fine for Docker, but the same logic is needed for bare VPS. Extract the startup sequence into the orchestrator itself (`ralph start` command) and let the deployment adapters just call `ralph start`. Single entrypoint, multiple wrappers.

- **Missing log rotation for Docker.** The doc covers `logrotate.conf` for systemd but doesn't address Docker log rotation. `docker run --log-opt max-size=10m --log-opt max-file=3` should be in the `docker-compose.yml`.

**Grade: A-.** Strong understanding of boundaries. The "Docker is an adapter" framing should be quoted in the final architecture doc. Minor issues with startup sequence duplication and missing Docker log rotation.

---

### 1.5 Onboarding (`onboarding.md`)

**The Central Question: Where does onboarding touch the core architecture?**

Barely. And that's correct.

Onboarding is almost entirely a deployment/UX concern. `ralph init node` provisions infrastructure. `ralph init project` scaffolds `.ralph/` files. `ralph hello` creates a first task. `ralph doctor` checks runtime contracts. None of this touches the core domain or port interfaces.

**Where onboarding.md is architecturally relevant:**

- **`.ralph/` directory scaffolding.** `ralph init project` creates the directory structure that `FsTaskRepository` expects. This means the onboarding code must agree with the adapter on directory layout. This is a coupling point, and it's acceptable -- both read from the same config or convention.
- **`ralph doctor` overlap.** Both onboarding.md and node-runtime.md propose `ralph doctor`. They should be the same command, same implementation. The onboarding doc focuses on UX (friendly messages, "next steps" suggestions). The node-runtime doc focuses on the checks themselves. Merge them.

**Where onboarding.md goes wrong:**

- **Interactive prompts.** `ralph init` with `Are you setting up a new node? (y/n)` -- interactive prompts are fine for a CLI tool, but they make testing harder and scripting impossible. Provide explicit subcommands (`ralph init node --docker`, `ralph init project`) and only use interactive mode as a convenience wrapper.
- **Not much else.** This is a well-scoped doc that stays in its lane.

**Grade: B.** Solid UX design, stays appropriately outside the core. Loses points for `ralph doctor` duplication with node-runtime and preference for interactive prompts over explicit commands.

---

## 2. Agent Rankings

Ranked by how well each deep-dive respects and extends the hexagonal architecture:

| Rank | Agent | Grade | Rationale |
|------|-------|-------|-----------|
| 1 | **node-runtime** | A- | Best boundary understanding. "Docker is an adapter" is architecturally perfect. Concrete, grounded, no hand-waving. |
| 2 | **prompt-templates** | A- | Strongest domain expertise. Pipeline model maps cleanly to core functions. Minor template count and syntax creep. |
| 3 | **observability** | B+ | Correct port shape with `emit(DomainEvent)`. Budget enforcement misplaced. Trace storage unresolved. |
| 4 | **client-interface** | B | Good UX, correct client/orchestrator separation. Over-engineered adapter count. Fat port interface. |
| 5 | **onboarding** | B | Stays in its lane. Limited architectural surface area. `ralph doctor` duplication. |

---

## 3. Architectural Conflicts

### Conflict 1: Trace Storage Location

- **observability.md**: `.ralph/traces/<task-id>.json`
- **node-runtime.md**: Doesn't explicitly address traces, but implies ephemeral data stays on the node
- **core-arch.md**: `.ralph/` is git-tracked

**Resolution:** Traces are NOT git-tracked. They're node-local execution artifacts. Add `.ralph/traces/` to `.gitignore`, or better: store traces at `~/.ralph/traces/` outside the repo entirely. Traces are *read* by the client via `ralph trace <task-id>` which SSHs to the node, not via git.

Actually, wait. If we store traces outside the repo, the client has no git-based way to access them. The entire system's communication channel is git. Putting traces outside git means building a second communication channel (SSH/HTTP).

**Better resolution:** Store traces in `.ralph/traces/`, git-track them, but keep them small. The `--output-format json` result (not `stream-json`) is typically <1KB per task. Commit the trace JSON alongside the task's result branch. When the branch merges to main, the trace comes with it. This keeps everything in git without bloating the repo for V1.

### Conflict 2: `ralph doctor` Ownership

- **onboarding.md**: `ralph doctor` as a user-facing diagnostic during setup
- **node-runtime.md**: `ralph doctor` as a pre-start contract checker

**Resolution:** Same command, same implementation. `ralph doctor` is defined once in `src/doctor.ts`. It's called by:
1. `ralph init node` (during setup, with friendly "next steps" messaging)
2. The orchestrator startup sequence (fail-fast if contract isn't met)
3. The user directly (`ralph doctor` from terminal)

The check logic is shared. The presentation layer (how results are displayed) varies by context.

### Conflict 3: File Structure

Three different file structures proposed:

**core-arch.md:**
```
src/
  core/
  ports/
  adapters/
  orchestrator/
```

**node-runtime.md:**
```
docker/
systemd/
src/
  ...
```

**client-interface.md:**
```
src/
  client/
    core.ts
    adapters/
      skills/
      cli/
      api/
```

**Resolution:** See Section 4 below for the unified structure.

### Conflict 4: Task File Parsing Duplication

- **core-arch.md**: `FsTaskRepository` adapter parses YAML frontmatter
- **client-interface.md**: `TaskFilePort` adapter parses YAML frontmatter

**Resolution:** Extract `parseTaskFile(content: string): Task` and `serializeTaskFile(task: Task): string` as pure functions in `core/task-file.ts`. Both the orchestrator's `FsTaskRepository` and the client's task operations import from the same module. No duplication.

### Conflict 5: CLI Arg Construction Ownership

- **prompt-templates.md**: Stage 5 of the pipeline builds CLI args (`--max-turns`, `--output-format`, etc.)
- **core-arch.md**: `ClaudeCliExecutor` adapter constructs the CLI invocation

**Resolution:** The adapter wins. The core builds the prompt string. The `ClaudeCliExecutor` adapter takes the prompt string + execution config (turns, budget, timeout from the task type's exit criteria) and constructs the CLI args. The prompt-templates pipeline stops at stage 4 (the interpolated prompt string). Stage 5 moves to the adapter.

### Conflict 6: Budget Enforcement Location

- **observability.md**: Budget checking inside the observability port
- **core-arch.md**: Budget checking as a core domain function

**Resolution:** Core domain wins. `canClaimTask(costs: CostSummary, limits: BudgetLimits): boolean` is a pure function in the core. The observability adapter *provides* cost data via trace aggregation. The orchestrator loop *calls* the core function before claiming a task. The port never makes decisions.

---

## 4. FINAL Unified Module/File Structure

This structure resolves all conflicts from Section 3. Every file belongs to exactly one of: core domain, port, adapter, orchestrator, client, deployment, or configuration.

```
ralph/
├── src/
│   ├── core/                          # Pure domain logic. Zero I/O imports.
│   │   ├── types.ts                   # Task, TaskStatus, ExecutionResult, DomainEvent, etc.
│   │   ├── task-file.ts               # parseTaskFile(), serializeTaskFile() -- shared parsing
│   │   ├── state-machine.ts           # transitionTask() -- pure state transitions
│   │   ├── queue.ts                   # pickNextTask() -- deterministic task selection
│   │   ├── prompt-builder.ts          # buildPrompt() -- template interpolation (stages 1-4)
│   │   ├── budget.ts                  # canClaimTask(), calculateCosts() -- budget predicates
│   │   ├── consistency.ts             # checkConsistency() -- repo invariant checks
│   │   └── errors.ts                  # Error types: TaskError, GitError, ExecutionError, etc.
│   │
│   ├── ports/                         # Interfaces only. No implementations.
│   │   ├── task-repository.ts         # TaskRepository interface
│   │   ├── source-control.ts          # SourceControl interface
│   │   ├── agent-executor.ts          # AgentExecutor interface
│   │   ├── verifier.ts                # Verifier interface
│   │   └── observability.ts           # Observability interface -- emit(event: DomainEvent)
│   │
│   ├── adapters/                      # Port implementations. All I/O lives here.
│   │   ├── fs-task-repository.ts      # TaskRepository -> filesystem (uses core/task-file.ts)
│   │   ├── git-source-control.ts      # SourceControl -> git CLI
│   │   ├── claude-cli-executor.ts     # AgentExecutor -> claude -p (builds CLI args here)
│   │   ├── shell-verifier.ts          # Verifier -> shell commands (npm test, etc.)
│   │   ├── composite-observability.ts # Observability -> fan-out to child adapters
│   │   ├── trace-writer.ts            # Observability child -> .ralph/traces/<id>.json
│   │   ├── heartbeat-writer.ts        # Observability child -> .ralph/heartbeat.json
│   │   ├── console-logger.ts          # Observability child -> stdout (replaces Logger port)
│   │   └── mock/                      # Test doubles
│   │       ├── mock-executor.ts       # Deterministic agent responses
│   │       ├── mock-source-control.ts # In-memory git operations
│   │       └── mock-observability.ts  # Event collector for assertions
│   │
│   ├── orchestrator/                  # The main loop. Wires ports to adapters.
│   │   ├── loop.ts                    # processTask(), main polling loop
│   │   ├── recovery.ts               # recoverOrphanedTasks() -- startup crash recovery
│   │   ├── shutdown.ts               # SIGTERM/SIGINT handling, graceful exit
│   │   └── config.ts                 # loadConfig() -- reads .ralph/config.json
│   │
│   ├── client/                        # Client-side operations (task creation, review, status)
│   │   ├── create-task.ts             # Create task file, commit, push
│   │   ├── list-tasks.ts              # Read task files, format for display
│   │   ├── review-task.ts             # Approve/reject, merge branch, move file
│   │   ├── status.ts                  # Queue status, node status
│   │   └── format.ts                  # Output formatting (table, json, plain)
│   │
│   ├── doctor.ts                      # ralph doctor -- runtime contract checker
│   └── cli.ts                         # CLI entry point -- arg parsing, command dispatch
│
├── templates/                         # Prompt templates (outside src/ -- user-editable)
│   ├── default.md                     # Catch-all template
│   ├── bugfix.md                      # Bug-specific template
│   └── feature.md                     # Feature-specific template
│
├── docker/                            # Docker deployment adapter
│   ├── Dockerfile                     # oven/bun:1-slim based image
│   ├── docker-compose.yml             # Volume mounts, log rotation, env vars
│   └── .dockerignore
│
├── systemd/                           # Bare VPS deployment adapter
│   ├── ralph.service                  # systemd unit file
│   └── ralph-logrotate.conf           # Log rotation config
│
├── skills/                            # Claude Code skills (thin wrappers around CLI)
│   ├── ralph-task.md                  # /ralph-task skill definition
│   ├── ralph-status.md                # /ralph-status skill definition
│   ├── ralph-review.md                # /ralph-review skill definition
│   └── ralph-list.md                  # /ralph-list skill definition
│
├── test/                              # Tests mirror src/ structure
│   ├── core/
│   │   ├── state-machine.test.ts      # Pure function tests (fast, no mocks)
│   │   ├── queue.test.ts
│   │   ├── prompt-builder.test.ts
│   │   ├── budget.test.ts
│   │   └── task-file.test.ts
│   ├── adapters/
│   │   ├── fs-task-repository.test.ts # Real filesystem, temp dirs
│   │   ├── git-source-control.test.ts # Real git, local bare repos
│   │   └── claude-cli-executor.test.ts# Mock subprocess
│   ├── orchestrator/
│   │   ├── loop.test.ts               # Integration: mock adapters, real core
│   │   └── recovery.test.ts
│   └── client/
│       ├── create-task.test.ts
│       └── review-task.test.ts
│
├── .ralph/                            # Ralph runtime directory (git-tracked, some entries gitignored)
│   ├── config.json                    # Project configuration
│   ├── ralph-system.md                # System prompt (appended to Claude's defaults)
│   ├── tasks/
│   │   ├── pending/                   # Tasks waiting to be claimed
│   │   ├── active/                    # Tasks currently being worked on
│   │   ├── review/                    # Tasks awaiting human review
│   │   ├── done/                      # Completed tasks (archivable)
│   │   └── failed/                    # Failed tasks
│   ├── heartbeat.json                 # Node liveness signal (gitignored)
│   └── traces/                        # Execution traces (git-tracked, small JSON)
│
├── package.json
├── tsconfig.json
├── bunfig.toml
└── README.md
```

### File Count: ~45 files

That's roughly 20 source files, 10 test files, 5 templates/skills, 5 deployment files, and 5 config files. Each file does one thing. No file exceeds 200 lines in V1.

### Key Design Decisions in This Structure

1. **`core/task-file.ts` is shared.** Both `FsTaskRepository` (orchestrator) and `create-task.ts` (client) import the same parsing functions. No duplication.

2. **`templates/` lives outside `src/`.** Templates are user-editable configuration, not compiled code. They're loaded at runtime by `prompt-builder.ts` via the config's template directory path.

3. **`docker/` and `systemd/` are top-level.** They're deployment adapters, not code adapters. They don't implement port interfaces. They wrap `ralph start`.

4. **`skills/` are markdown files.** Claude Code skills are `.md` files with frontmatter. They shell out to `ralph` CLI commands. They're not TypeScript.

5. **`client/` has no separate ports.** Client operations are functions that use the same `TaskRepository` and `SourceControl` ports as the orchestrator. No `RalphClientPort` god interface. Each file in `client/` is a use case, not an adapter.

6. **Three templates, not six.** `default.md`, `bugfix.md`, `feature.md`. The refactor/test/research templates are added when data shows the default isn't sufficient.

7. **No `adapters/mock/` at V1.** Wait -- I put it in the structure. Fine, mock adapters are test infrastructure. They live in `src/adapters/mock/` because they implement the same port interfaces as real adapters. Tests import them. This is correct.

8. **`observability.ts` port, composite adapter pattern.** One port interface. One composite adapter that fans out to trace-writer, heartbeat-writer, and console-logger. Adding a new observability sink means adding one adapter and registering it in the composite. The port interface never changes.

---

## 5. Remaining Open Questions

1. **Trace size over time.** If we git-track traces, the repo grows. For V1 with <100 tasks, this is negligible. At 1000+ tasks, we need a pruning strategy. Archive traces older than 30 days? Move `done/` task files and their traces to a separate branch?

2. **Client-orchestrator shared code.** The unified structure puts client and orchestrator in the same `src/` tree. This means the client CLI and orchestrator share a `package.json` and dependencies. Is this a monolith smell, or is it appropriate for a single-binary tool? I argue it's fine -- Ralph is one tool with two modes (`ralph start` for orchestrator, `ralph task` for client). One binary, two entry points.

3. **Template hot-reload.** If a user edits `templates/bugfix.md` while the orchestrator is running, does it pick up changes? It should -- templates are loaded per-task, not cached at startup. This is a minor implementation detail but worth noting.

4. **Skill installation.** How do skills in `skills/` get installed into the user's Claude Code? `ralph init project` could symlink them to `.claude/skills/`, or the user copies them manually. The onboarding doc should specify this.

---

## 6. Summary

The five deep-dives are broadly compatible. The hexagonal architecture survives contact with all specializations. The key corrections are:

1. **Logger port -> Observability port.** Same slot, richer semantics.
2. **Budget enforcement in core, not in observability port.** Ports provide data, core makes decisions.
3. **CLI arg construction in the adapter, not the prompt pipeline.** The core builds prompts, adapters build invocations.
4. **Shared task file parsing.** One module, two consumers.
5. **Three templates for V1, not six.** Start general, specialize with data.
6. **`ralph doctor` is one command** used by onboarding, orchestrator startup, and the user directly.
7. **Deployment adapters (`docker/`, `systemd/`) are top-level**, not under `src/adapters/`.

The unified file structure in Section 4 is the **canonical reference** for implementation. It resolves all conflicts and keeps the total footprint under 45 files.
