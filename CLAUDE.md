# ralph-vps — Claude Code Instructions

This repo contains shell scripts for managing autonomous Claude Code loops on a Hetzner VPS.

## Project Structure

- `bin/` — All management scripts (add/remove projects, start/stop loops, status, logs)
- `lib/common.sh` — Shared functions (colors, logging, validation, config loading)
- `templates/` — Scaffolding copied into new projects (PROMPT.md, project.conf, claude-settings.json)
- `config/` — Global configuration (ralph.conf.default is checked in, ralph.conf is gitignored)
- `setup-vps.sh` — Thin runner that sources phase scripts from `setup-vps/` in order
- `setup-vps/` — Numbered phase scripts (e.g. `10-system-packages.sh`, `20-nodejs.sh`) executed during VPS bootstrap
- `setup-project/` — Numbered phase scripts (e.g. `10-templates.sh`, `20-config.sh`) sourced by `bin/add-project.sh` during project scaffolding
- `docs/` — Documentation

### Extending VPS Setup

To add a new setup step (e.g. Docker, Python tools, Rust):
1. Create `setup-vps/<NN>-<name>.sh` where `<NN>` determines execution order
2. The runner auto-discovers all `setup-vps/[0-9][0-9]-*.sh` files
3. Phase scripts are sourced (not subshelled) — they share `SCRIPT_DIR`, `ACTUAL_USER`, `ACTUAL_HOME`, and all `lib/common.sh` functions
4. Every phase must be idempotent — check before acting so re-runs skip completed work

### Extending Project Setup

To add a new scaffolding step when adding a project:
1. Create `setup-project/<NN>-<name>.sh` where `<NN>` determines execution order
2. `bin/add-project.sh` auto-discovers all `setup-project/[0-9][0-9]-*.sh` files
3. Phase scripts are sourced (not subshelled) — they share `NAME`, `PROJECT_DIR`, `LOG_DIR`, `TEMPLATES_DIR`, `ROOT_DIR`, and all `lib/common.sh` functions
4. Each phase should be idempotent where possible

## Conventions

- All scripts use `#!/usr/bin/env bash` and `set -euo pipefail`
- All scripts source `lib/common.sh` for shared functions
- Use `log_info`, `log_warn`, `log_error`, `log_section` for output
- Project names: alphanumeric, hyphens, underscores only
- tmux sessions are named `ralph-<project-name>`
- Config files are bash-sourceable (no YAML/JSON parsing)

## Testing

- Run `shellcheck` on all `.sh` files before committing
- Test scripts manually — there are no automated tests

## Key Design Decisions

- No Docker — just SSH + tmux for simplicity
- Run `claude` once interactively to authenticate (no API keys)
- PROMPT.md re-read each iteration so tasks can be updated live
- Logs stored separately from project directories
- Permissions managed via `templates/claude-settings.json` (copied into each project)
