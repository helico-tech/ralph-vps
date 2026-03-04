# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Is This

Ralph is an autonomous coding agent that picks up tasks from a git-based queue and executes them using Claude Code on a VPS. Git is the only communication channel and state store — no databases, no message queues.

## Commands

```sh
bun test                    # Run all tests (186 tests, 19 files)
bun test test/core/         # Run tests in a directory
bun test test/core/queue    # Run a single test file (partial match works)
bun run check               # TypeScript type check (tsc --noEmit)
bun run dev                 # Run CLI in development mode
bun run build               # Build to dist/ (Node-compatible binary)
```

## Architecture

**Hexagonal architecture** with three layers:

```
src/core/           Pure domain logic — zero I/O, all functions are pure
src/ports/          Port interfaces (TaskRepository, SourceControl, AgentExecutor, Observability)
src/adapters/       Implementations with real I/O (Bun.spawn, Bun.file)
src/adapters/mock/  Mock implementations for testing without I/O
src/orchestrator/   Wires ports to adapters, runs the main loop
src/client/         CLI commands (laptop-side: init, create-task, list, status)
src/cli.ts          Entry point — Commander.js CLI
```

**Data flow:** CLI → `buildClientDeps()` → ports. Orchestrator → `runLoop()` → `processTask()` using all four ports.

**Key domain files:**
- `src/core/types.ts` — All domain types (Task, RalphConfig, DomainEvent)
- `src/core/state-machine.ts` — `transitionTask()` with retry guards
- `src/core/task-file.ts` — YAML frontmatter + Markdown parsing/serialization
- `src/core/queue.ts` — `pickNextTask()` priority-based selection
- `src/core/next-task.ts` — `buildNextTasks()` spawns review/fix follow-ups
- `src/orchestrator/loop.ts` — `processTask()`, `runLoop()`, `OrchestratorDeps` interface

**OrchestratorDeps** is a plain interface — no DI container. Functions take `deps` as first param.

## Conventions

- **`.js` extensions on all imports** — required for bundler module resolution
- **`import type`** for type-only imports
- **snake_case** for data fields (`task_id`, `parent_id`, `commit_hash`, `max_turns`)
- **camelCase** for functions/methods, **PascalCase** for classes
- **Lower priority number = higher priority** (Unix nice-style)
- **Bun.spawn()** for subprocesses, **Bun.file()** for filesystem
- Error classes use `readonly code: string` property

## Task State Machine

Status is derived from directory, not a field. `git mv` between directories IS the state transition:

```
.ralph/tasks/pending/  →  active/  →  done/
                                   →  failed/
```

Task types: `feature`, `bugfix` (you create) → `review`, `fix` (Ralph auto-spawns). Fix failure stops the chain.

## Testing Patterns

- Framework: `bun:test` with 10s timeout (bunfig.toml)
- Each test file defines its own `makeTask()` helper
- Integration tests use `mkdtemp` + `rm` for temp directories
- Core tests need no mocks (pure functions). Adapter tests use real I/O. Orchestrator tests use mock adapters.

## Prompt Templates

Templates in `templates/` use `{{variable}}` interpolation (id, type, description, priority, parent_id). System prompt in `templates/ralph-system.md` uses `{{project_name}}` and `{{verify_command}}`.
