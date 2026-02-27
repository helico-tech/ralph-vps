# ralph-vps — Claude Code Instructions

This repo contains shell scripts for managing autonomous Claude Code loops on a Hetzner VPS.

## Project Structure

- `bin/` — All management scripts (add/remove projects, start/stop loops, status, logs)
- `lib/common.sh` — Shared functions (colors, logging, validation, config loading)
- `templates/` — Scaffolding copied into new projects (PROMPT.md, project.conf, claude-settings.json)
- `config/` — Global configuration (ralph.conf.default is checked in, ralph.conf is gitignored)
- `setup-vps.sh` — One-time VPS bootstrap (root)
- `docs/` — Documentation

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
- `claude auth login` for authentication (no API keys)
- PROMPT.md re-read each iteration so tasks can be updated live
- Logs stored separately from project directories
- `--dangerously-skip-permissions` required for headless autonomous operation
