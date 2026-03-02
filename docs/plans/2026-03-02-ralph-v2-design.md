# Ralph v2 — Unified Contextual CLI

**Date:** 2026-03-02
**Status:** Draft
**Author:** Brainstorming session

## Problem Statement

Ralph v1 is a collection of bash scripts that manage autonomous Claude Code loops on a Hetzner VPS. It works, but has three critical gaps:

1. **No remote control** — You must SSH in and run scripts manually. No way to trigger/monitor loops from your laptop.
2. **Fragile task management** — Markdown-based epics/stories have no structural validation. Claude misparses them, tasks get lost, no schema enforcement.
3. **Poor observability** — Logs are crude text. No cost tracking, no structured telemetry, no way to know if a loop is productive or burning money.

## Solution

A unified CLI built with **Bun + TypeScript** that behaves contextually based on its environment. Same binary, different behavior depending on whether it detects a Client, Node, or Project configuration.

---

## 1. Architecture Overview

### Three Environments, One CLI

| Environment | Config File | Role |
|---|---|---|
| **Client** | `.ralph/client.json` | Your laptop. Remote-controls Nodes via SSH. Manages task queues locally, pushes them via git. |
| **Node** | `.ralph/node.json` | The VPS. Hosts projects, runs loops in tmux, produces telemetry. |
| **Project** | `.ralph/project.json` | Inside a project dir on a Node. Contains task queue, type definitions, iteration logs. |

**Environment detection:** The CLI walks up the directory tree looking for `.ralph/{client,node,project}.json` — identical to how `git` finds `.git/`.

### Data Flow

```
Client (your laptop)
  │
  ├── ralph task create --type feature-dev   (assisted via Claude skill)
  ├── git push                               (tasks are in the repo)
  │
  └── ralph remote vps1 loop start myproject (SSH control plane)
        │
        Node (VPS)
          └── Project (.ralph/project.json)
                ├── .ralph/tasks/          ← flat task queue
                ├── .ralph/types/          ← convention-based type definitions
                ├── .ralph/logs/           ← structured JSON logs per iteration
                └── .ralph/state.json      ← loop state
```

**Key principle:** Git is the data transport. Tasks live in the repo. The Client pushes task changes to the remote, the Node pulls and executes. SSH is for commands (start/stop/status), Git is for data (tasks/state).

### Internal Architecture (Hexagonal)

The codebase follows hexagonal architecture: domain logic is pure, all I/O goes through interfaces (ports) with swappable implementations (adapters).

```
src/
  domain/                ← pure logic, no I/O
    task.ts              ← Task type, pickNext(), validation
    loop.ts              ← loop state machine, iteration logic
    types.ts             ← type resolution, prompt compilation
    migration.ts         ← schema migration logic

  ports/                 ← interfaces (SPIs)
    task-repository.ts   ← TaskRepository
    config-provider.ts   ← ConfigProvider
    log-store.ts         ← LogStore
    process-runner.ts    ← ProcessRunner (claude CLI execution)
    remote-executor.ts   ← RemoteExecutor (SSH)
    prompt-compiler.ts   ← PromptCompiler
    progress-detector.ts ← ProgressDetector

  adapters/              ← implementations
    fs-task-repository.ts
    fs-config-provider.ts
    json-log-store.ts
    claude-process-runner.ts
    ssh-remote-executor.ts
    template-prompt-compiler.ts
    git-progress-detector.ts

  cli/                   ← command definitions, wiring
    commands/
    index.ts             ← entry point, adapter wiring
```

No DI container. Constructor injection. The CLI entry point wires adapters to ports. If you want to test domain logic without the filesystem, pass in mock adapters.

---

## 2. CLI Commands

### Universal (all environments)

```
ralph init <node|project|client>   # Initialize environment
ralph version                       # Show version + detected environment
ralph sync                          # Sync skills/agents/types from CLI bundle
ralph migrate                       # Run pending schema migrations
```

### Project-level (requires `.ralph/project.json`)

```
ralph task create --type <TYPE>     # Assisted task creation (spawns Claude skill)
ralph task add <title> [opts]       # Quick task creation from template
ralph task list [--status S] [--type T]
ralph task next                     # Show what the loop would pick next
ralph task edit <id>                # Open task in $EDITOR
ralph task review <id>              # Mark task for review
ralph log [--iteration N] [--json]  # View structured logs
ralph log stats                     # Token/cost/tool usage summary
ralph log errors                    # All errors, sorted by frequency
ralph log tools                     # Tool usage breakdown
```

### Node-level (requires `.ralph/node.json`)

```
ralph loop start <project>          # Start loop in tmux
ralph loop stop <project>           # Graceful stop
ralph loop status [project]         # Status of all/one loop
ralph loop attach <project>         # Attach to tmux session
ralph project add <name> <url>      # Clone + scaffold
ralph project remove <name>         # Delete project
ralph project list                  # List all projects
```

### Client-level (requires `.ralph/client.json`)

```
ralph remote <node> <command>       # SSH proxy: runs command on node
ralph node add <alias> <ssh-host>   # Register a node
ralph node list                     # List registered nodes
```

Commands that don't apply to the current environment show a helpful error:
`"ralph loop start" requires a Node environment. Run "ralph init node" first.`

---

## 3. Task System

### Storage

All tasks live in `.ralph/tasks/` as Markdown files with YAML frontmatter.

**Naming:** `<id>.md` where `id` is a slug derived from title + timestamp (e.g., `fix-auth-bug-20260302.md`).

### Frontmatter Schema (base fields)

```yaml
---
id: fix-auth-bug-20260302
type: bug-fix                   # maps to .ralph/types/<type>/
status: pending                 # pending | in_progress | review_pending | completed | cancelled
priority: 1                    # 1=critical, 2=high, 3=normal, 4=low
parent: epic-auth-overhaul     # optional: logical grouping
depends_on: []                 # IDs of tasks that must complete first
order: 10                      # tie-breaker within same priority
created: 2026-03-02T10:00:00Z
updated: 2026-03-02T10:00:00Z
schema_version: 1              # for migrations
---
```

### Task Hierarchy

**Flat queue with parent references.** All tasks live in one directory. Epics are just tasks whose children share a `parent` ref. No nested directories, no rigid hierarchy.

- An "epic" is a task with children that reference it via `parent`
- A "story" is a task within an epic
- Grouping is logical (via `parent`), not physical (via directories)

### Priority & "Pick Next" Algorithm

```typescript
function pickNext(tasks: Task[]): Task | null {
  return tasks
    .filter(t => t.status === 'pending')
    .filter(t => t.depends_on.every(dep => isCompleted(dep)))
    .sort((a, b) =>
      a.priority - b.priority ||
      a.order - b.order ||
      a.created - b.created
    )[0] ?? null;
}
```

Deterministic. Same state = same pick. A review session creating bug-fixes with `priority: 1` naturally pushes them to the top of the queue.

### Task Types (Convention-Based)

Each task type is a directory under `.ralph/types/`:

```
.ralph/types/
  feature-dev/
    prompt.md       ← prompt enrichment template for loop execution
    template.md     ← scaffolding template for task creation
    schema.json     ← frontmatter validation schema (optional)
    skills/         ← skills injected during this type's execution
    agents/         ← agents injected during this type's execution
  bug-fix/
    prompt.md
    template.md
    ...
  research/
    ...
  review/
    ...
```

New task types = new directories. No config file to update. The filesystem is the registry.

### Task Creation (Two Modes)

1. **Template mode (quick):** `ralph task add --type bug-fix` opens `$EDITOR` with a pre-filled template from `types/bug-fix/template.md`. Validates frontmatter against schema on save.

2. **Assisted mode (rich):** `ralph task create --type feature-dev` invokes a Claude Code skill that interviews you, suggests acceptance criteria, identifies dependencies, and writes the task file. Works both inside an existing Claude session (as a skill) and from the terminal (spawns a new session).

### Schema Migrations

The `schema_version` field in frontmatter tracks the data version. Migrations live in:

```
.ralph/migrations/
  001-add-schema-version.ts
  002-rename-priority-values.ts
```

`ralph migrate` runs pending migrations against all task files. Each migration:
- Checks `schema_version` before applying (idempotent)
- Reads, transforms, writes each affected task file
- Bumps `schema_version` in frontmatter

Migrations ship with the CLI, so updating Ralph tells you if migrations are pending.

---

## 4. Loop Engine

### State Machine

```
IDLE → STARTING → RUNNING → COMPLETING → [REVIEWING] → IDLE
                     ↓                         ↓
                  ERRORED ←──────────────── ERRORED
                     ↓
                  STOPPED
```

### One Iteration

1. **Pick task:** `TaskRepository.pickNext()` — deterministic selection
2. **Resolve type:** Load type definition from `.ralph/types/<type>/`
3. **Compile prompt:** `PromptCompiler.compile(task, type, context)` → merges task body + type prompt template + skills/agents + loop context
4. **Record pre-state:** Git hash, task hash (via `ProgressDetector`)
5. **Execute:** `ProcessRunner.run()` — spawns `claude -p --output-format stream-json` with compiled prompt
6. **Collect:** Pipe output through collector, write structured JSON log via `LogStore`
7. **Post-check:** Progress detection, error tracking via `ProgressDetector`
8. **Update task:** Status transitions based on outcome and type configuration
9. **Apply restart policy:** Continue, pause, or stop

### Prompt Compilation

Behind a `PromptCompiler` interface. The compiled prompt is a structured object:

```typescript
interface PromptCompiler {
  compile(task: Task, type: TypeDefinition, context: LoopContext): CompiledPrompt;
}

interface CompiledPrompt {
  prompt: string;              // final prompt text
  skills: SkillDefinition[];   // skills to inject
  agents: AgentDefinition[];   // agents to inject
  flags: string[];             // extra claude CLI flags
}
```

**Assembly order:**
1. Type prompt template (from `.ralph/types/<type>/prompt.md`)
2. Task body (the actual task content)
3. Injected skills (from `.ralph/types/<type>/skills/`)
4. Loop context (iteration number, previous outcomes, state)

Same task + same type = same prompt structure. Deterministic.

### Circuit Breakers

Configurable per-project in `.ralph/project.json`:

| Breaker | Description | Default |
|---|---|---|
| `maxConsecutiveErrors` | Stop after N consecutive errors | 3 |
| `maxStallIterations` | Stop after N iterations with no progress | 3 |
| `minIterationDuration` | Iterations shorter than this count as no-work | 30s |
| `maxCostUsd` | Stop when accumulated cost exceeds threshold | none |
| `maxTokens` | Stop when total tokens exceed threshold | none |
| `maxIterations` | Hard limit on total iterations | none |

### Review Flow

No special review infrastructure. Reviews use the existing task queue:

1. Worker completes task → sets status to `review_pending`
2. Next "pick next" cycle sees it (review tasks can be prioritized via type config)
3. `review` type loads review-specific prompt + skills
4. Reviewer either marks `completed` or creates new bug-fix tasks with `priority: 1`
5. Bug fixes naturally jump the queue on the next iteration

---

## 5. Observability

### Structured Logs

Each iteration produces a JSON log file in `.ralph/logs/`:

```
.ralph/logs/
  2026-03-02T10-00-00-fix-auth-bug.json
  2026-03-02T10-15-30-add-user-profile.json
```

### Log Schema (per iteration)

```json
{
  "iteration": 4,
  "task_id": "fix-auth-bug-20260302",
  "task_type": "bug-fix",
  "started_at": "2026-03-02T10:00:00Z",
  "ended_at": "2026-03-02T10:14:22Z",
  "duration_seconds": 862,
  "exit_code": 0,
  "tokens": { "input": 45230, "output": 12400 },
  "cost_estimate_usd": 0.42,
  "tools_used": [
    { "tool": "Bash", "count": 12, "errors": 1 },
    { "tool": "Edit", "count": 8, "errors": 0 },
    { "tool": "Read", "count": 15, "errors": 0 }
  ],
  "git": {
    "pre_hash": "abc123",
    "post_hash": "def456",
    "commits": 3,
    "files_changed": 7
  },
  "outcome": "completed",
  "errors": [
    { "timestamp": "...", "tool": "Bash", "message": "npm test failed" }
  ]
}
```

### Collector v2

Rewritten in TypeScript as part of the CLI. Parses Claude's `stream-json` output in real-time:

1. Writes structured JSON log on completion (via `LogStore` interface)
2. Optionally streams human-readable output to stdout (for tmux visibility)
3. Tracks running totals (tokens, cost) for circuit breaker evaluation
4. All behind the `LogStore` interface — swappable adapter

### CLI Query Commands

```
ralph log                     # latest iteration, human-readable
ralph log --json              # latest iteration, raw JSON
ralph log stats               # aggregate: total cost, tokens, errors
ralph log errors              # all errors, sorted by frequency
ralph log tools               # tool usage breakdown
```

This structured data is the foundation for v2.1's reflection/learning engine.

---

## 6. Remote Control

### Model

Client wraps SSH transparently. `ralph remote <node> <command>` executes the command on the remote node via SSH.

### Client Configuration

`.ralph/client.json`:
```json
{
  "environment": "client",
  "nodes": {
    "vps1": {
      "host": "user@123.45.67.89",
      "ssh_key": "~/.ssh/id_ed25519",
      "ralph_path": "/home/user/ralph-vps"
    }
  }
}
```

### How It Works

```
ralph remote vps1 loop status
  → ssh user@123.45.67.89 "cd /home/user/ralph-vps && ralph loop status"

ralph remote vps1 log --follow myproject
  → opens SSH channel, streams output back
```

### Implementation

Behind a `RemoteExecutor` interface:

```typescript
interface RemoteExecutor {
  execute(node: string, command: string[]): Promise<ExecutionResult>;
  stream(node: string, command: string[]): AsyncIterable<string>;
}
```

The `stream` method handles log following over SSH.

### Task Flow (Client → Node)

1. Create tasks locally (inside your local clone): `ralph task create --type feature-dev`
2. Push to remote: `git push` (tasks in `.ralph/tasks/` are tracked by git)
3. Start the loop: `ralph remote vps1 loop start myproject`
4. Monitor: `ralph remote vps1 loop status` or `ralph remote vps1 log --follow myproject`

**Git = data plane. SSH = control plane.**

---

## 7. Skill & Agent Management

### Bundled with CLI

Skills, agents, and type definitions ship with the Ralph CLI.

```
ralph-cli/
  built-in/
    types/                    ← default task types
      feature-dev/
      bug-fix/
      research/
      review/
    skills/                   ← shared skills (not type-specific)
    agents/                   ← shared agents
```

### Sync Mechanism

`ralph sync` copies bundled assets into the project:

```
ralph sync
  → built-in/types/   → .ralph/types/    (merge, respect customizations)
  → built-in/skills/  → .ralph/skills/
  → built-in/agents/  → .ralph/agents/
```

### Customization

Projects can override bundled definitions. Resolution order:

1. **Project-level** (`.ralph/types/<type>/`) — highest priority
2. **CLI-bundled** (`built-in/types/<type>/`) — fallback

If `.ralph/types/feature-dev/prompt.md` exists in the project, it takes precedence over the bundled version.

### Version Tracking

`.ralph/sync-manifest.json` tracks sync state:

```json
{
  "last_sync": "2026-03-02T10:00:00Z",
  "cli_version": "2.1.0",
  "synced_types": ["feature-dev", "bug-fix", "research", "review"],
  "custom_overrides": ["feature-dev/prompt.md"]
}
```

`ralph sync` knows what's custom and won't overwrite it.

---

## 8. Technology Choices

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Bun | Native TS, fast startup, already on VPS, `--compile` for single binary if needed |
| Language | TypeScript | Type safety for schemas, interfaces for hexagonal architecture |
| CLI framework | TBD (commander/citty/custom) | Subcommand pattern, environment-aware command registration |
| Schema validation | Zod or similar | Validate frontmatter, config files, log schemas |
| SSH | Node ssh2 or shell exec | For RemoteExecutor adapter |
| Process management | tmux (carried from v1) | Proven, simple, detachable sessions |
| Git interaction | shell exec (`git` CLI) | No need for a library, simple commands |

---

## 9. Migration Path (v1 → v2)

1. Build v2 CLI alongside v1 scripts (they can coexist)
2. `ralph migrate` converts v1 Markdown epics/stories → v2 task files
3. `ralph init node` sets up Node environment on existing VPS
4. `ralph init project` scaffolds `.ralph/` in existing projects
5. Deprecate v1 `bin/` scripts once v2 is proven stable

---

## 10. What's Explicitly Out of Scope (v2.0)

- **Live terminal dashboard (TUI)** — structured logs first, dashboards later
- **Reflection/learning engine** — v2.1, but log schema supports it
- **Multi-project coordination** — not a current pain point
- **Web dashboard** — terminal-first
- **Docker** — still just SSH + tmux
- **API server on VPS** — SSH is sufficient for remote control
