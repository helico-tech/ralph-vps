# Ralph

An autonomous coding agent that picks up tasks from a git-based queue and executes them using Claude Code on a remote VPS. You write tasks, Ralph does the work — including reviewing its own output and fixing issues before merging.

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
                                        ├─ Runs verification command
                                        ├─ Spawns a review task automatically
                                        │   ├─ Review passes → auto-merge
                                        │   └─ Review fails → spawns fix task
                                        │       └─ Fix done → new review → ...
                          git fetch     │
You see merged results ◄─────────────  └─ Pushes branch + merges to main
```

**Git is the only communication channel.** No SSH required for normal operations. No databases, no message queues, no external services. Your repo IS the task queue.

Ralph supports **multiple instances** running against the same repo via systemd template units — each picks tasks independently.

## Concepts

### Task Files

A task is a single Markdown file with YAML frontmatter, living under `.ralph/tasks/`. The directory it's in IS its status:

```
.ralph/tasks/
├── pending/     # Waiting to be picked up
├── active/      # Currently being worked on by Ralph
├── done/        # Completed and merged
└── failed/      # Ralph couldn't complete it
```

Moving a file between directories (`git mv`) is the state transition. No status fields to update, no database rows to flip.

### Task Types

Ralph uses four task types that form an autonomous chain:

| Type | Purpose | Created by |
|------|---------|------------|
| `feature` | Adding new functionality | You |
| `bugfix` | Fixing broken behavior | You |
| `review` | Review code changes from a parent task | Ralph (auto-spawned) |
| `fix` | Fix issues found during review | Ralph (auto-spawned) |

When a `feature` or `bugfix` completes successfully, Ralph automatically spawns a `review` task. If the review finds problems, Ralph spawns a `fix` task. When the fix completes, another review is spawned. This continues until the review passes — then Ralph merges the branch. If a fix fails, the chain stops (no infinite loops).

### Ownership Boundaries

| Who | Writes to |
|-----|-----------|
| You | `pending/` |
| Ralph | `pending/` (follow-up tasks), `active/`, `done/`, `failed/` |

You create initial tasks. Ralph executes them and spawns follow-up review/fix tasks back into `pending/`.

### Branches

Ralph creates a branch for every root task: `ralph/<task-id>`. All tasks in a chain (the original task plus its review/fix follow-ups) share the same branch. When the final review passes, Ralph merges the branch into `main`.

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
# Clone the repo
git clone https://github.com/helico/ralph-vps.git
cd ralph-vps
bun install

# Link globally so `ralph` is available everywhere
bun link

# Verify
ralph --version
```

This gives you the client commands: `ralph init`, `ralph task`, `ralph status`, `ralph doctor`. Your laptop never runs Claude — it just manages the task queue through git.

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

For when you want Ralph running directly on the VPS without Docker. Uses a systemd template unit that supports multiple independent Ralph instances.

**1. Install Bun and Claude Code on the VPS**

```sh
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Clone Ralph
git clone https://github.com/helico/ralph-vps.git /opt/ralph
cd /opt/ralph
bun install
```

**2. Set up environment**

Each project gets its own env file:

```sh
# Create env file for your project
sudo mkdir -p /etc/ralph
cat > /etc/ralph/my-project.env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-...
GIT_AUTHOR_NAME=Ralph
GIT_AUTHOR_EMAIL=ralph@helico.dev
EOF
```

**3. Clone your project and install the service**

```sh
# Clone your project repo
git clone git@github.com:you/your-project.git /home/ralph/projects/my-project

# Copy the template service file
sudo cp systemd/ralph@.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable and start for your project
sudo systemctl enable ralph@my-project
sudo systemctl start ralph@my-project
```

The `%i` in `ralph@.service` maps to the project name, so you can run multiple instances:

```sh
sudo systemctl start ralph@project-a
sudo systemctl start ralph@project-b
```

**4. Check status**

```sh
sudo systemctl status ralph@my-project
sudo journalctl -u ralph@my-project -f
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
ralph init --name my-app --test "bun test"
```

This creates the `.ralph/` directory structure, a default config, prompt templates, and the system prompt file. Commit and push:

```sh
git add .ralph/ templates/
git commit -m "Initialize Ralph"
git push
```

### 2. Configure your project

The `ralph init` command generates `.ralph/config.json`:

```json
{
  "version": 1,
  "project": { "name": "my-app" },
  "verify": "bun test",
  "task_defaults": {
    "model": "claude-opus-4-5",
    "max_turns": 50,
    "timeout_seconds": 1800
  },
  "git": {
    "main_branch": "main",
    "branch_prefix": "ralph/"
  },
  "execution": {
    "permission_mode": "skip_all"
  }
}
```

The `verify` command is what Ralph runs after Claude finishes editing code. If it fails, the task fails and Ralph spawns follow-up tasks to address the issue.

Environment variables can override config values:

| Variable | Overrides |
|----------|-----------|
| `RALPH_MODEL` | `task_defaults.model` |
| `RALPH_MAIN_BRANCH` | `git.main_branch` |
| `RALPH_PERMISSION_MODE` | `execution.permission_mode` |

### 3. Verify everything works

```sh
# On your laptop — check project setup
ralph doctor

# On your VPS (or check Docker logs) — Ralph should pick up the config
docker logs ralph
```

### 4. Create your first task

```sh
ralph task create -d "Add a hello world endpoint at GET /health"
```

Ralph will pick it up within 30 seconds, execute it, verify it, spawn a review, and — if the review passes — merge it. Check progress with:

```sh
ralph status
```

## Creating Tasks

### Minimal task

```sh
ralph task create -d "Fix null check in authenticate()"
```

This generates a task file with defaults and commits it to `pending/`:

```markdown
---
id: task-001
type: feature
priority: 100
---
Fix null check in authenticate()
```

### Detailed task

```sh
ralph task create \
  -d "Fix null check in authenticate()" \
  --type bugfix \
  --priority 200
```

### Writing task files by hand

You can also create task files directly. Drop a `.md` file in `.ralph/tasks/pending/`, commit, and push:

```markdown
---
id: task-003
type: feature
priority: 150
---
## Description

Add rate limiting to the POST /api/login endpoint.

The login endpoint has no rate limiting. Add a sliding window rate limiter
as middleware. Use an in-memory store, not Redis.

## Requirements

- POST /api/login returns 429 after 5 attempts in 60 seconds
- Rate limit resets after the window expires
- Existing auth tests still pass
- Do not add new dependencies
```

The Markdown body after the frontmatter IS the description. Put all context, requirements, and constraints there — Ralph reads the full body.

### Task types

| Type | When to use | Created by | Prompt template |
|------|-------------|------------|-----------------|
| `feature` | Adding new functionality | You | `templates/feature.md` |
| `bugfix` | Fixing broken behavior | You | `templates/bugfix.md` |
| `review` | Reviewing a completed task's code | Ralph | `templates/review.md` |
| `fix` | Fixing issues found in review | Ralph | `templates/fix.md` |

Unknown types fall back to `templates/default.md`.

### Task fields reference

| Field | Required? | Default | Description |
|-------|-----------|---------|-------------|
| `id` | System-generated | `task-NNN` | Unique identifier |
| `type` | No | `feature` | Task type (selects prompt template) |
| `priority` | No | `100` | Lower number = picked first (Unix nice-style) |
| `parent_id` | No | -- | Links follow-up tasks to their parent |
| `commit_hash` | System-set | -- | Set by Ralph on completion |
| `description` | Yes | -- | The Markdown body of the file |

Status is derived from which directory the file is in — it's not a field in the frontmatter.

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
done:     14 tasks
failed:   1 task

Last activity: 2 minutes ago (ralph(task-002): claimed)
```

### List tasks

```sh
ralph task list
```

```
ID        Status   Pri  Type     Description
────────  ───────  ───  ───────  ─────────────────────────────────────
task-005  pending  200  bugfix   Fix null check in authenticate()
task-004  pending  150  feature  Add rate limiting to /api/login
task-003  pending  100  feature  Update dependencies to latest
task-002  active   100  bugfix   Handle timeout in payment webhook
task-001  done     100  feature  Add user profile page
```

### Filter by status

```sh
ralph task list --status pending
ralph task list --status failed
ralph task list --json
```

## The Autonomous Cycle

Ralph doesn't need you to review code. It reviews its own work:

```
feature/bugfix completes
  └─ verify passes → task moves to done/
      └─ Ralph spawns a review task → pending/
          └─ Review passes → Ralph merges the branch ✓
          └─ Review fails → Ralph spawns a fix task → pending/
              └─ Fix completes → verify passes → done/
                  └─ Ralph spawns another review → pending/
                      └─ Review passes → merge ✓
                      └─ Review fails → spawn fix → ...
                          └─ Fix fails → chain stops ✗
```

**Key rules:**
- All tasks in a chain share one branch: `ralph/<root-task-id>`
- Follow-up tasks link to their parent via `parent_id`
- A fix failure is a dead end — the chain stops, preventing infinite loops
- Successful reviews trigger an automatic merge to `main`

## What Ralph Does With Your Task

When Ralph picks up a task, here's the full cycle:

1. **Pull** — fetches latest `main`, fast-forward merge
2. **Claim** — `git mv pending/task.md active/task.md`, commit, push
3. **Branch** — creates or checks out `ralph/<task-id>` from `main`
4. **Build prompt** — reads task file, selects template by type, interpolates variables into the prompt
5. **Execute** — runs Claude Code with the built prompt, model, turn limits, and permission mode
6. **Verify** — runs your configured verify command
7. **Transition** — if verified: push branch, move to `done/`, spawn follow-up tasks, merge if review passed. If failed: move to `failed/`, spawn follow-ups.

Every state transition is a git commit. The git log IS the audit trail:

```
ralph(task-002): claimed
ralph(task-002): work complete
ralph(task-002): done
ralph(task-003): spawned (review of task-002)
```

### Crash recovery

If Ralph dies mid-task, it reclaims orphaned `active/` tasks on restart. Any task found in `active/` is moved back to `pending/` and its stale branch is cleaned up.

## Health Check

```sh
ralph doctor
```

Verifies that your project is correctly configured:

```
Ralph Doctor
────────────
[OK]  Git repository detected
[OK]  Configuration is valid
[OK]  Task directories exist (pending, active, done, failed)
[OK]  Claude CLI is available
────────────
4 checks passed
```

## Environment Variables

These are set on the VPS only (via `.env`, `docker run -e`, or `/etc/ralph/<project>.env`). Never committed to git.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | -- | Your Anthropic API key |
| `TASK_REPO_URL` | Yes | -- | Git remote URL (SSH recommended) |
| `GIT_AUTHOR_NAME` | No | `Ralph` | Git author for Ralph's commits |
| `GIT_AUTHOR_EMAIL` | No | `ralph@helico.dev` | Git email for Ralph's commits |
| `RALPH_MODEL` | No | `claude-opus-4-5` | Override model for Claude |
| `RALPH_MAIN_BRANCH` | No | `main` | Override main branch |
| `RALPH_PERMISSION_MODE` | No | `skip_all` | Override Claude permission mode |

## Prompt Templates

Ralph uses prompt templates to give Claude task-specific instructions. Templates live in `templates/` at the project root.

Five templates ship with Ralph:

- `templates/feature.md` — implement new functionality
- `templates/bugfix.md` — reproduce, fix, regression test
- `templates/review.md` — review code changes from a parent task
- `templates/fix.md` — fix issues found during review
- `templates/default.md` — generic fallback for unknown types

Templates use `{{variable}}` interpolation:

```markdown
## Task: {{id}}

Type: {{type}} | Priority: {{priority}}

{{description}}
```

Available template variables:

| Variable | Source |
|----------|--------|
| `{{id}}` | Task ID |
| `{{type}}` | Task type |
| `{{description}}` | Task body (Markdown) |
| `{{priority}}` | Priority number |
| `{{parent_id}}` | Parent task ID (empty if none) |

The system prompt (`templates/ralph-system.md`) uses its own variables:

| Variable | Source |
|----------|--------|
| `{{project_name}}` | From `config.project.name` |
| `{{verify_command}}` | From `config.verify` |

The system prompt provides behavioral rules that apply to ALL tasks — autonomy, git discipline, scope boundaries, verification requirements, and what to do when stuck. It's separate from your project's `CLAUDE.md`, which contains project conventions.

## Project Structure

```
your-project/
├── src/                        # Your application code
├── test/                       # Your tests
├── .ralph/
│   ├── config.json             # Ralph configuration (committed)
│   └── tasks/
│       ├── pending/            # Tasks waiting to be picked up
│       ├── active/             # Currently being executed
│       ├── done/               # Completed and merged
│       └── failed/             # Could not be completed
├── templates/
│   ├── ralph-system.md         # System prompt for Claude
│   ├── feature.md              # Feature task template
│   ├── bugfix.md               # Bugfix task template
│   ├── review.md               # Review task template
│   ├── fix.md                  # Fix task template
│   └── default.md              # Generic fallback template
├── CLAUDE.md                   # Project conventions (for Claude Code)
└── ...
```

## Design Principles

- **Git is the only state store.** No databases, no message queues. If it's not in git, it doesn't exist.
- **Autonomous self-review.** Ralph reviews its own work, fixes issues, and merges — no human bottleneck.
- **Bounded autonomy.** Fix failures stop the chain. No infinite loops, no runaway costs.
- **Explicit file staging.** Ralph never runs `git add -A`. Every staged file is intentional.
- **Multi-instance support.** Run multiple Ralph instances against the same repo via systemd templates.
- **Per-task branches.** Code changes live on `ralph/<task-id>`, keeping `main` clean.
- **Crash recovery.** If Ralph dies mid-task, it reclaims orphaned `active/` tasks on restart.
- **Docker is the sandbox.** The container IS the security boundary. Claude can't escape it.

## License

MIT
