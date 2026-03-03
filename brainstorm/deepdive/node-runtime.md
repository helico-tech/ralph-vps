# Deep Dive: Node Runtime

> **node-runtime** specialist | Architecture B deep-dive | 2026-03-03

---

## Premise: Docker Is an Adapter, Not the Architecture

The orchestrator doesn't care WHERE it runs. It needs a runtime contract fulfilled by the environment. Docker is one adapter. A bare VPS is another. Your laptop is a third. The orchestrator code should contain ZERO references to Docker, systemd, or any deployment mechanism. All environment-specific configuration enters via environment variables or a config file.

If you find yourself writing `if (process.env.DOCKER === 'true')` in the orchestrator, you've failed.

---

## 1. The Runtime Contract

### What the Orchestrator NEEDS from Its Environment

The orchestrator is a TypeScript/Bun process that polls a git repo, runs Claude Code CLI, and pushes results. Here's what it requires:

| Requirement | Why | How to Check |
|------------|-----|-------------|
| **git >= 2.25** | `git mv`, `--ff-only`, branch operations | `git --version` |
| **git authenticated** | Push/pull to remote | `git ls-remote origin HEAD` (exits 0) |
| **bun >= 1.1** (or node >= 20) | Orchestrator runtime | `bun --version` or `node --version` |
| **claude CLI** | Execute tasks | `claude --version` |
| **claude authenticated** | API access | `ANTHROPIC_API_KEY` is set, or `claude auth status` |
| **Network: Anthropic API** | Claude Code needs it | `curl -sf https://api.anthropic.com/ -o /dev/null` |
| **Network: git remote** | Push/pull | `git ls-remote origin HEAD` |
| **SSH keys or HTTPS creds** | Git auth | `ssh -T git@github.com` or HTTPS token in remote URL |
| **Writable filesystem** | Logs, heartbeat, workspace | `touch /tmp/ralph-write-test && rm /tmp/ralph-write-test` |

### Optional (Project-Dependent)

| Requirement | When Needed | How to Check |
|------------|-------------|-------------|
| **npm/bun** (as package manager) | If target project uses Node.js | `npm --version` / `bun --version` |
| **test framework** | If verification runs tests | `npm test -- --version` or similar |
| **build tools** | If verification runs build | `npm run build -- --version` or similar |
| **python** | If target project is Python | `python3 --version` |

### `ralph doctor`: The Contract Checker

A `ralph doctor` command checks every requirement and reports pass/fail. This runs on any environment -- laptop, Docker, VPS -- and tells you exactly what's missing.

```typescript
// src/doctor.ts
interface Check {
  name: string
  description: string
  required: boolean
  check: () => Promise<{ ok: boolean; detail: string }>
}

const checks: Check[] = [
  {
    name: 'git',
    description: 'Git >= 2.25 installed',
    required: true,
    check: async () => {
      const result = await $`git --version`.quiet().nothrow()
      if (result.exitCode !== 0) return { ok: false, detail: 'git not found' }
      const version = result.stdout.match(/(\d+\.\d+)/)?.[1]
      const [major, minor] = (version ?? '0.0').split('.').map(Number)
      return {
        ok: major > 2 || (major === 2 && minor >= 25),
        detail: `git ${version}`,
      }
    },
  },
  {
    name: 'git-auth',
    description: 'Git remote is accessible',
    required: true,
    check: async () => {
      const result = await $`git ls-remote origin HEAD`.quiet().nothrow()
      return {
        ok: result.exitCode === 0,
        detail: result.exitCode === 0 ? 'Remote accessible' : 'Cannot reach remote',
      }
    },
  },
  {
    name: 'bun',
    description: 'Bun runtime installed',
    required: true,
    check: async () => {
      const result = await $`bun --version`.quiet().nothrow()
      return {
        ok: result.exitCode === 0,
        detail: result.exitCode === 0 ? `bun ${result.stdout.trim()}` : 'bun not found',
      }
    },
  },
  {
    name: 'claude-cli',
    description: 'Claude Code CLI installed',
    required: true,
    check: async () => {
      const result = await $`claude --version`.quiet().nothrow()
      return {
        ok: result.exitCode === 0,
        detail: result.exitCode === 0 ? `claude ${result.stdout.trim()}` : 'claude not found',
      }
    },
  },
  {
    name: 'claude-auth',
    description: 'Claude API key configured',
    required: true,
    check: async () => {
      const hasKey = !!process.env.ANTHROPIC_API_KEY
      return {
        ok: hasKey,
        detail: hasKey ? 'ANTHROPIC_API_KEY is set' : 'ANTHROPIC_API_KEY not set',
      }
    },
  },
  {
    name: 'network-anthropic',
    description: 'Can reach Anthropic API',
    required: true,
    check: async () => {
      const result = await $`curl -sf --max-time 5 https://api.anthropic.com/ -o /dev/null`.quiet().nothrow()
      return {
        ok: result.exitCode === 0,
        detail: result.exitCode === 0 ? 'Reachable' : 'Cannot reach api.anthropic.com',
      }
    },
  },
]

export async function runDoctor(): Promise<boolean> {
  let allPassed = true
  for (const check of checks) {
    const result = await check.check()
    const icon = result.ok ? 'PASS' : check.required ? 'FAIL' : 'WARN'
    console.log(`[${icon}] ${check.name}: ${result.detail}`)
    if (!result.ok && check.required) allPassed = false
  }
  return allPassed
}
```

Usage:
```bash
# On any machine
bun run src/doctor.ts

# Output:
# [PASS] git: git 2.43
# [PASS] git-auth: Remote accessible
# [PASS] bun: bun 1.1.38
# [PASS] claude-cli: claude 1.0.18
# [PASS] claude-auth: ANTHROPIC_API_KEY is set
# [PASS] network-anthropic: Reachable
```

The doctor is the FIRST thing the entrypoint runs -- in Docker, on a VPS, or on your laptop. If it fails, the orchestrator refuses to start. No guessing, no silent failures.

---

## 2. Adapter: Docker

### Dockerfile

```dockerfile
FROM oven/bun:1-slim AS base

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    openssh-client \
    curl \
    ca-certificates \
    jq \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally via npm (bun global install works too)
# Claude Code is distributed as an npm package
RUN bun install -g @anthropic-ai/claude-code@latest

# Create non-root user
RUN groupadd -r ralph && useradd -r -g ralph -m -s /bin/bash ralph

# Setup directories
RUN mkdir -p /home/ralph/workspace /home/ralph/.ssh /home/ralph/logs \
    && chown -R ralph:ralph /home/ralph

USER ralph
WORKDIR /home/ralph/workspace

# Copy orchestrator code
COPY --chown=ralph:ralph package.json bun.lockb tsconfig.json ./
COPY --chown=ralph:ralph src/ ./src/

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy entrypoint
COPY --chown=ralph:ralph docker/entrypoint.sh /home/ralph/entrypoint.sh
RUN chmod +x /home/ralph/entrypoint.sh

# Health check: verify heartbeat file is recent (updated within last 5 minutes)
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD test -f /home/ralph/heartbeat.json && \
        test $(( $(date +%s) - $(date -d "$(jq -r .timestamp /home/ralph/heartbeat.json)" +%s) )) -lt 300

ENTRYPOINT ["/home/ralph/entrypoint.sh"]
```

### Entrypoint Script

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[ralph] Starting up..."

# --- SSH key setup ---
# Docker volume mounts don't preserve Unix permissions on macOS/Windows.
# Copy keys and fix permissions.
if [ -d /home/ralph/.ssh-mount ]; then
    cp /home/ralph/.ssh-mount/* /home/ralph/.ssh/ 2>/dev/null || true
    chmod 700 /home/ralph/.ssh
    chmod 600 /home/ralph/.ssh/id_* 2>/dev/null || true
    chmod 644 /home/ralph/.ssh/*.pub 2>/dev/null || true
fi

# --- known_hosts setup ---
# Pre-populate known_hosts to avoid interactive SSH prompt
if [ ! -f /home/ralph/.ssh/known_hosts ]; then
    ssh-keyscan -t ed25519,rsa github.com >> /home/ralph/.ssh/known_hosts 2>/dev/null
    ssh-keyscan -t ed25519,rsa gitlab.com >> /home/ralph/.ssh/known_hosts 2>/dev/null
fi

# --- Git config ---
git config --global user.name "${GIT_AUTHOR_NAME:-Ralph}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-ralph@helico.dev}"
git config --global init.defaultBranch main

# --- Clone or verify workspace ---
if [ ! -d /home/ralph/workspace/.git ]; then
    if [ -n "${TASK_REPO_URL:-}" ]; then
        echo "[ralph] Cloning repository..."
        git clone "$TASK_REPO_URL" /home/ralph/workspace
    else
        echo "[ralph] ERROR: No .git directory and TASK_REPO_URL not set"
        exit 1
    fi
fi

# --- Run doctor check ---
echo "[ralph] Running health checks..."
cd /home/ralph/workspace
bun run src/doctor.ts || {
    echo "[ralph] FATAL: Doctor check failed. Fix the issues above and restart."
    exit 1
}

# --- Start orchestrator ---
echo "[ralph] Starting orchestrator..."
exec bun run src/index.ts
```

Key points:
- SSH keys are COPIED from mount, not used directly (fixes macOS/Windows permission issues -- infra-ops flagged this exact problem)
- `known_hosts` is pre-populated (no interactive "Are you sure you want to connect?" prompt)
- Doctor runs before orchestrator starts
- `exec` replaces the shell with the bun process (proper signal forwarding)

### docker-compose.yml

```yaml
services:
  ralph:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: ralph-worker
    restart: unless-stopped

    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TASK_REPO_URL=${TASK_REPO_URL}
      - GIT_AUTHOR_NAME=${GIT_AUTHOR_NAME:-Ralph}
      - GIT_AUTHOR_EMAIL=${GIT_AUTHOR_EMAIL:-ralph@helico.dev}
      - POLL_INTERVAL=${POLL_INTERVAL:-30}
      - MAX_TASK_TIMEOUT=${MAX_TASK_TIMEOUT:-1800}
      - LOG_LEVEL=${LOG_LEVEL:-info}

    volumes:
      # SSH keys: mounted read-only, copied in entrypoint
      - ./ssh-keys:/home/ralph/.ssh-mount:ro
      # Persist workspace across restarts (avoids re-clone)
      - ralph-workspace:/home/ralph/workspace
      # Persist logs
      - ralph-logs:/home/ralph/logs

    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"

    # Memory limit: prevent runaway processes from killing the VPS
    deploy:
      resources:
        limits:
          memory: 2G

volumes:
  ralph-workspace:
  ralph-logs:
```

### Multi-Container: Multiple Orchestrators

```yaml
services:
  ralph-frontend:
    build: .
    container_name: ralph-frontend
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TASK_REPO_URL=${FRONTEND_REPO_URL}
      - GIT_AUTHOR_NAME=Ralph (Frontend)
      - GIT_AUTHOR_EMAIL=ralph-frontend@helico.dev
    volumes:
      - ./ssh-keys:/home/ralph/.ssh-mount:ro
      - ralph-frontend-workspace:/home/ralph/workspace
      - ralph-frontend-logs:/home/ralph/logs
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  ralph-backend:
    build: .
    container_name: ralph-backend
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TASK_REPO_URL=${BACKEND_REPO_URL}
      - GIT_AUTHOR_NAME=Ralph (Backend)
      - GIT_AUTHOR_EMAIL=ralph-backend@helico.dev
    volumes:
      - ./ssh-keys:/home/ralph/.ssh-mount:ro
      - ralph-backend-workspace:/home/ralph/workspace
      - ralph-backend-logs:/home/ralph/logs
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  ralph-frontend-workspace:
  ralph-frontend-logs:
  ralph-backend-workspace:
  ralph-backend-logs:
```

Each orchestrator gets its own workspace volume, its own log volume, and points at a different repo. They share the same SSH keys and API key. They are completely independent -- no shared state, no coordination, no conflicts.

### Docker Commands Cheat Sheet

```bash
# Build
docker compose build

# Run (detached)
docker compose up -d

# Check logs (follow)
docker compose logs -f ralph

# Check health
docker inspect --format='{{.State.Health.Status}}' ralph-worker

# Stop gracefully (sends SIGTERM, waits 10s, then SIGKILL)
docker compose stop

# Restart
docker compose restart

# Full rebuild + restart
docker compose up -d --build

# Shell into running container (for debugging)
docker compose exec ralph bash

# Check resource usage
docker stats ralph-worker
```

---

## 3. Adapter: Bare VPS

### Setup Script

```bash
#!/usr/bin/env bash
# setup-vps.sh -- Run this once on a fresh VPS (Ubuntu 22.04+/Debian 12+)
set -euo pipefail

echo "=== Ralph VPS Setup ==="

# --- Install Bun ---
if ! command -v bun &>/dev/null; then
    echo "[1/5] Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
    echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
else
    echo "[1/5] Bun already installed: $(bun --version)"
fi

# --- Install Git (likely already present) ---
if ! command -v git &>/dev/null; then
    echo "[2/5] Installing git..."
    sudo apt-get update && sudo apt-get install -y git
else
    echo "[2/5] Git already installed: $(git --version)"
fi

# --- Install Claude Code CLI ---
if ! command -v claude &>/dev/null; then
    echo "[3/5] Installing Claude Code CLI..."
    bun install -g @anthropic-ai/claude-code@latest
else
    echo "[3/5] Claude CLI already installed: $(claude --version)"
fi

# --- Clone orchestrator repo ---
RALPH_DIR="${RALPH_DIR:-$HOME/ralph-vps}"
if [ ! -d "$RALPH_DIR" ]; then
    echo "[4/5] Cloning orchestrator..."
    git clone "${RALPH_REPO_URL:-https://github.com/helico/ralph-vps.git}" "$RALPH_DIR"
    cd "$RALPH_DIR"
    bun install
else
    echo "[4/5] Orchestrator already cloned at $RALPH_DIR"
fi

# --- Setup .env ---
if [ ! -f "$RALPH_DIR/.env" ]; then
    echo "[5/5] Creating .env from template..."
    cp "$RALPH_DIR/.env.example" "$RALPH_DIR/.env"
    echo ""
    echo "IMPORTANT: Edit $RALPH_DIR/.env and set:"
    echo "  - ANTHROPIC_API_KEY"
    echo "  - TASK_REPO_URL"
    echo ""
else
    echo "[5/5] .env already exists"
fi

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Edit $RALPH_DIR/.env"
echo "  2. Set up SSH keys for git (see docs)"
echo "  3. Run: cd $RALPH_DIR && bun run start"
```

### Process Management

Three options, in order of recommendation:

#### Option A: systemd Service (Recommended)

systemd is already running on every modern Linux VPS. It handles restarts, logging, and process lifecycle. This is the correct tool.

```ini
# /etc/systemd/system/ralph.service
[Unit]
Description=Ralph Orchestrator
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ralph
Group=ralph
WorkingDirectory=/home/ralph/ralph-vps
EnvironmentFile=/home/ralph/ralph-vps/.env
ExecStart=/home/ralph/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=30
StartLimitBurst=5
StartLimitIntervalSec=300

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ralph

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/home/ralph

[Install]
WantedBy=multi-user.target
```

Commands:
```bash
# Install the service
sudo cp ralph.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ralph
sudo systemctl start ralph

# Check status
sudo systemctl status ralph

# View logs (follows)
sudo journalctl -u ralph -f

# View logs (last 100 lines)
sudo journalctl -u ralph -n 100

# Restart
sudo systemctl restart ralph

# Stop
sudo systemctl stop ralph
```

Benefits:
- Automatic restart on crash (with backoff: 30s, max 5 in 5min)
- Logs go to journald (queryable, rotated automatically)
- Starts on boot
- Process isolation via systemd security directives
- Survives SSH disconnect automatically

#### Option B: Simple nohup + Bash (Quick and Dirty)

For when you just want it running NOW and don't care about proper process management.

```bash
# Start in background, survive SSH disconnect
cd ~/ralph-vps
nohup bun run src/index.ts >> ~/ralph.log 2>&1 &
echo $! > ~/ralph.pid

# Check if running
kill -0 $(cat ~/ralph.pid) 2>/dev/null && echo "Running" || echo "Stopped"

# Stop
kill $(cat ~/ralph.pid)

# View logs
tail -f ~/ralph.log
```

This works but: no automatic restart on crash, no log rotation, no boot start. It's the "just testing on a VPS" option, not the production option.

#### Option C: pm2 (If You Already Know It)

```bash
# Install pm2
bun install -g pm2

# Start
pm2 start src/index.ts --name ralph --interpreter bun

# Auto-restart on reboot
pm2 startup
pm2 save

# Logs
pm2 logs ralph

# Status
pm2 status
```

pm2 is fine but it's another dependency. systemd is already there. Don't add things you don't need.

### How to Update

```bash
cd ~/ralph-vps
git pull origin main
bun install

# If using systemd:
sudo systemctl restart ralph

# If using nohup:
kill $(cat ~/ralph.pid)
nohup bun run src/index.ts >> ~/ralph.log 2>&1 &
echo $! > ~/ralph.pid
```

Could be wrapped in a simple script:
```bash
#!/usr/bin/env bash
# update.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull origin main
bun install
sudo systemctl restart ralph
echo "Updated and restarted."
```

### Running Multiple Orchestrators on Bare VPS

Create multiple systemd units:

```bash
# /etc/systemd/system/ralph@.service (template unit)
[Unit]
Description=Ralph Orchestrator (%i)
After=network-online.target

[Service]
Type=simple
User=ralph
WorkingDirectory=/home/ralph/ralph-vps
EnvironmentFile=/home/ralph/ralph-vps/.env.%i
ExecStart=/home/ralph/.bun/bin/bun run src/index.ts
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
# Each instance gets its own .env file
# .env.frontend, .env.backend, etc.

sudo systemctl enable ralph@frontend
sudo systemctl enable ralph@backend
sudo systemctl start ralph@frontend
sudo systemctl start ralph@backend

# Logs for specific instance
sudo journalctl -u ralph@frontend -f
```

---

## 4. Common: Authentication

### Git SSH Key Setup

```bash
# Generate a dedicated deploy key (on the VPS or in Docker)
ssh-keygen -t ed25519 -C "ralph-deploy@helico.dev" -f ~/.ssh/id_ralph -N ""

# Add the public key to the GitHub repo:
# GitHub -> Repo -> Settings -> Deploy Keys -> Add deploy key
# Paste contents of ~/.ssh/id_ralph.pub
# Check "Allow write access"

# Configure SSH to use this key for GitHub
cat >> ~/.ssh/config << 'EOF'
Host github.com
    IdentityFile ~/.ssh/id_ralph
    IdentitiesOnly yes
    StrictHostKeyChecking accept-new
EOF

# Verify
ssh -T git@github.com
# "Hi helico/your-repo! You've been granted access."
```

### known_hosts: No Interactive Prompts

```bash
# Pre-populate known_hosts (run once)
ssh-keyscan -t ed25519,rsa github.com >> ~/.ssh/known_hosts 2>/dev/null
ssh-keyscan -t ed25519,rsa gitlab.com >> ~/.ssh/known_hosts 2>/dev/null
```

Or use `StrictHostKeyChecking accept-new` in SSH config (accepts new keys, rejects changed keys -- reasonable security).

### Claude Code Authentication

```bash
# Option 1: API key (recommended for automated loops)
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Option 2: Max subscription (interactive login, then persist credentials)
claude login
# Credentials stored in ~/.claude/
# In Docker: mount ~/.claude/ as a volume
```

API key is strongly recommended for automated loops:
- No rate limits from subscription tier
- Pay-as-you-go is predictable for automation
- No session expiry or refresh token issues
- Can set billing alerts

### .env File Structure

```bash
# .env.example (committed to git)

# Required
ANTHROPIC_API_KEY=
TASK_REPO_URL=

# Git identity
GIT_AUTHOR_NAME=Ralph
GIT_AUTHOR_EMAIL=ralph@helico.dev

# Orchestrator config
POLL_INTERVAL=30          # seconds between polling
MAX_TASK_TIMEOUT=1800     # 30 minutes per task
LOG_LEVEL=info            # debug, info, warn, error

# Claude Code config
CLAUDE_MODEL=opus         # model to use
CLAUDE_MAX_TURNS=50       # max tool calls per task
CLAUDE_MAX_BUDGET=5.00    # max $ per task
```

```gitignore
# .gitignore (excerpt)
.env
.env.*
!.env.example
ssh-keys/
```

### Secret Management: The Rules

1. **Never in git.** Not in the image, not in the Dockerfile, not in docker-compose.yml, not in a "config" commit.
2. **Never in the Docker image.** No `COPY .env` or `ENV ANTHROPIC_API_KEY=...` in the Dockerfile. Environment variables are injected at runtime.
3. **`.env` file on the host.** For v1, this is fine. A file with `chmod 600` on a single VPS.
4. **Docker secrets** (via compose or swarm) for v2 if needed. But `.env` is adequate for a single-machine setup.

---

## 5. Common: Health Checks & Heartbeat

### The Heartbeat File

The orchestrator writes a `heartbeat.json` to disk (NOT to git) every poll cycle. This is the canonical "is it alive?" signal.

```typescript
// Written by the orchestrator every loop iteration
interface Heartbeat {
  timestamp: string       // ISO 8601
  state: 'idle' | 'polling' | 'claiming' | 'executing' | 'verifying' | 'pushing'
  uptime_seconds: number
  active_task: string | null  // task ID or null
  last_task_completed: string | null
  last_task_completed_at: string | null
  total_tasks_completed: number
  total_tasks_failed: number
  version: string         // orchestrator version
  pid: number
}
```

Example:
```json
{
  "timestamp": "2026-03-03T14:30:00Z",
  "state": "executing",
  "uptime_seconds": 3600,
  "active_task": "task-20260303-001",
  "last_task_completed": "task-20260303-000",
  "last_task_completed_at": "2026-03-03T14:15:00Z",
  "total_tasks_completed": 5,
  "total_tasks_failed": 1,
  "version": "0.1.0",
  "pid": 12345
}
```

### Reading the Heartbeat

```bash
# From your laptop (via SSH)
ssh vps 'cat /home/ralph/heartbeat.json' | jq .

# Or with Docker
ssh vps 'docker exec ralph-worker cat /home/ralph/heartbeat.json' | jq .

# Quick "is it alive?" check
ssh vps 'cat /home/ralph/heartbeat.json | jq -r .state'
```

### Docker HEALTHCHECK

In the Dockerfile (already shown above):
```dockerfile
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD test -f /home/ralph/heartbeat.json && \
        test $(( $(date +%s) - $(stat -c %Y /home/ralph/heartbeat.json) )) -lt 300
```

Translation: "The heartbeat file exists AND was modified within the last 5 minutes." If the orchestrator is alive and looping, the heartbeat is fresh. If it's hung (deadlock, infinite loop in Claude execution), the heartbeat goes stale and Docker marks the container unhealthy.

Note: We use `stat -c %Y` (file modification time) instead of parsing the JSON timestamp. Simpler, no `jq` dependency in the healthcheck, and if the file is being written, it's recent.

### systemd Equivalent

systemd's `WatchdogSec` directive does the same thing:

```ini
# In ralph.service
[Service]
WatchdogSec=300
# Orchestrator must call sd_notify("WATCHDOG=1") every <300s
# Or simpler: Type=notify and have the process send READY=1 on startup
```

For v1, the systemd approach is simpler: rely on `Restart=on-failure` and check the heartbeat file manually via SSH. systemd watchdog integration is a v2 nicety.

---

## 6. Common: Log Management

### Structured JSON Logs

Every log event is a single JSON line. No multi-line exceptions, no unstructured text. This makes logs greppable, parseable, and forwardable.

```typescript
// src/logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEvent {
  timestamp: string
  level: LogLevel
  event: string
  task_id?: string
  detail?: Record<string, unknown>
}

function log(level: LogLevel, event: string, detail?: Record<string, unknown>) {
  const entry: LogEvent = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...detail,
  }
  const line = JSON.stringify(entry)

  // To stdout (Docker captures this, systemd captures this)
  console.log(line)

  // Optionally to file (for bare VPS without journald)
  if (logFile) {
    appendFileSync(logFile, line + '\n')
  }
}
```

### What Events to Log

| Event | Level | When |
|-------|-------|------|
| `orchestrator.started` | info | Startup, after doctor passes |
| `orchestrator.polling` | debug | Each poll cycle start |
| `orchestrator.idle` | debug | No tasks found |
| `task.claimed` | info | Task moved to active |
| `task.execution.started` | info | Claude CLI invoked |
| `task.execution.tool_call` | debug | Each tool call (if streaming) |
| `task.execution.completed` | info | Claude CLI exited |
| `task.verification.started` | info | Running tests/build |
| `task.verification.passed` | info | Tests passed |
| `task.verification.failed` | warn | Tests failed |
| `task.completed` | info | Task moved to review/done |
| `task.failed` | warn | Task moved to failed |
| `task.retry` | info | Task returned to pending |
| `git.pull` | debug | Git pull executed |
| `git.push.success` | debug | Git push succeeded |
| `git.push.failed` | warn | Git push failed (conflict?) |
| `heartbeat.written` | debug | Heartbeat updated |
| `error.unhandled` | error | Unexpected error |
| `orchestrator.shutdown` | info | Graceful shutdown initiated |

### Log Rotation

**Docker:** Handled by the logging driver config in docker-compose.yml:
```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"  # Rotate at 10MB
    max-file: "5"    # Keep 5 files (50MB total max)
```

**Bare VPS with systemd:** journald handles rotation automatically. Default is 10% of disk or 4GB, whichever is smaller. Fine.

**Bare VPS with file logging:** Use logrotate:
```
# /etc/logrotate.d/ralph
/home/ralph/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 ralph ralph
    postrotate
        # Signal the process to reopen log files (if needed)
        kill -USR1 $(cat /home/ralph/ralph.pid) 2>/dev/null || true
    endscript
}
```

### Accessing Logs from the Client

```bash
# Docker
ssh vps 'docker compose logs -f --tail 100 ralph'

# systemd
ssh vps 'sudo journalctl -u ralph -f -n 100'

# File-based
ssh vps 'tail -f /home/ralph/logs/ralph.log'

# Search for specific task
ssh vps 'docker compose logs ralph 2>&1 | grep task-20260303-001'

# Parse structured logs with jq
ssh vps 'docker compose logs ralph 2>&1 | jq -r "select(.level == \"error\")"'
```

---

## 7. Common: Graceful Shutdown

### Signal Handling

The orchestrator must handle SIGTERM (sent by `docker stop`, `systemctl stop`, `kill`).

```typescript
// src/index.ts
let shutdownRequested = false
let currentPhase: 'idle' | 'claiming' | 'executing' | 'verifying' | 'pushing' = 'idle'

process.on('SIGTERM', () => {
  log('info', 'orchestrator.shutdown', { reason: 'SIGTERM received' })
  shutdownRequested = true

  // If idle or between tasks: exit immediately
  if (currentPhase === 'idle') {
    process.exit(0)
  }

  // If mid-execution: let the current phase finish, then exit
  // The main loop checks shutdownRequested after each phase
})

process.on('SIGINT', () => {
  // Same as SIGTERM for graceful shutdown
  process.on('SIGTERM', () => {}).emit('SIGTERM')
})
```

### Shutdown Behavior by Phase

| Phase | On SIGTERM | Consequence |
|-------|-----------|-------------|
| **idle** (sleeping/polling) | Exit immediately | Clean. No work in progress. |
| **claiming** (git mv + push) | Finish claim, then exit | Task is claimed but not executed. On next startup, crash recovery handles it. |
| **executing** (Claude CLI running) | Kill Claude process, mark task as pending (retry) | Claude's partial work is on a branch. The task gets retried fresh. |
| **verifying** (running tests) | Wait for verification to finish, then exit | Verification is fast (~30s). Worth waiting. |
| **pushing** (git push) | Wait for push to finish, then exit | Don't interrupt a push. Corrupted git state is worse than a 5s delay. |

### Killing Claude Mid-Execution

```typescript
async function executeWithGracefulShutdown(
  task: Task,
  claudeProcess: ChildProcess
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const checkShutdown = setInterval(() => {
      if (shutdownRequested) {
        clearInterval(checkShutdown)
        log('warn', 'task.execution.aborted', { task_id: task.id, reason: 'shutdown' })
        claudeProcess.kill('SIGTERM')

        // Give Claude 10s to clean up, then force kill
        setTimeout(() => {
          if (!claudeProcess.killed) {
            claudeProcess.kill('SIGKILL')
          }
        }, 10_000)

        resolve({ status: 'aborted', exitCode: -1 })
      }
    }, 1000)

    claudeProcess.on('exit', (code) => {
      clearInterval(checkShutdown)
      resolve({ status: code === 0 ? 'success' : 'failed', exitCode: code ?? -1 })
    })
  })
}
```

### Docker Stop Timeout

`docker stop` sends SIGTERM, waits 10 seconds, then SIGKILL. For Ralph, 10s is enough to finish most phases. If Claude is mid-execution, it gets killed and the task is retried.

For longer grace periods:
```yaml
services:
  ralph:
    stop_grace_period: 30s  # Wait up to 30s before SIGKILL
```

### State After Ungraceful Kill (SIGKILL / OOM / Power Loss)

If the process is killed without SIGTERM:
- Task is stuck in `active/` directory
- Working branch may have partial commits
- Heartbeat is stale

This is handled by crash recovery (next section).

---

## 8. Common: Crash Recovery

### On Startup: Check for Orphaned Tasks

Every time the orchestrator starts, it checks for tasks that were left in `active/` from a previous crash.

```typescript
// src/crash-recovery.ts
async function recoverOrphanedTasks(): Promise<void> {
  const activeDir = path.join(RALPH_DIR, 'active')
  const activeTasks = await readdir(activeDir)

  for (const taskFile of activeTasks) {
    const task = await parseTask(path.join(activeDir, taskFile))
    log('warn', 'crash-recovery.orphan-found', { task_id: task.id })

    if (task.retryCount < task.maxRetries) {
      // Return to pending for retry
      task.retryCount++
      await writeTask(task) // update retry count in frontmatter
      await gitMv(
        path.join(activeDir, taskFile),
        path.join(RALPH_DIR, 'pending', taskFile)
      )
      await gitCommit(`ralph(${task.id}): crash recovery, retry ${task.retryCount}/${task.maxRetries}`)
      log('info', 'crash-recovery.retried', { task_id: task.id, retry: task.retryCount })
    } else {
      // Max retries exhausted, move to failed
      await gitMv(
        path.join(activeDir, taskFile),
        path.join(RALPH_DIR, 'failed', taskFile)
      )
      await gitCommit(`ralph(${task.id}): crash recovery, permanently failed after ${task.maxRetries} retries`)
      log('warn', 'crash-recovery.failed', { task_id: task.id })
    }
  }

  if (activeTasks.length > 0) {
    await gitPush()
  }
}
```

### Clean Working Tree

After a crash, the working tree may be dirty (uncommitted changes, untracked files, partial merges).

```typescript
async function cleanWorkingTree(): Promise<void> {
  // Check if we're in a detached HEAD or on a task branch
  const branch = await getCurrentBranch()

  if (branch !== 'main') {
    log('warn', 'crash-recovery.wrong-branch', { branch })
    // Abandon the task branch, go back to main
    await $`git checkout main`.nothrow()
  }

  // Discard any uncommitted changes
  await $`git reset --hard origin/main`

  // Remove untracked files (but not ignored ones)
  await $`git clean -fd`

  log('info', 'crash-recovery.tree-cleaned')
}
```

### Stale Branch Cleanup

Task branches from previous crashes may linger. Clean up branches whose tasks are no longer active:

```typescript
async function cleanStaleBranches(): Promise<void> {
  const result = await $`git branch --list ralph/*`.quiet()
  const branches = result.stdout.trim().split('\n').filter(Boolean).map(b => b.trim())

  for (const branch of branches) {
    const taskId = branch.replace('ralph/', '')
    const isActive = await taskExistsInDirectory('active', taskId)
    const isPending = await taskExistsInDirectory('pending', taskId)

    if (!isActive && !isPending) {
      // Task is done/failed/review -- branch can be cleaned up locally
      await $`git branch -D ${branch}`.nothrow()
      log('info', 'crash-recovery.branch-cleaned', { branch })
    }
  }
}
```

### Full Recovery Sequence (On Startup)

```typescript
async function startup() {
  // 1. Run doctor
  const healthy = await runDoctor()
  if (!healthy) process.exit(1)

  // 2. Ensure we're on main and up to date
  await cleanWorkingTree()
  await $`git pull --rebase origin main`

  // 3. Recover orphaned tasks
  await recoverOrphanedTasks()

  // 4. Clean stale branches
  await cleanStaleBranches()

  // 5. Start the main loop
  await mainLoop()
}
```

---

## 9. Performance & Resources

### Memory

| Component | RAM (idle) | RAM (active) | Notes |
|-----------|-----------|-------------|-------|
| **Bun runtime** | ~30 MB | ~50 MB | Orchestrator process |
| **Claude CLI** | 0 | ~200-400 MB | Only during task execution |
| **Git operations** | ~20 MB | ~100 MB | Spikes during large diffs |
| **OS overhead** | ~200 MB | ~200 MB | Linux kernel, systemd, etc. |
| **Docker overhead** | ~100 MB | ~100 MB | If using Docker |
| **Total (Docker)** | ~350 MB | ~850 MB | Single orchestrator |
| **Total (bare VPS)** | ~250 MB | ~750 MB | Single orchestrator |

A Hetzner CX22 (4 GB RAM) has plenty of headroom for one orchestrator. Two orchestrators can run comfortably. Three is tight but feasible.

### CPU

The orchestrator is almost entirely I/O-bound:
- **Idle:** 0% CPU. Sleeping between polls.
- **Polling:** Negligible. `git pull` + `ls` is instant.
- **Executing:** ~5-10% CPU. Claude CLI is waiting for API responses most of the time. CPU spikes only when Claude runs `npm test` or `npm run build` inside the task.
- **Git push:** Brief CPU spike for delta computation.

A 2 vCPU machine is more than sufficient. CPU is never the bottleneck.

### Disk

| Item | Size | Growth Rate | Mitigation |
|------|------|-------------|-----------|
| **OS + tools** | ~2 GB | Static | -- |
| **Docker** | ~1 GB | Static | -- |
| **Orchestrator code** | ~10 MB | Negligible | -- |
| **Git repo (workspace)** | 100 MB - 2 GB | Depends on project | `git gc` periodically |
| **Logs** | 10-50 MB/day | Continuous | Rotation (50MB cap) |
| **Node modules** | 100-500 MB | Per project | -- |
| **Task branches** | ~5 MB each | Per task | Clean stale branches |

On a 40 GB disk (Hetzner CX22), disk is not a concern for months. Add periodic `git gc` to the maintenance cycle:

```typescript
// Run git gc every 24 hours
async function periodicMaintenance() {
  await $`git gc --auto`
  log('debug', 'maintenance.git-gc')
}
```

### Network

| Operation | Frequency | Bandwidth | Notes |
|-----------|-----------|-----------|-------|
| **git pull** | Every 30s | ~1 KB (no changes) to ~100 KB | Fast-forward only |
| **git push** | Per task (claim + complete) | ~1-10 KB | Small commits |
| **Claude API calls** | During execution | ~10-500 KB per task | Mostly text, some tool outputs |
| **Total per day** | -- | ~50-200 MB | Very low |

Hetzner CX22 includes 20 TB traffic. Network is a non-issue.

---

## 10. Multiple Orchestrators

### Can We Run 2-3 Loops on One VPS?

Yes, with caveats.

#### Different Repos (Recommended)

The easiest multi-loop setup: each orchestrator watches a different repository. Zero coordination needed.

```
Orchestrator A -> github.com/helico/frontend  (has .ralph/ tasks)
Orchestrator B -> github.com/helico/backend   (has .ralph/ tasks)
Orchestrator C -> github.com/helico/infra     (has .ralph/ tasks)
```

Each gets its own workspace directory, its own git identity, its own process. They share the API key and SSH keys. No conflicts possible.

**Resource estimate for 3 orchestrators on CX22 (4GB RAM):**
- Idle: ~750 MB (3 x 250 MB)
- One active: ~1.2 GB
- Two active simultaneously: ~1.7 GB
- All three active: ~2.2 GB
- Available headroom: ~1.8 GB

Comfortable. Would recommend CX32 (8 GB) for 3+ orchestrators with large repos.

#### Same Repo, Different Task Filters

Possible but more complex. Two orchestrators watching the same `.ralph/pending/` directory need to coordinate task claiming.

The consensus design already handles this: `git mv` + `git push` is the atomic claim. If two workers try to claim the same task, only one push succeeds. The loser resets and picks the next task.

But for v1: **don't do this.** Single worker per repo. The complexity of coordinating multiple workers on the same repo is not justified until the single-worker loop is proven.

#### Port/Socket Conflicts

None. The orchestrator doesn't listen on any ports. It's a poller that makes outbound connections only. Multiple instances on the same machine don't conflict.

The only potential conflict: if two orchestrators clone the same repo into the same directory. Use separate workspace directories (which the docker-compose and systemd template unit approaches already handle).

---

## 11. The "It Could Run Anywhere" Test

### The Invariant

The orchestrator code must work identically on:
1. Developer's laptop (macOS/Linux)
2. Docker container (Linux)
3. Bare VPS (Linux)
4. GitHub Actions runner (if we ever want CI-driven execution)
5. Fly.io, Railway, or any other container platform

### How to Verify

**Rule 1: No Docker-specific imports or code paths.**

```bash
# This should return ZERO results in the orchestrator source:
grep -r "docker\|Docker\|DOCKER\|container\|Container" src/
# Allowed exception: documentation comments
```

**Rule 2: No VPS-specific code paths.**

```bash
# This should return ZERO results:
grep -r "systemd\|systemctl\|journalctl\|VPS\|vps" src/
```

**Rule 3: All environment-specific config comes from env vars.**

The orchestrator reads:
- `ANTHROPIC_API_KEY`
- `TASK_REPO_URL`
- `POLL_INTERVAL`
- `MAX_TASK_TIMEOUT`
- `LOG_LEVEL`
- `GIT_AUTHOR_NAME`
- `GIT_AUTHOR_EMAIL`

It does NOT read:
- `/proc/` filesystem
- Docker socket
- systemd notify socket
- Any file that only exists in one environment

**Rule 4: Same start command everywhere.**

```bash
# On your laptop:
bun run src/index.ts

# In Docker (via entrypoint.sh):
bun run src/index.ts

# On bare VPS (via systemd):
bun run src/index.ts

# Literally the same command. The entry point is the same.
# Only the env vars change.
```

**Rule 5: The doctor proves it.**

Run `ralph doctor` on each environment. If it passes, the orchestrator will work. The doctor checks the contract, not the platform.

### Directory Structure: The Boundary

```
ralph-vps/
├── src/                    # <-- Platform-agnostic. ZERO env-specific code.
│   ├── index.ts            # Entry point
│   ├── doctor.ts           # Contract checker
│   ├── logger.ts           # Structured logging
│   ├── orchestrator/       # Core loop
│   │   ├── loop.ts
│   │   ├── task-parser.ts
│   │   ├── state-machine.ts
│   │   ├── git-ops.ts
│   │   ├── executor.ts
│   │   └── verifier.ts
│   └── heartbeat.ts        # Writes heartbeat.json
├── docker/                 # <-- Docker adapter
│   ├── Dockerfile
│   ├── entrypoint.sh
│   └── docker-compose.yml
├── systemd/                # <-- Bare VPS adapter
│   ├── ralph.service
│   ├── ralph@.service      # Template for multiple instances
│   └── setup-vps.sh
├── package.json
├── tsconfig.json
├── .env.example
└── tests/
```

The `src/` directory is the orchestrator. Everything else is an adapter. The adapters know about `src/`. `src/` knows about nothing outside itself.

This is the hexagonal architecture principle applied: the core (src/) defines ports (env vars, filesystem, git, CLI). The adapters (docker/, systemd/) implement the ports for specific environments.

---

## Summary

| Concern | Docker Adapter | Bare VPS Adapter | Common (in src/) |
|---------|---------------|-----------------|------------------|
| **Process management** | `restart: unless-stopped` | systemd service | -- |
| **Logging** | Docker json-file driver | journald or logrotate | Structured JSON to stdout |
| **Health check** | HEALTHCHECK directive | Manual `cat heartbeat.json` | Heartbeat writer |
| **SSH keys** | Volume mount + copy in entrypoint | `~/.ssh/` directly | -- |
| **Startup** | entrypoint.sh -> doctor -> bun | systemd ExecStart -> doctor -> bun | `ralph doctor` |
| **Shutdown** | SIGTERM from docker stop | SIGTERM from systemctl stop | Signal handler in src/ |
| **Multiple instances** | docker-compose services | systemd template units | -- |
| **Update** | `docker compose up -d --build` | `git pull && bun install && systemctl restart` | -- |
| **Crash recovery** | -- | -- | Orphan detection + clean tree |
| **Auth** | Env var in compose | Env var in .env | Doctor checks it |

The orchestrator is one thing: a TypeScript/Bun process that reads env vars, polls git, runs Claude, and pushes results. Everything else -- Docker, systemd, VPS provisioning, SSH keys -- is wrapping paper around that core. Different wrapping paper for different environments, same gift inside.
