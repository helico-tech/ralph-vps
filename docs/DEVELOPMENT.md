# Ralph v2 Development Guide

## Quick Start

```bash
# Install dependencies
bun install

# Run tests
bun test

# Typecheck
bun run typecheck

# Run CLI
bun run src/index.ts --help
bun run src/index.ts version
```

## Architecture

Ralph v2 uses hexagonal architecture (ports and adapters):

```
src/
├── domain/          # Pure business logic — no I/O
│   ├── task.ts          # Task types, transitions, validation
│   ├── task-serialization.ts  # Frontmatter parse/serialize
│   ├── task-selection.ts      # Next-task algorithm
│   ├── loop.ts               # Loop state machine, circuit breakers
│   ├── loop-engine.ts        # Orchestrator (wires ports together)
│   ├── config.ts             # Config Zod schemas
│   ├── types.ts              # Type definition interface
│   ├── log.ts                # Iteration log schema, cost estimation
│   ├── sync.ts               # Sync manifest, conflict detection
│   └── migration.ts          # Schema migration framework
├── ports/           # Interfaces — dependency inversion
│   ├── task-repository.ts
│   ├── task-selector.ts
│   ├── config-provider.ts
│   ├── log-store.ts
│   ├── process-runner.ts
│   ├── remote-executor.ts
│   ├── prompt-compiler.ts
│   ├── progress-detector.ts
│   └── git-synchronizer.ts
├── adapters/        # Implementations
│   ├── fs-config-provider.ts      # Walk-up directory detection
│   ├── fs-task-repository.ts      # .ralph/tasks/*.md
│   ├── priority-task-selector.ts  # Priority + order + date
│   ├── json-log-store.ts          # .ralph-local/logs/*.json
│   ├── template-prompt-compiler.ts # Placeholder substitution
│   ├── fs-type-resolver.ts        # Project > built-in fallback
│   ├── git-progress-detector.ts   # Git diff analysis
│   ├── claude-process-runner.ts   # Spawn claude, parse stream-json
│   ├── shell-git-synchronizer.ts  # Git pull/push via shell
│   ├── ssh-remote-executor.ts     # SSH command execution
│   └── fs-loop-state.ts          # .ralph-local/state.json
├── cli/             # Commander.js CLI
│   ├── index.ts         # Program setup, env detection, command wiring
│   └── commands/        # One file per command group
├── built-in/        # Shipped task type templates
│   └── types/{feature-dev,bug-fix,research,review}/
├── constants.ts     # Path constants
├── errors.ts        # Error hierarchy
└── index.ts         # Entry point
```

## Testing

### Unit Tests

```bash
# All unit tests
bun test

# Specific module
bun test src/domain/
bun test src/adapters/
bun test src/cli/
```

Tests use temp directories (no shared state) and mock adapters for domain testing.

### Integration Tests (Docker)

```bash
# Start Docker test container
docker compose -f docker-compose.test.yml up -d --build

# Run integration tests
bun test:integration

# Stop container
docker compose -f docker-compose.test.yml down -v
```

### Test Conventions

- Tests live next to source: `src/domain/__tests__/task.test.ts`
- Use `createTempDir()` / `cleanupTempDir()` from `src/__tests__/helpers/`
- Mock adapters in `src/__tests__/helpers/mock-adapters.ts`
- Git-based tests create temp repos with `git init`

## Adding a New Command

1. Create `src/cli/commands/<name>.ts` with a `register<Name>Command(program, ...)` function
2. Wire it in `src/cli/index.ts` (conditionally based on environment if needed)
3. Add tests in `src/cli/__tests__/<name>.test.ts`

## Adding a New Adapter

1. Define the port interface in `src/ports/<name>.ts` if it doesn't exist
2. Create `src/adapters/<name>.ts` implementing the interface
3. Add mock in `src/__tests__/helpers/mock-adapters.ts`
4. Add tests in `src/adapters/__tests__/<name>.test.ts`
5. Export from `src/adapters/index.ts`

## Adding a New Task Type

1. Create `src/built-in/types/<type-name>/prompt.md` (prompt template)
2. Create `src/built-in/types/<type-name>/template.md` (task body template)
3. Add the type to the `TaskType` Zod enum in `src/domain/task.ts`
4. Run `ralph sync` to deploy to projects
