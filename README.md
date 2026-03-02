# Ralph

Autonomous Claude Code loop manager. Manages task-driven iterations of Claude Code with structured logging, circuit breakers, and remote control.

Built with Bun + TypeScript using hexagonal architecture.

## Quickstart

```bash
# Install dependencies
bun install

# Initialize a project
bun run src/index.ts init project my-app

# Add tasks
bun run src/index.ts task add "Setup database" --type feature-dev --priority 1
bun run src/index.ts task add "Add user model" --type feature-dev --depends-on <task-id>

# See what's next
bun run src/index.ts task next

# Start the autonomous loop
bun run src/index.ts loop start
```

## Commands

| Command | Description |
|---------|-------------|
| `ralph init project <name>` | Initialize a Ralph project |
| `ralph init node <hostname>` | Initialize a VPS node |
| `ralph init client` | Initialize client config |
| `ralph task add <title>` | Add a new task |
| `ralph task list` | List all tasks |
| `ralph task next` | Show next task the loop would pick |
| `ralph task edit <id>` | Edit a task in $EDITOR |
| `ralph loop start` | Start the loop in tmux |
| `ralph loop stop` | Stop the running loop |
| `ralph loop status` | Show loop state |
| `ralph loop attach` | Attach to the loop session |
| `ralph sync` | Sync built-in types to project |
| `ralph log list` | List recent iterations |
| `ralph log stats` | Show aggregate statistics |
| `ralph remote <node> <cmd>` | Execute command on remote node |
| `ralph node add/list/remove` | Manage remote nodes |
| `ralph version` | Show version and environment |

## Architecture

```
src/
├── domain/      # Pure business logic (no I/O)
├── ports/       # Interface definitions
├── adapters/    # Implementations (filesystem, git, SSH, Claude)
├── cli/         # Commander.js CLI
└── built-in/    # Task type templates
```

Three environments detected by config files in `.ralph/`:
- **Project** (`project.json`) — Task management + loop control
- **Node** (`node.json`) — VPS-side operation
- **Client** (`client.json`) — Remote control via SSH

Data split:
- `.ralph/` — Git-tracked (tasks, config, types)
- `.ralph-local/` — Gitignored (logs, state)

## Development

```bash
bun test              # Unit tests (148 tests)
bun run typecheck     # TypeScript checks
bun test:integration  # Docker-based integration tests
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full development guide.
