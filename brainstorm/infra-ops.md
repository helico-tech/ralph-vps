# Infrastructure & Docker Brainstorm: Running Claude Code "Ralph Loops" on a VPS

## Table of Contents

1. [Claude Code Headless Requirements](#1-claude-code-headless-requirements)
2. [VPS Provider Options](#2-vps-provider-options)
3. [Docker Strategy](#3-docker-strategy)
4. [Process Management](#4-process-management)
5. [Deployment Strategy](#5-deployment-strategy)
6. [Networking & Security](#6-networking--security)
7. [Crash Recovery](#7-crash-recovery)
8. [Cost Considerations](#8-cost-considerations)
9. [Scaling: Multiple Loops](#9-scaling-multiple-loops)
10. [Recommended Architecture](#10-recommended-architecture)

---

## 1. Claude Code Headless Requirements

### What Claude Code Needs to Run Non-Interactively

Claude Code can run headlessly using the `-p` (or `--print`) flag, which processes a prompt, outputs the result to stdout, and exits. This is the core primitive we build the ralph loop on.

**Authentication** (two options):
- **API Key**: Set `ANTHROPIC_API_KEY` environment variable. Billed at API pay-as-you-go rates.
- **OAuth / Subscription**: Interactive login via `claude login`. Uses Pro/Max subscription. Can be persisted by bind-mounting `~/.claude/` credentials directory.

**Key CLI Flags for Headless Operation:**
```bash
claude -p "your prompt here"                     # Non-interactive mode
  --allowedTools "Bash,Read,Edit,Write"          # Auto-approve specific tools
  --output-format json                           # Structured output (json / stream-json / text)
  --continue                                     # Continue most recent conversation
  --resume <session_id>                          # Resume specific session
  --append-system-prompt "..."                   # Add instructions to system prompt
  --dangerously-skip-permissions                 # Skip ALL permission prompts (use in sandbox only)
```

**Runtime Dependencies:**
- Node.js 20+ (Claude Code is an npm package: `@anthropic-ai/claude-code`)
- git (for repo operations)
- Standard POSIX tools (bash, etc.)

**Critical Note on `--dangerously-skip-permissions`:**
This flag skips all permission prompts and allows Claude to execute arbitrary commands. It should ONLY be used inside a sandboxed container with restricted network access. This is what makes the Docker strategy non-negotiable.

### Programmatic SDK Alternative

Beyond CLI, Claude Code has a Python and TypeScript Agent SDK for full programmatic control:
- Structured outputs, tool approval callbacks, native message objects
- Can spawn subagents for parallel subtasks
- Streaming support for real-time progress monitoring

**Recommendation**: Start with CLI (`claude -p`) for simplicity. The SDK is an upgrade path if we need finer control later.

---

## 2. VPS Provider Options

### Comparison Matrix

| Provider | Cheapest Plan | RAM | Storage | Traffic | Docker Support | Ease of Use |
|----------|--------------|-----|---------|---------|----------------|-------------|
| **Hetzner** | ~EUR 4/mo (CX22) | 4 GB | 40 GB | 20 TB | Docker CE app image | Medium - CLI/console |
| **DigitalOcean** | $6/mo (Basic) | 1 GB | 25 GB | 1 TB | 1-click Docker | High - great UI |
| **Railway** | Usage-based (~$5 credit) | Varies | Varies | Varies | Native Docker | Very High - git push deploy |
| **Fly.io** | Usage-based (~$5 credit) | Varies | Varies | Varies | Dockerfile deploy | High - CLI deploy |
| **Contabo** | ~EUR 5/mo | 4 GB | 50 GB SSD | 32 TB | Manual install | Low - budget tier |

### Provider Recommendations

**Best overall: Hetzner**
- Unbeatable price/performance ratio (4 GB RAM for ~EUR 4/mo)
- 20 TB traffic included (no surprise bills)
- Docker CE pre-installed app image available
- Full root access, clean REST API, `hcloud` CLI
- EU and US datacenter locations
- Hourly billing (pay only while running)

**Best for beginners: DigitalOcean**
- Most polished UI and documentation
- 1-click Docker droplet setup
- Great tutorials for everything
- Slightly more expensive but friendlier
- $6/mo for 1 GB RAM (minimum viable, tight for Claude Code)

**Best for zero-ops: Railway**
- Push to git, it deploys automatically
- No SSH, no server management
- Usage-based pricing can be unpredictable
- Good for prototyping, less control for production

**Verdict**: Hetzner CX22 (4 GB RAM, EUR ~4.5/mo) is the sweet spot. Enough RAM for Claude Code + Docker overhead, and the price is unbeatable. DigitalOcean is the fallback if the user wants a friendlier interface.

### Minimum Viable Specs for Ralph Loop

- **CPU**: 2 vCPU (Claude Code is mostly I/O-bound waiting for API responses, not CPU-bound)
- **RAM**: 4 GB minimum (Node.js + Claude Code + git operations)
- **Disk**: 20 GB minimum (OS + Docker + repo clone + workspace)
- **Network**: Outbound HTTPS to Anthropic API required; everything else can be blocked

---

## 3. Docker Strategy

### Single Container vs Docker Compose

**Recommendation: Start with a single Dockerfile, wrap with docker-compose for convenience.**

A single container is sufficient for one ralph loop. Docker-compose adds value for:
- Declarative configuration (ports, volumes, env vars, restart policy)
- Easy `docker compose up -d` / `docker compose down`
- Future scaling to multiple loops

### Base Image Strategy

**Option A: Anthropic's Official Devcontainer (recommended starting point)**

The official Dockerfile from `anthropics/claude-code/.devcontainer/` provides:
```dockerfile
FROM node:20

# Installs: git, zsh, fzf, iptables, ipset, iproute2, dnsutils, jq, vim, nano, gh
# Installs: git-delta for diffs
# Installs: Claude Code via npm install -g @anthropic-ai/claude-code
# Sets up: non-root user (node), firewall script, zsh shell
# Sets up: /workspace directory
```

This is battle-tested and maintained by Anthropic. It includes the firewall script for network isolation.

**Option B: Minimal Custom Dockerfile (leaner)**

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    jq \
    iptables \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@latest

RUN useradd -m -s /bin/bash ralph
USER ralph
WORKDIR /home/ralph/workspace
```

Pros: Smaller image, faster builds, fewer attack surfaces.
Cons: No firewall script, no zsh niceties. Fine if we control networking at Docker level.

**Recommendation**: Use Option B (minimal) for production ralph loops. The official devcontainer is overkill for headless operation -- it's designed for interactive development. We only need Node.js, git, and Claude Code.

### Container Architecture

```
ralph-loop container
├── /home/ralph/workspace/     # Git repo clone (volume mount or cloned at startup)
├── /home/ralph/.claude/       # Claude config + credentials (volume mount)
├── /home/ralph/scripts/       # Loop runner script (baked into image)
└── Environment:
    ├── ANTHROPIC_API_KEY       # Or OAuth token
    ├── TASK_REPO_URL           # Git repo with task queue
    └── GIT_AUTHOR_*            # Git identity for commits
```

### Proposed Dockerfile

```dockerfile
FROM node:20-slim

ARG CLAUDE_CODE_VERSION=latest

# Minimal deps: git for repo ops, jq for JSON parsing
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    jq \
    openssh-client \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Create non-root user
RUN useradd -m -s /bin/bash ralph
USER ralph

# Setup workspace
RUN mkdir -p /home/ralph/workspace /home/ralph/.claude /home/ralph/.ssh
WORKDIR /home/ralph/workspace

# Copy the loop runner script
COPY --chown=ralph:ralph scripts/ /home/ralph/scripts/

ENTRYPOINT ["/home/ralph/scripts/ralph-loop.sh"]
```

### Proposed docker-compose.yml

```yaml
version: '3.8'

services:
  ralph:
    build:
      context: .
      args:
        CLAUDE_CODE_VERSION: latest
    container_name: ralph-loop
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - TASK_REPO_URL=${TASK_REPO_URL}
      - GIT_AUTHOR_NAME=Ralph
      - GIT_AUTHOR_EMAIL=ralph@helico.dev
      - POLL_INTERVAL=30
    volumes:
      - ralph-workspace:/home/ralph/workspace
      - ralph-claude-config:/home/ralph/.claude
      - ./ssh-keys:/home/ralph/.ssh:ro   # Deploy key for git
    # Network: restrict to only Anthropic API + GitHub
    # For maximum security, use --network none and proxy API calls
    # For simplicity, allow outbound HTTPS
    networks:
      - ralph-net

  # Optional: watchtower for auto-updating containers
  # watchtower:
  #   image: containrrr/watchtower
  #   volumes:
  #     - /var/run/docker.sock:/var/run/docker.sock

volumes:
  ralph-workspace:
  ralph-claude-config:

networks:
  ralph-net:
    driver: bridge
```

---

## 4. Process Management

### Options Compared

| Approach | Complexity | Reliability | Observability |
|----------|-----------|-------------|---------------|
| **Docker restart policy** | Lowest | Good | Docker logs |
| **systemd service** | Medium | Excellent | journalctl |
| **supervisord in container** | Medium | Good | supervisor logs |
| **Custom loop script** | Lowest | Depends | Script logs |

### Recommendation: Docker restart policy + loop script

The simplest approach that works:

1. **Docker `restart: unless-stopped`** handles container-level crashes (OOM, segfaults, etc.)
2. **A bash loop script** inside the container handles task-level iteration
3. **Docker logs** (`docker logs -f ralph-loop`) for observability

**The loop script (`ralph-loop.sh`):**
```bash
#!/bin/bash
set -euo pipefail

# Clone or pull the task repo
if [ ! -d "/home/ralph/workspace/.git" ]; then
  git clone "$TASK_REPO_URL" /home/ralph/workspace
fi

while true; do
  cd /home/ralph/workspace
  git pull --rebase

  # Find next pending task (implementation depends on task queue format)
  TASK=$(find_next_task)

  if [ -z "$TASK" ]; then
    echo "No pending tasks. Sleeping ${POLL_INTERVAL:-30}s..."
    sleep "${POLL_INTERVAL:-30}"
    continue
  fi

  echo "Processing task: $TASK"

  # Execute the task with Claude Code
  claude -p "$(cat $TASK)" \
    --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
    --output-format json \
    --dangerously-skip-permissions \
    > "/home/ralph/workspace/.results/$(basename $TASK).result.json" 2>&1

  # Mark task complete, commit, push
  mark_task_complete "$TASK"
  git add -A
  git commit -m "ralph: completed task $(basename $TASK)"
  git push

  echo "Task complete. Checking for next task..."
done
```

**Why NOT systemd or supervisor:**
- systemd requires running systemd inside Docker (anti-pattern, adds complexity)
- supervisord is useful for multi-process containers, but we have a single process
- Docker restart policies are designed exactly for this use case
- Don't combine Docker restart policies with host-level process managers (they conflict)

---

## 5. Deployment Strategy

### How Code Gets to the VPS

**Recommended: Git clone + docker build on VPS**

This is the simplest approach for a non-Linux user:

```
User's Laptop                     VPS (Hetzner)
┌─────────────┐                  ┌──────────────────┐
│ ralph-vps/  │   git push       │ git pull          │
│ repo        │ ──────────────>  │ docker compose    │
│             │                  │   build && up -d  │
└─────────────┘                  └──────────────────┘
```

**Step-by-step deployment flow:**
1. User pushes ralph-vps repo to GitHub/remote
2. SSH into VPS: `ssh root@<vps-ip>`
3. Clone repo: `git clone <repo-url> ~/ralph-vps`
4. Configure env: `cp .env.example .env && nano .env`
5. Build and run: `docker compose up -d --build`
6. Verify: `docker logs -f ralph-loop`

**Alternative: Pre-built images via GitHub Container Registry**
- GitHub Actions builds and pushes image on every commit
- VPS just `docker compose pull && docker compose up -d`
- More robust but more setup overhead upfront
- Good upgrade path when the system is proven

**Alternative: CI/CD with GitHub Actions**
- On push to main, SSH into VPS and run deploy script
- Most automated, but most complex to set up initially
- Recommended for v2, not v1

### Update Strategy

For the ralph-vps system itself (not the task repos):

```bash
# On the VPS:
cd ~/ralph-vps
git pull
docker compose up -d --build
```

This could eventually be wrapped in a simple `./update.sh` script.

---

## 6. Networking & Security

### Network Architecture

```
Internet
    │
    ├── SSH (port 22) ──────> VPS (user access)
    │
    └── HTTPS (443) <──────── Container outbound only:
                               ├── api.anthropic.com (Claude API)
                               ├── github.com (git push/pull)
                               ├── registry.npmjs.org (npm, if needed)
                               └── (nothing else)
```

### SSH Access

**For the user:**
- SSH key pair generated on laptop
- Public key added to VPS on creation (Hetzner/DO support this in UI)
- Connect via: `ssh root@<vps-ip>` or `ssh ralph@<vps-ip>`

**For the container (git operations):**
- Generate a dedicated SSH deploy key for the task repo
- Mount as read-only volume: `./ssh-keys:/home/ralph/.ssh:ro`
- Add deploy key to GitHub repo settings

### Secrets Management

**Level 1 (Simple, good enough for v1):**
- `.env` file on VPS with `ANTHROPIC_API_KEY` and other secrets
- `.env` file is NOT committed to git (`.gitignore`)
- `.env.example` with placeholder values IS committed

**Level 2 (Better, for later):**
- Docker secrets (docker swarm mode)
- HashiCorp Vault
- Cloud provider's secrets manager

**Level 3 (Best, for production):**
- Secrets injected via CI/CD pipeline
- Rotated automatically
- Audit trail

**Recommendation**: Level 1 for v1. A `.env` file on a single VPS is perfectly adequate.

### Container Network Isolation

**Option A: Docker network restrictions (recommended)**
```yaml
# In docker-compose.yml, use a custom network with outbound restrictions
# implemented via iptables rules on the host
```

**Option B: `--network none` + API proxy**
- Container has zero network access
- A sidecar proxy container handles API calls
- Most secure, but complex

**Option C: Anthropic's firewall script**
- Use the `init-firewall.sh` from the official devcontainer
- Whitelists only necessary domains
- Requires `CAP_NET_ADMIN` capability in the container

**Recommendation**: Option A for v1. Simple iptables rules on the host that restrict container outbound traffic to Anthropic API and GitHub only. Option C is the upgrade path.

### API Key Security

- `ANTHROPIC_API_KEY` passed via environment variable (never baked into image)
- Container runs as non-root user (`ralph`)
- If using subscription auth, bind-mount `~/.claude/` with credentials
- Set billing alerts on your Anthropic account

---

## 7. Crash Recovery

### Failure Modes and Handling

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Claude API timeout | Non-zero exit code | Retry task (loop continues) |
| Claude Code crash | Process exits | Docker restart policy restarts container |
| VPS reboot | Container stopped | `restart: unless-stopped` restarts it |
| OOM kill | Container killed | Docker restart + consider more RAM |
| Git conflict | Push rejected | Pull --rebase, retry push |
| Disk full | Write errors | Alert + manual intervention |
| API key expired | Auth errors | Alert + manual key rotation |
| Infinite loop in task | Resource exhaustion | Timeout per task (see below) |

### Task-Level Timeout

Each Claude Code invocation should have a timeout to prevent runaway tasks:

```bash
# Run with timeout (e.g., 30 minutes per task)
timeout 1800 claude -p "$(cat $TASK)" \
  --allowedTools "Bash,Read,Edit,Write" \
  --dangerously-skip-permissions \
  || echo "Task timed out"
```

### State Preservation

Key principle: **All state lives in git**. The container is stateless/disposable.

- Task queue state: in git (task files with status markers)
- Work in progress: committed to a branch before pushing
- Conversation history: captured in output JSON, committed to git
- Container can be destroyed and recreated at any time without data loss

### Health Checking

```yaml
# In docker-compose.yml:
services:
  ralph:
    healthcheck:
      test: ["CMD", "pgrep", "-f", "ralph-loop"]
      interval: 60s
      timeout: 10s
      retries: 3
```

### Logging

```bash
# View logs in real-time
docker logs -f ralph-loop

# Last 100 lines
docker logs --tail 100 ralph-loop

# Logs with timestamps
docker logs -t ralph-loop
```

For persistent logging, Docker's default `json-file` logging driver keeps logs on disk. Add rotation:

```yaml
services:
  ralph:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

---

## 8. Cost Considerations

### VPS Costs

| Provider | Plan | Monthly Cost | Notes |
|----------|------|-------------|-------|
| Hetzner CX22 | 2 vCPU, 4GB RAM, 40GB | ~EUR 4.5/mo | Best value |
| Hetzner CX32 | 4 vCPU, 8GB RAM, 80GB | ~EUR 8/mo | Comfortable headroom |
| DigitalOcean | 2 vCPU, 2GB RAM, 60GB | $18/mo | Easier UI |
| Railway | Usage-based | $5-20/mo | Unpredictable |

### Claude Code / API Costs

**Subscription (Max plan):**
- Pro: $20/mo (includes Claude Code, has rate limits)
- Max 5x: $100/mo (5x usage limits)
- Max 20x: $200/mo (20x usage limits)

**API (pay-as-you-go):**
- Input: $3/MTok (under 200K context), $6/MTok (over 200K)
- Output: $15/MTok (under 200K context), $22.50/MTok (over 200K)
- Heavy coding via API: potentially $100+/day for active loops

**Recommendation**: For ralph loops, use an API key with billing alerts. A Max subscription's rate limits may be too restrictive for automated loops. Set a monthly budget alert.

**Estimated Monthly Cost for a Single Ralph Loop:**
- VPS (Hetzner CX22): ~EUR 5/mo
- API usage (moderate, ~10 tasks/day): ~$50-150/mo
- **Total: ~$55-155/mo**

### Cost Optimization

- Run VPS only when needed (Hetzner bills hourly, destroy when idle)
- Use `claude -p` with focused, specific prompts (less token waste)
- Set `--max-turns` to limit how many tool calls Claude can make per task
- Monitor API usage via Anthropic dashboard
- Consider smaller models for simpler tasks (Haiku for linting, Opus for complex work)

---

## 9. Scaling: Multiple Loops

### Running Multiple Ralph Loops

**Option A: Multiple containers on one VPS (recommended for 2-5 loops)**

```yaml
# docker-compose.yml
services:
  ralph-frontend:
    build: .
    environment:
      - TASK_FILTER=frontend
    # ... same config

  ralph-backend:
    build: .
    environment:
      - TASK_FILTER=backend
    # ... same config
```

Each container watches a different task subset. Simple, cheap.

**Option B: Multiple VPS instances (for 5+ loops)**
- Separate VPS per loop or group of loops
- Independent failure domains
- Managed via Terraform/Pulumi or a simple script

**Option C: Kubernetes (overkill, avoid)**
- Don't do this. It's the opposite of simple.

### Resource Considerations for Multiple Loops

- Each Claude Code process: ~200-500MB RAM (mostly idle, spikes during execution)
- A 4GB VPS can comfortably run 2-3 loops
- An 8GB VPS can run 5-8 loops
- CPU is rarely the bottleneck (API calls are I/O-bound)

### Task Isolation

Multiple loops need to avoid stepping on each other:
- Each loop works on a separate branch or separate directory
- Task queue needs locking/claiming mechanism (file-based or git-based)
- Push conflicts handled by pull-rebase-retry pattern

---

## 10. Recommended Architecture

### Phase 1: Minimal Viable Setup

```
┌─────────────────────────────────────────────────┐
│                  Hetzner VPS (CX22)             │
│                  4GB RAM, 2 vCPU                │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │         Docker Container: ralph            │  │
│  │                                           │  │
│  │  ralph-loop.sh (bash loop)                │  │
│  │    ├── git pull (fetch tasks)             │  │
│  │    ├── claude -p (execute task)           │  │
│  │    ├── git commit + push (results)        │  │
│  │    └── sleep (poll interval)              │  │
│  │                                           │  │
│  │  restart: unless-stopped                  │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  .env (ANTHROPIC_API_KEY, TASK_REPO_URL)       │
│  ssh-keys/ (deploy key for git)                │
└─────────────────────────────────────────────────┘
          │                    │
          │ HTTPS              │ SSH (port 22)
          ▼                    ▼
   api.anthropic.com     User's laptop
   github.com            (introspection)
```

### What the User Does

1. **One-time setup** (~30 minutes):
   - Create Hetzner account, spin up CX22 with Docker
   - SSH in, clone ralph-vps repo, configure `.env`
   - `docker compose up -d`

2. **Daily workflow**:
   - Push tasks to git repo from laptop
   - Ralph picks them up, executes, pushes results
   - User pulls results: `git pull`

3. **Introspection**:
   - `ssh <vps> docker logs -f ralph-loop` (live progress)
   - `git log` on the task repo (completed tasks)
   - Optional: simple webhook/notification on task completion

### Files to Create

```
ralph-vps/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
├── scripts/
│   └── ralph-loop.sh
├── setup/
│   ├── vps-setup.sh          # Initial VPS provisioning
│   └── generate-deploy-key.sh # SSH key generation
└── docs/
    └── getting-started.md     # Step-by-step guide
```

### Key Design Decisions

1. **Single container, not multi-service**: One process, one responsibility.
2. **Docker Compose for ergonomics**: Even with one container, compose is nicer than raw docker run.
3. **Git as the only state store**: No databases, no message queues. Everything is a file in git.
4. **API key auth, not subscription**: Subscription rate limits are unpredictable for automated loops.
5. **`--dangerously-skip-permissions` in a restricted container**: The only safe way to run headless.
6. **Bash loop script, not a framework**: Simple, debuggable, replaceable.
7. **Hetzner for cost, not Railway for convenience**: The user needs to learn a little Linux, but saves significantly.

---

## Sources

- [Claude Code Devcontainer Docs](https://code.claude.com/docs/en/devcontainer)
- [Claude Code Headless/Programmatic Mode](https://code.claude.com/docs/en/headless)
- [Official Devcontainer Dockerfile](https://github.com/anthropics/claude-code/blob/main/.devcontainer/Dockerfile)
- [Anthropic Devcontainer Features](https://github.com/anthropics/devcontainer-features)
- [claude-code-container (tintinweb)](https://github.com/tintinweb/claude-code-container)
- [Claude Code on Loop: YOLO Mode](https://mfyz.com/claude-code-on-loop-autonomous-ai-coding/)
- [Docker Sandboxes for Claude Code](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
- [Claude Code Docker Sandbox Docs](https://docs.docker.com/ai/sandboxes/agents/claude-code/)
- [Managing API Keys in Claude Code](https://support.claude.com/en/articles/12304248-managing-api-key-environment-variables-in-claude-code)
- [Claude Pricing](https://claude.com/pricing)
- [Hetzner Cloud](https://www.hetzner.com/cloud)
- [Hetzner Docker CE Setup](https://docs.hetzner.com/cloud/apps/list/docker-ce/)
- [Docker Restart Policies](https://docs.docker.com/engine/containers/start-containers-automatically/)
- [Running Claude Code in a Container](https://expandmapping.substack.com/p/running-claude-code-in-a-container)
- [Docker Sandboxes: Run Claude Code Safely](https://www.docker.com/blog/docker-sandboxes-run-claude-code-and-other-coding-agents-unsupervised-but-safely/)
