# ralph-vps

Manage multiple autonomous Claude Code ("Ralph") loops on a Hetzner VPS. Simple shell scripts, tmux sessions, no Docker required.

## Quickstart

```bash
# On your VPS (after initial setup)
cd ~/ralph-vps

# Add a project
./bin/add-project.sh my-app git@github.com:you/my-app.git

# Write the task
nano projects/my-app/PROMPT.md

# Start the loop
./bin/start-loop.sh my-app

# Watch it work
./bin/attach.sh my-app        # Ctrl+B, D to detach
./bin/logs.sh my-app -f       # Follow logs

# Check everything
./bin/status.sh
```

For full VPS setup instructions, see [docs/VPS-SETUP.md](docs/VPS-SETUP.md).

## Command Reference

| Command | Description |
|---------|-------------|
| `./bin/add-project.sh <name> <url>` | Clone a repo and set it up as a project |
| `./bin/remove-project.sh <name>` | Remove a project and its logs |
| `./bin/list-projects.sh` | List all projects with status |
| `./bin/start-loop.sh <name>` | Start a Claude loop in tmux |
| `./bin/stop-loop.sh <name>` | Gracefully stop a running loop |
| `./bin/restart-loop.sh <name>` | Stop + start a loop |
| `./bin/status.sh` | Dashboard: system resources + all projects |
| `./bin/attach.sh <name>` | Attach to a project's tmux session |
| `./bin/logs.sh <name> [lines\|-f]` | View or follow project logs |

## How It Works

Each project is a cloned GitHub repo with a `PROMPT.md` file describing the task. The ralph loop feeds this prompt to Claude Code repeatedly, letting it work autonomously.

```
ralph-vps/
├── bin/              # Management scripts
├── lib/              # Shared functions
├── templates/        # Scaffolding for new projects
├── config/           # Global configuration
├── projects/         # Cloned repos (gitignored)
└── logs/             # Loop output (gitignored)
```

## Configuration

### Global config: `config/ralph.conf`

Applies to all projects. Created from `config/ralph.conf.default` during setup.

### Per-project config: `projects/<name>/project.conf`

Overrides global config for a specific project.

| Setting | Default | Description |
|---------|---------|-------------|
| `MAX_TURNS` | `50` | Max tool calls per Claude session |
| `MAX_ITERATIONS` | `0` | Max loop iterations (0 = unlimited) |
| `PAUSE_BETWEEN_LOOPS` | `30` | Seconds between iterations |
| `RESTART_POLICY` | `on-exit` | `on-exit`, `on-success`, or `never` |
| `MODEL` | `""` | Model override (e.g., `sonnet`, `opus`) |
| `CLAUDE_EXTRA_FLAGS` | `""` | Extra flags for the claude command |

### Restart Policies

- **`on-exit`** — Always restart after Claude finishes (default)
- **`on-success`** — Only restart if Claude exits with code 0
- **`never`** — Run once and stop

## Updating PROMPT.md While Running

The loop re-reads `PROMPT.md` at the start of each iteration. Edit it anytime — the next iteration picks up your changes automatically.

## Updating ralph-vps Scripts

Develop locally, push to GitHub, then pull on the VPS:

```bash
# On VPS
cd ~/ralph-vps
git pull
```

Running loops are not affected. Restart them to pick up script changes:

```bash
./bin/restart-loop.sh my-app
```

## Troubleshooting

**Loop won't start: "PROMPT.md not found"**
Edit the prompt file: `nano projects/<name>/PROMPT.md`

**Claude authentication error**
Run `claude` and follow the on-screen instructions (as your user, not root).

**tmux session already exists**
Check with `./bin/status.sh`. Stop it with `./bin/stop-loop.sh <name>`.

**Out of memory on small VPS**
Run fewer concurrent loops. Each Claude session uses ~200-400MB. A CX22 (4GB) comfortably runs 2-3 loops.
