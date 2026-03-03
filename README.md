# Ralph

An autonomous coding agent that picks up tasks from a git-based queue and executes them using Claude Code on a remote VPS. You write tasks, Ralph does the work, you review the results.

## How It Works

Ralph has two sides that communicate exclusively through git:

```
YOUR LAPTOP                          VPS (Hetzner)
-----------                          -------------
You write a task file        git push
and commit it to        ─────────────►  Ralph polls for new tasks
.ralph/tasks/pending/                   in .ralph/tasks/pending/
                                        │
                                        ├─ Claims the task (git mv → active/)
                                        ├─ Creates branch ralph/<task-id>
                                        ├─ Runs Claude Code against it
                                        ├─ Runs tests/build/lint to verify
                                        └─ Moves task to review/ or failed/
                          git fetch
You review the branch   ◄─────────────  Ralph pushes branch + status
and the code changes
```

**Git is the only communication channel.** No SSH required for normal operations. No databases, no message queues, no external services. Your repo IS the task queue.

## Concepts

### Task Files

A task is a single Markdown file with YAML frontmatter, living under `.ralph/tasks/`. The directory it's in IS its status:

```
.ralph/tasks/
├── pending/     # Waiting to be picked up (you write here)
├── active/      # Currently being worked on by Ralph
├── review/      # Done, waiting for your review
├── done/        # Approved and merged
└── failed/      # Ralph couldn't complete it
```

Moving a file between directories (`git mv`) is the state transition. No status fields to update, no database rows to flip.

### Ownership Boundaries

| Who | Writes to |
|-----|-----------|
| You | `pending/` |
| Ralph | `active/`, `review/`, `done/`, `failed/` |

You create tasks. Ralph executes them. You never touch `active/`. Ralph never touches `pending/`.

### Branches

Ralph creates a branch for every task: `ralph/<task-id>`. All code changes live on this branch. When you approve a task, you merge the branch. This keeps `main` clean and gives you a full diff to review.

## Installation

Ralph runs in two places. Install differently depending on where you are.

### Prerequisites

| Dependency | Laptop | VPS | Notes |
|------------|--------|-----|-------|
| [Bun](https://bun.sh) >= 1.0 | Required | Required | Runtime for Ralph CLI and orchestrator |
| [Git](https://git-scm.com) >= 2.30 | Required | Required | The backbone of everything |
| [Claude Code](https://claude.ai/claude-code) | Optional | Required | The AI that does the actual coding |
| [Docker](https://docs.docker.com/get-docker/) | Optional | Recommended | Sandboxed execution on the VPS |
| Anthropic API key | Not needed | Required | Get one at [console.anthropic.com](https://console.anthropic.com) |

### Install Ralph (on your laptop)

```sh
# Install globally
bun install -g ralph-vps

# Verify
ralph --version
```

Or use it without installing globally:

```sh
bunx ralph-vps task create --title "Fix the bug"
```

This gives you the client commands: `ralph task`, `ralph status`, `ralph review`, `ralph doctor`. Your laptop never runs Claude — it just manages the task queue through git.

### Install Ralph (on your VPS)

Two options: Docker (recommended) or bare metal.

#### Option A: Docker (recommended)

Docker is the recommended path. The container is the security boundary — Claude Code runs inside it and can't escape.

**1. Get a VPS**

Any Linux VPS works. We recommend [Hetzner CX22](https://www.hetzner.com/cloud/) — 2 vCPU, 4GB RAM, ~EUR 4.50/month. Ralph itself uses almost no resources; Claude does the heavy lifting via API.

**2. Install Docker on the VPS**

```sh
# SSH into your VPS
ssh root@your-vps-ip

# Install Docker (Ubuntu/Debian)
curl -fsSL https://get.docker.com | sh
```

**3. Set up SSH keys for git access**

Ralph needs to push/pull from your repo. Create a deploy key:

```sh
# On the VPS
ssh-keygen -t ed25519 -C "ralph@your-vps" -f ~/.ssh/ralph_deploy_key -N ""
cat ~/.ssh/ralph_deploy_key.pub
```

Add the public key as a [deploy key](https://docs.github.com/en/developers/overview/managing-deploy-keys) on your GitHub repo (Settings > Deploy keys). Enable write access.

**4. Clone Ralph and build the image**

```sh
git clone https://github.com/helico/ralph-vps.git
cd ralph-vps
docker build -t ralph -f docker/Dockerfile .
```

**5. Run it**

```sh
docker run -d \
  --name ralph \
  --restart unless-stopped \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e TASK_REPO_URL=git@github.com:you/your-project.git \
  -e GIT_AUTHOR_NAME=Ralph \
  -e GIT_AUTHOR_EMAIL=ralph@helico.dev \
  -v ~/.ssh/ralph_deploy_key:/home/ralph/.ssh/id_ed25519:ro \
  ralph
```

**6. Verify it's running**

```sh
docker logs -f ralph
```

You should see:

```
[ralph] Starting orchestrator...
[ralph] Doctor: all checks passed
[ralph] Recovered 0 orphaned tasks
[ralph] Polling .ralph/tasks/pending/ every 30s
```

#### Option B: Bare metal (systemd)

For when you want Ralph running directly on the VPS without Docker.

**1. Install Bun and Claude Code on the VPS**

```sh
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Install Ralph
bun install -g ralph-vps
```

**2. Set up environment**

```sh
# Create a .env file (NOT in the repo — lives on the VPS only)
cat > /home/ralph/.env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-...
TASK_REPO_URL=git@github.com:you/your-project.git
GIT_AUTHOR_NAME=Ralph
GIT_AUTHOR_EMAIL=ralph@helico.dev
EOF
```

**3. Install the systemd service**

```sh
# Clone your project repo
git clone git@github.com:you/your-project.git /home/ralph/workspace
cd /home/ralph/workspace

# Copy the service file
sudo cp systemd/ralph.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ralph
sudo systemctl start ralph
```

**4. Check status**

```sh
sudo systemctl status ralph
sudo journalctl -u ralph -f
```

### Install Claude Code Skills (optional)

Skills give you Ralph commands directly inside Claude Code (`/ralph-task`, `/ralph-status`, etc.). They're thin wrappers around the CLI.

```sh
# From your project root (where .ralph/ lives)
ralph init skills
```

This symlinks the skill files into `.claude/skills/` so Claude Code picks them up. After this, you can use `/ralph-task` inside Claude Code instead of `ralph task create` in your terminal.

## Quick Start

Once Ralph is installed on both your laptop and VPS:

### 1. Initialize Ralph in your project

```sh
ralph init project
```

This creates the `.ralph/` directory structure, a default `config.json`, prompt templates, and the system prompt file. Commit and push:

```sh
git add .ralph/ templates/
git commit -m "Initialize Ralph"
git push
```

### 2. Configure your project

Edit `.ralph/config.json` to match your project's build/test commands:

```json
{
  "version": 1,
  "project": { "name": "my-app" },
  "verify": {
    "test": "bun test",
    "build": "bun run build",
    "lint": "bun run lint"
  },
  "task_defaults": {
    "max_retries": 2,
    "model": "opus",
    "max_turns": 50,
    "max_budget_usd": 5.0,
    "timeout_seconds": 1800
  },
  "exit_criteria": {
    "require_tests": true,
    "require_build": false,
    "require_lint": false
  },
  "git": {
    "main_branch": "main",
    "branch_prefix": "ralph/"
  }
}
```

The `verify` commands are what Ralph runs after Claude finishes editing code. If `require_tests` is `true` and `bun test` fails, the task fails (or retries).

Commit and push your config:

```sh
git add .ralph/config.json
git commit -m "Configure Ralph for this project"
git push
```

### 3. Verify everything works

```sh
# On your laptop — check project setup
ralph doctor

# On your VPS (or check Docker logs) — Ralph should pick up the config
docker logs ralph
```

### 4. Create your first task

```sh
ralph task create --title "Add a hello world endpoint at GET /health"
```

Ralph will pick it up within 30 seconds, execute it, and push the results. Check progress with:

```sh
ralph status
```

## Creating Tasks

### Minimal task (title only)

```sh
ralph task create --title "Fix null check in authenticate()"
```

This generates a task file with defaults and commits it to `pending/`:

```markdown
---
id: task-001
title: "Fix null check in authenticate()"
status: pending
type: feature
priority: 100
created_at: "2026-03-03T14:00:00Z"
author: "Arjan"
max_retries: 2
---
```

### Detailed task (recommended)

```sh
ralph task create \
  --title "Fix null check in authenticate()" \
  --type bugfix \
  --priority 200 \
  --files src/auth.ts,test/auth.test.ts \
  --acceptance-criteria "authenticate() handles null email" \
  --acceptance-criteria "All existing tests pass" \
  --acceptance-criteria "New test covers the null email case" \
  --constraint "Do not modify the User model"
```

This generates:

```markdown
---
id: task-002
title: "Fix null check in authenticate()"
status: pending
type: bugfix
priority: 200
created_at: "2026-03-03T14:30:00Z"
author: "Arjan"
acceptance_criteria:
  - "authenticate() handles null email"
  - "All existing tests pass"
  - "New test covers the null email case"
files:
  - src/auth.ts
  - test/auth.test.ts
constraints:
  - "Do not modify the User model"
max_retries: 2
---
```

### Writing task files by hand

You can also create task files directly. Drop a `.md` file in `.ralph/tasks/pending/`, commit, and push:

```markdown
---
id: task-003
title: "Add rate limiting to /api/login endpoint"
type: feature
priority: 150
acceptance_criteria:
  - "POST /api/login returns 429 after 5 attempts in 60 seconds"
  - "Rate limit resets after the window expires"
  - "Existing auth tests still pass"
files:
  - src/routes/auth.ts
  - src/middleware/rate-limit.ts
  - test/routes/auth.test.ts
constraints:
  - "Use in-memory store, not Redis"
  - "Do not add new dependencies"
---
## Description

The login endpoint has no rate limiting. Add a sliding window rate limiter
as middleware on the POST /api/login route.

## Context

Security audit flagged this as P1. We want a simple in-memory solution
for now — Redis-backed rate limiting is a future task.
```

### Task types

| Type | When to use | Prompt template |
|------|-------------|-----------------|
| `bugfix` | Fixing broken behavior | `templates/bugfix.md` |
| `feature` | Adding new functionality | `templates/feature.md` |
| `refactor` | Restructuring without behavior change | `templates/default.md` |
| `test` | Adding or improving tests | `templates/default.md` |
| `research` | Investigate and document (no code changes) | `templates/default.md` |
| `chore` | Config, deps, CI, housekeeping | `templates/default.md` |

The type selects which prompt template Ralph uses. V1 ships with `default.md`, `bugfix.md`, and `feature.md`. Unknown types fall back to `default.md`.

### Task fields reference

| Field | Required? | Default | Description |
|-------|-----------|---------|-------------|
| `title` | **Yes** (only required field) | -- | What the task is |
| `id` | System-generated | `task-NNN` | Unique identifier |
| `status` | System-generated | `pending` | Current state |
| `type` | No | `feature` | Task type (selects prompt template) |
| `priority` | No | `100` | Higher = picked first |
| `created_at` | System-generated | Now | ISO 8601 timestamp |
| `author` | System-generated | Git user | Who created the task |
| `acceptance_criteria` | Recommended | *"Change works correctly and tests pass"* | How Ralph knows it's done |
| `files` | Recommended | -- | Scopes Ralph's attention to these files |
| `constraints` | No | -- | Things Ralph must NOT do |
| `max_retries` | No | `2` | How many times to retry on failure |

## Checking Status

### Queue overview

```sh
ralph status
```

```
Queue Status
────────────
pending:  3 tasks
active:   1 task   (task-002: Fix null check in authenticate)
review:   2 tasks
done:     14 tasks
failed:   1 task

Last activity: 2 minutes ago (ralph(task-002): claimed)
```

### List tasks

```sh
ralph task list
```

```
ID        Status   Pri  Type     Title
────────  ───────  ───  ───────  ─────────────────────────────────────
task-005  pending  200  bugfix   Fix null check in authenticate()
task-004  pending  150  feature  Add rate limiting to /api/login
task-003  pending  100  chore    Update dependencies to latest
task-002  active   100  bugfix   Handle timeout in payment webhook
task-001  review   100  feature  Add user profile page
```

### Filter by status

```sh
ralph task list --status review
ralph task list --status failed
```

## Reviewing Completed Tasks

When Ralph finishes a task, it moves the file to `review/` and pushes the code to a `ralph/<task-id>` branch. You review it like any other branch:

### 1. See what's ready for review

```sh
ralph task list --status review
```

```
ID        Status  Pri  Type     Title
────────  ──────  ───  ───────  ──────────────────────────────
task-001  review  100  feature  Add user profile page
task-006  review  200  bugfix   Fix race condition in cache
```

### 2. Look at the diff

```sh
git diff main...ralph/task-001
```

Or use your normal code review tools — it's just a branch.

### 3. Approve or reject

**Approve** — merges the branch into main, moves task to `done/`:

```sh
ralph review task-001 --approve
```

**Reject** — moves task back to `pending/` for another attempt, deletes the branch:

```sh
ralph review task-001 --reject --reason "Missing error handling for network timeout"
```

The rejection reason is appended to the task file, so Ralph has context on the next attempt.

## What Ralph Does With Your Task

When Ralph picks up a task, here's the full cycle:

1. **Pull** — fetches latest `main`, fast-forward merge
2. **Claim** — `git mv pending/task.md active/task.md`, commit, push
3. **Branch** — creates `ralph/<task-id>` from `main`
4. **Build prompt** — reads task file, selects template by type, interpolates acceptance criteria / files / constraints into the prompt
5. **Execute** — runs Claude Code with the built prompt, budget limits, and turn limits
6. **Verify** — runs your configured test/build/lint commands
7. **Transition** — if verified: push branch, move to `review/`. If failed + retries left: move back to `pending/`. If permanently failed: move to `failed/`.

Every state transition is a git commit. The git log IS the audit trail:

```
ralph(task-002): claimed
ralph(task-002): verified — tests pass
ralph(task-002): moved to review
```

### After completion

Ralph adds execution metadata to the task frontmatter:

```yaml
cost_usd: 1.23
turns: 12
duration_s: 145
attempt: 1
branch: ralph/task-002
```

## Health Check

```sh
ralph doctor
```

Verifies that your project is correctly configured:

```
Ralph Doctor
────────────
[OK]  .ralph/config.json exists and is valid
[OK]  .ralph/tasks/ directories exist (pending, active, review, done, failed)
[OK]  .ralph/ralph-system.md exists
[OK]  templates/ directory exists with default.md
[OK]  Git remote is configured
[OK]  verify.test command works: bun test
[WARN] verify.build not configured (set exit_criteria.require_build to enable)
[OK]  6 checks passed, 1 warning
```

## Environment Variables

These are set on the VPS only (via `.env` or `docker run -e`). Never committed to git.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | -- | Your Anthropic API key |
| `TASK_REPO_URL` | Yes | -- | Git remote URL (SSH recommended) |
| `GIT_AUTHOR_NAME` | No | `Ralph` | Git author for Ralph's commits |
| `GIT_AUTHOR_EMAIL` | No | `ralph@helico.dev` | Git email for Ralph's commits |

## Prompt Templates

Ralph uses prompt templates to give Claude task-specific instructions. Templates live in `templates/` at the project root and are loaded at runtime (hot-reloadable — edit them while Ralph is running).

V1 ships with three:

- `templates/default.md` — generic task execution
- `templates/bugfix.md` — bug-focused: reproduce, fix, regression test
- `templates/feature.md` — feature-focused: implement, test, document

Templates use variable interpolation from the task frontmatter:

```markdown
## Task: {{title}}

{{description}}

### Files to focus on
{{#files}}
- {{.}}
{{/files}}

### Acceptance Criteria
{{#acceptance_criteria}}
- {{.}}
{{/acceptance_criteria}}

### Constraints
{{#constraints}}
- {{.}}
{{/constraints}}
```

The system prompt (`ralph-system.md`) provides behavioral rules that apply to ALL tasks — commit discipline, scope boundaries, what to do when stuck. It's separate from your project's `CLAUDE.md`, which contains project conventions (build commands, naming, architecture).

## Project Structure

```
your-project/
├── src/                        # Your application code
├── test/                       # Your tests
├── .ralph/
│   ├── config.json             # Ralph configuration (committed)
│   ├── ralph-system.md         # System prompt for Claude (committed)
│   ├── tasks/
│   │   ├── pending/            # Tasks waiting to be picked up
│   │   ├── active/             # Currently being executed
│   │   ├── review/             # Done, waiting for human review
│   │   ├── done/               # Approved and merged
│   │   └── failed/             # Could not be completed
│   ├── heartbeat.json          # Node health (gitignored, disk only)
│   └── traces/                 # Execution traces (gitignored, disk only)
├── templates/
│   ├── default.md              # Generic task template
│   ├── bugfix.md               # Bug fix template
│   └── feature.md              # Feature template
├── CLAUDE.md                   # Project conventions (for Claude Code)
└── ...
```

## Design Principles

- **Git is the only state store.** No databases, no message queues. If it's not in git, it doesn't exist.
- **No auto-accept.** Every task goes through human review. Ralph proposes, you decide.
- **Explicit file staging.** Ralph never runs `git add -A`. Every staged file is intentional.
- **Single worker.** One task at a time. No multi-worker complexity until single-worker is proven.
- **Per-task branches.** Code changes live on `ralph/<task-id>`, keeping `main` clean.
- **Crash recovery.** If Ralph dies mid-task, it reclaims orphaned `active/` tasks on restart.
- **Docker is the sandbox.** The container IS the security boundary. Claude can't escape it.

## License

MIT
