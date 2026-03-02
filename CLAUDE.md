# Ralph — Claude Code Instructions

Autonomous Claude Code loop manager. Built with Bun + TypeScript using hexagonal architecture.

## Project Structure

- `src/domain/` — Pure business logic (task management, loop state machine, cost estimation)
- `src/ports/` — Port interfaces (dependency inversion boundaries)
- `src/adapters/` — Concrete implementations (filesystem, git, SSH, Claude process)
- `src/cli/` — Commander.js CLI with environment-conditional command registration
- `src/cli/commands/` — Individual command modules (task, loop, sync, log, remote, etc.)
- `src/built-in/types/` — Built-in task type templates (feature-dev, bug-fix, research, review)
- `src/constants.ts` — Path constants (.ralph, .ralph-local, etc.)
- `src/errors.ts` — Error hierarchy (RalphError, TaskValidationError, ConfigError, etc.)
- `src/__tests__/` — Test helpers, fixtures, and integration tests
- `docker/` — Docker test infrastructure (SSH test container)
- `docs/` — Documentation and design plans

### Architecture

Hexagonal architecture with three layers:
1. **Domain** — Pure functions and types, no I/O. Fully testable without filesystem.
2. **Ports** — Interfaces defining what the domain needs (TaskRepository, ProcessRunner, etc.)
3. **Adapters** — Implementations of ports (FsTaskRepository, ClaudeProcessRunner, etc.)

### Environment Detection

Ralph behaves differently based on `.ralph/` config files found by walking up the directory tree:
- `.ralph/project.json` → Project environment (task mgmt, loop control)
- `.ralph/node.json` → Node environment (VPS-side)
- `.ralph/client.json` → Client environment (remote control via SSH)

### Data Split

- `.ralph/` — Git-tracked: tasks, config, type templates
- `.ralph-local/` — Gitignored: logs, state, sync manifest

## Conventions

- Bun runtime, ESM modules, strict TypeScript
- Tests: `bun test` (unit), `bun test:integration` (Docker)
- Typecheck: `bun run typecheck`
- Zod for schema validation, gray-matter for frontmatter parsing
- Commander.js for CLI
- Tasks stored as Markdown with YAML frontmatter in `.ralph/tasks/`
- tmux sessions are named `ralph-<project-name>`

## Testing

- `bun test` — Unit tests (148 tests across domain, adapters, CLI)
- `bun test:integration` — Docker-based integration tests (SSH, loop E2E)
- `bun run typecheck` — TypeScript type checking

## Key Design Decisions

- Hexagonal architecture separates domain logic from I/O
- Git as data plane (tasks synced via git), SSH as control plane (remote commands)
- Circuit breakers prevent runaway loops (max errors, stalls, cost, tokens, iterations)
- Task selection is deterministic: priority → order → created date
- Type system allows custom prompt templates per task type
- `ralph sync` copies built-in types to project with hash-based conflict detection
