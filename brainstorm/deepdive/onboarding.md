# Deep Dive: Onboarding & First Run Experience

> Architecture B context: TypeScript/Bun orchestrator, hexagonal architecture, Claude Code headless execution, git-tracked task queue.

---

## 1. Two Paths: Docker vs Bare VPS

### Path Comparison

| Dimension | Docker | Bare VPS |
|-----------|--------|----------|
| **Setup complexity** | Medium (install Docker, pull image) | Higher (install Bun, clone, configure services) |
| **Isolation** | Full (container boundary) | None (shared system) |
| **Reproducibility** | High (Dockerfile = spec) | Medium (cloud-init helps, but drift happens) |
| **Resource overhead** | ~50-100MB RAM for Docker daemon | Zero overhead |
| **Debugging access** | Harder (`docker exec`, log forwarding) | Easier (just SSH in) |
| **Updates** | Rebuild/pull image | `git pull && bun install` |
| **Cost** | Same VPS cost, slightly more RAM | Same VPS cost |
| **Recovery** | `docker restart` | `systemctl restart ralph` |
| **Non-Linux user friendliness** | Better (fewer moving parts to break) | Worse (more system admin needed) |

### Recommendation: Docker for V1, Bare VPS as Documented Alternative

Docker wins for non-Linux users because:
1. One install (Docker) vs many installs (Bun, git, deps).
2. The Dockerfile IS the environment spec -- reproducible, version-locked.
3. Broken state? `docker stop && docker rm && docker run`. No orphaned processes, no corrupted global installs.
4. The user never needs to know about systemd, PATH, or shell profiles.

Bare VPS is the escape hatch for users who want more control or are running on constrained hardware (1GB RAM droplets where Docker's overhead matters).

### Can We Provide a Single `ralph init`?

Yes, but it should detect the environment and branch:

```
ralph init
  -> Are you setting up a new node? (y/n)
     -> y: ralph init node
        -> Docker or bare? (docker/bare)
           -> docker: ralph init node --docker
           -> bare:   ralph init node --bare
     -> n: ralph init project  (just add .ralph/ to current project)
```

`ralph init` is really two commands:
1. **`ralph init node`** -- provisions the remote machine (one-time setup)
2. **`ralph init project`** -- adds Ralph to an existing codebase (per-project)

These are deliberately separate because one node runs tasks for many projects.

---

## 2. Prerequisites

### On the User's Laptop

| Prerequisite | Required? | Why |
|-------------|-----------|-----|
| **Git** | Yes | Ralph's entire state model is git |
| **Claude Code CLI** | Yes | For skills (`/ralph-task`, `/ralph-status`, etc.) and local testing |
| **SSH client** | Yes | To provision the node (comes with macOS/Linux, Git Bash on Windows) |
| **GitHub/GitLab account** | Yes | Repos must be accessible from the node |

That's it. The user's laptop is the **control plane** -- it creates tasks, reviews results, and manages the node. It does NOT run the orchestrator.

### Accounts & Keys

| Account | Required? | How to Get |
|---------|-----------|-----------|
| **Anthropic API key** | Yes | console.anthropic.com -- create a key with usage limits |
| **VPS provider account** | Yes | Hetzner (recommended), DigitalOcean, or any SSH-accessible Linux box |
| **GitHub/GitLab SSH key** | Yes | The node needs read/write access to repos. Deploy keys (per-repo) or a machine user account |

### On the Node (Installed by `ralph init node`)

| Component | Docker Path | Bare VPS Path |
|-----------|------------|---------------|
| **Docker** | Yes | No |
| **Bun** | Inside container | Yes (system-level) |
| **Git** | Inside container | Yes (system-level) |
| **Claude Code CLI** | Inside container | Yes (system-level) |
| **SSH keys** | Mounted or built into image | In `~/.ssh/` |
| **Ralph orchestrator** | Container entrypoint | systemd service |

### Minimum VPS Specs

- **Hetzner CX22**: 2 vCPU, 4GB RAM, 40GB disk, ~EUR 4.50/mo (consensus pick)
- **DigitalOcean**: Basic Droplet, 2 vCPU, 2GB RAM, ~$12/mo
- **Any provider**: Ubuntu 22.04+ LTS, 2GB+ RAM, SSH access

4GB RAM is recommended because Claude Code itself uses ~500MB, and builds/tests need headroom. 2GB works but will swap on larger projects.

---

## 3. The Setup Script: `ralph init node`

### Design Principles

1. **Idempotent** -- running it twice doesn't break anything.
2. **Transparent** -- every action is logged. No silent failures.
3. **Resumable** -- if it fails at step 5, re-running picks up at step 5.
4. **No Linux knowledge required** -- the user answers questions, the script does the work.

### Docker Path: `ralph init node --docker`

```
ralph init node --docker

Step 1/7: Connecting to node...
  SSH host: [user input or from config]
  SSH user: root (will create 'ralph' user)

Step 2/7: Creating ralph user...
  -> Created user 'ralph' with sudo access
  -> Installed SSH key for passwordless login

Step 3/7: Installing Docker...
  -> Added Docker apt repository
  -> Installed docker-ce, docker-ce-cli, containerd
  -> Added 'ralph' user to docker group
  -> Docker version: 26.1.3

Step 4/7: Configuring git access...
  -> Generated SSH keypair for node
  -> PUBLIC KEY (add this to GitHub as a deploy key):
     ssh-ed25519 AAAA... ralph-node@hostname
  [Press Enter when done]
  -> Verified: git clone works

Step 5/7: Setting up Ralph container...
  -> Pulled ralph:latest image
  -> Created /home/ralph/ralph-data/ for persistent config
  -> Started container with:
     - ANTHROPIC_API_KEY mounted from environment
     - SSH keys mounted read-only
     - Git config mounted

Step 6/7: Configuring API key...
  Anthropic API key: [user input, masked]
  -> Stored in /home/ralph/ralph-data/.env (chmod 600)
  -> Verified: API key is valid

Step 7/7: Running health check...
  -> Container is running
  -> Git access: OK
  -> API key: valid
  -> Claude Code: responsive
  -> Node is ready!

Next: Run 'ralph init project' in a project directory to start using Ralph.
```

### Bare VPS Path: `ralph init node --bare`

```
ralph init node --bare

Step 1/8: Connecting to node...
  SSH host: [user input]

Step 2/8: Creating ralph user...
  -> Same as Docker path

Step 3/8: Installing system dependencies...
  -> Updated apt
  -> Installed: git, curl, unzip, jq, build-essential
  -> Git version: 2.43.0

Step 4/8: Installing Bun...
  -> curl -fsSL https://bun.com/install | bash
  -> Bun version: 1.1.x
  -> Added to PATH in ~/.bashrc

Step 5/8: Installing Claude Code...
  -> curl -fsSL https://claude.ai/install.sh | bash
  -> Claude Code version: x.y.z

Step 6/8: Configuring git access...
  -> Same as Docker path (SSH key generation + deploy key)

Step 7/8: Setting up Ralph service...
  -> Cloned ralph orchestrator to /home/ralph/ralph
  -> Ran bun install
  -> Created systemd service: ralph-worker.service
  -> Configured API key in /home/ralph/.env

Step 8/8: Running health check...
  -> Same as Docker path
```

### Implementation: The Init Script

The init script runs **from the user's laptop** and provisions the node over SSH. It does NOT require anything pre-installed on the node beyond SSH access.

```typescript
// src/cli/commands/init-node.ts (simplified)

export async function initNode(options: { mode: 'docker' | 'bare', host: string }) {
  const ssh = new SSHConnection(options.host);

  // Step 1: Create ralph user
  await ssh.exec('useradd -m -s /bin/bash ralph');
  await ssh.exec('usermod -aG sudo ralph');
  await ssh.copyAuthorizedKeys('ralph');

  if (options.mode === 'docker') {
    // Step 2: Install Docker
    await ssh.exec(DOCKER_INSTALL_SCRIPT);
    await ssh.exec('usermod -aG docker ralph');

    // Step 3: Build/pull image
    await ssh.exec('docker pull ghcr.io/helico/ralph:latest');

    // Step 4: Configure and start
    await ssh.uploadFile('.env', '/home/ralph/ralph-data/.env');
    await ssh.exec(DOCKER_RUN_COMMAND);
  } else {
    // Step 2: Install Bun
    await ssh.execAs('ralph', 'curl -fsSL https://bun.com/install | bash');

    // Step 3: Install Claude Code
    await ssh.execAs('ralph', 'curl -fsSL https://claude.ai/install.sh | bash');

    // Step 4: Clone and configure
    await ssh.execAs('ralph', 'git clone ... /home/ralph/ralph');
    await ssh.execAs('ralph', 'cd /home/ralph/ralph && bun install');

    // Step 5: systemd service
    await ssh.uploadFile('ralph-worker.service', '/etc/systemd/system/');
    await ssh.exec('systemctl enable --now ralph-worker');
  }

  // Health check
  await runHealthCheck(ssh);
}
```

### SSH Key Setup: The Hardest Part for Non-Linux Users

Git access from the node is the biggest friction point. Here's how to minimize it:

**Option A: Deploy keys (recommended for beginners)**
- Ralph generates a keypair on the node during init
- Displays the public key
- User adds it as a deploy key on GitHub (we open the browser URL)
- One key per repo, read-write access

**Option B: Machine user (recommended for multi-repo)**
- Create a GitHub account like `ralph-bot`
- Add the node's public key to that account
- Add `ralph-bot` as a collaborator on all target repos
- One key, multiple repos

**Option C: GitHub App (future, most secure)**
- Install a GitHub App with scoped permissions
- Token-based auth, auto-rotating
- No SSH keys needed
- Complex to set up but most secure

For V1: Deploy keys. Show the user exactly what to do with screenshots in the docs.

### API Key Provisioning

```
ralph init node --docker

...
Step 6/7: Configuring API key...

  You need an Anthropic API key.
  Get one at: https://console.anthropic.com/settings/keys

  1. Create a new key (name it "ralph-node-<hostname>")
  2. Set a monthly spending limit (recommended: $50 for testing)
  3. Paste the key below

  API key: sk-ant-... [masked after entry]

  -> Stored securely on node
  -> Verified: API key is valid (model: claude-sonnet-4-20250514)
```

Key storage:
- Docker: `/home/ralph/ralph-data/.env` mounted into container
- Bare VPS: `/home/ralph/.env` with `chmod 600`
- Never committed to git. Never logged. Never displayed after initial entry.

---

## 4. First Task Experience: "Hello, Ralph"

### The Goal

After `ralph init node` and `ralph init project`, the user should be able to run ONE command and see Ralph execute a task end-to-end in under 5 minutes.

### The Hello Task

```
ralph hello
```

This creates a guided first task that:
1. Creates a simple file (`ralph-hello.md` in the project root)
2. Runs through the full lifecycle: pending -> active -> review -> done
3. Shows the user what happened at each step
4. Proves git sync, Claude execution, and status tracking all work

What it does under the hood:

```markdown
---
id: hello-001
title: Create a hello world file
type: default
priority: 100
acceptance_criteria:
  - "File ralph-hello.md exists in project root"
  - "File contains a greeting and today's date"
---
## Description
Create a file called `ralph-hello.md` in the project root.
It should contain a friendly greeting and today's date.
This is a test task to verify Ralph is working correctly.
```

### Expected Flow (What the User Sees)

```
$ ralph hello

Creating your first Ralph task...
  -> Created .ralph/tasks/pending/hello-001.md
  -> Committed and pushed to origin/main

Waiting for Ralph to pick it up...
  [=====>                    ] Waiting for node to claim task...
  [=============>            ] Task claimed! Ralph is working...
  [=====================>    ] Task completed, verifying...
  [==========================] Done!

Result:
  Status: review (waiting for your approval)
  Branch: ralph/hello-001
  Files changed:
    + ralph-hello.md (new file)

  Preview of ralph-hello.md:
  ----------------------------------------
  # Hello from Ralph!

  This file was created by Ralph on 2026-03-03.
  Your setup is working correctly.
  ----------------------------------------

To approve this task:
  ralph review hello-001 --approve

To see the full diff:
  git diff main..ralph/hello-001
```

### Timing Expectations

| Phase | Expected Time |
|-------|-------------|
| Task creation + push | 2-5 seconds |
| Node picks up task (poll interval) | 0-30 seconds |
| Claude executes task | 10-30 seconds |
| Verification (no tests for hello) | 1-2 seconds |
| Push result + status update | 2-5 seconds |
| **Total** | **15 seconds - 1 minute** |

### What If It Fails?

The `ralph hello` command should have built-in diagnostics:

```
$ ralph hello

Creating your first Ralph task...
  -> Created .ralph/tasks/pending/hello-001.md
  -> Committed and pushed to origin/main

Waiting for Ralph to pick it up...
  [=====>                    ] Waiting for node to claim task...

  WARNING: Task not claimed after 60 seconds.
  Running diagnostics...

  [x] Node is reachable (SSH OK)
  [x] Ralph service is running
  [ ] Git sync issue: node cannot pull from origin
      -> Error: Permission denied (publickey)
      -> Fix: Add the node's deploy key to your GitHub repo
      -> Run: ralph doctor --fix git-access
```

---

## 5. Project Onboarding: `ralph init project`

### What It Does

Adds the `.ralph/` directory structure to an existing project and configures it for Ralph.

```
$ cd my-project
$ ralph init project

Initializing Ralph in /Users/me/my-project...

Step 1/4: Creating directory structure...
  -> .ralph/tasks/pending/
  -> .ralph/tasks/active/
  -> .ralph/tasks/review/
  -> .ralph/tasks/done/
  -> .ralph/tasks/failed/
  -> .ralph/templates/default.md
  -> .ralph/config.json

Step 2/4: Detecting project type...
  -> Detected: TypeScript (package.json with bun)
  -> Test command: bun test
  -> Build command: bun run build
  -> Lint command: bun run lint

Step 3/4: Generating configuration...
  -> .ralph/config.json (edit to customize)
  -> .ralph/templates/default.md (base prompt template)
  -> .gitignore updated (added .ralph/tasks/active/)

Step 4/4: Adding to CLAUDE.md...
  -> Appended Ralph instructions to .claude/CLAUDE.md

Done! Create your first task:
  ralph task create --title "Fix the login bug" --type bugfix
```

### Minimal `.ralph/` Setup

```
.ralph/
  config.json              # Project-level configuration
  ralph-system.md          # System prompt appended to all tasks
  templates/
    default.md             # Fallback template
  tasks/
    pending/               # User creates tasks here
      .gitkeep
    active/                # Orchestrator moves tasks here
      .gitkeep
    review/                # Completed, awaiting human review
      .gitkeep
    done/                  # Approved by human
      .gitkeep
    failed/                # Failed after retries
      .gitkeep
```

### `config.json`

```json
{
  "version": 1,
  "project": {
    "name": "my-project",
    "repo": "git@github.com:user/my-project.git"
  },
  "commands": {
    "test": "bun test",
    "build": "bun run build",
    "lint": "bun run lint"
  },
  "task_defaults": {
    "max_retries": 2,
    "timeout_minutes": 30,
    "max_budget_usd": 5,
    "model": "claude-sonnet-4-20250514"
  },
  "node": {
    "host": "ralph-node.example.com",
    "user": "ralph"
  }
}
```

### Project Detection

`ralph init project` should auto-detect the project type and pre-fill commands:

| Detected File | Project Type | Test | Build | Lint |
|---------------|-------------|------|-------|------|
| `package.json` + `bun.lockb` | Bun/TypeScript | `bun test` | `bun run build` | `bun run lint` |
| `package.json` + `package-lock.json` | Node/npm | `npm test` | `npm run build` | `npm run lint` |
| `Cargo.toml` | Rust | `cargo test` | `cargo build` | `cargo clippy` |
| `go.mod` | Go | `go test ./...` | `go build ./...` | `golangci-lint run` |
| `pyproject.toml` | Python | `pytest` | (none) | `ruff check` |
| `Makefile` | Generic | `make test` | `make build` | `make lint` |

All auto-detected values go into `config.json` and can be edited.

### What Goes in CLAUDE.md

The `ralph init project` command appends a section to the project's `.claude/CLAUDE.md`:

```markdown
# Ralph Task Execution

When executing Ralph tasks, follow these rules:

1. Read the task file completely before starting
2. Only modify files mentioned in the task's `files` field, unless the task requires creating new files
3. Run the test command after every significant change
4. Never modify files under `.ralph/` except the current task file's metadata
5. Commit your changes with the message format: `ralph(<task-id>): <description>`
6. If you're stuck, add a comment to the task file explaining what went wrong rather than making random changes
```

### `.gitignore` Considerations

```gitignore
# Ralph - don't track active task working state
# (active tasks are tracked by the orchestrator, not by the user)
# Note: we DO track pending/, review/, done/, failed/ -- that's the point
```

Critically, we do NOT gitignore any task directories. The whole point is that git IS the state store. The `.gitkeep` files ensure empty directories are tracked.

---

## 6. Failure Modes During Setup

### The Failure Taxonomy

| Failure | Frequency | Severity | Self-fixable? |
|---------|-----------|----------|---------------|
| SSH connection refused | Common | Blocking | Yes (firewall/key issue) |
| Git deploy key not added | Very Common | Blocking | Yes (user forgot the step) |
| API key invalid/expired | Common | Blocking | Yes (regenerate key) |
| Docker not starting | Uncommon | Blocking | Usually (restart service) |
| Bun install fails (bare) | Rare | Blocking | Yes (kernel version) |
| Claude Code install fails | Rare | Blocking | Yes (retry usually works) |
| Disk full | Rare | Blocking | Yes (resize volume) |
| Node can't reach api.anthropic.com | Uncommon | Blocking | Maybe (firewall/DNS) |
| Wrong git remote URL | Common | Soft | Yes (update config) |
| Tests fail on node but pass locally | Uncommon | Soft | No (environment mismatch -- needs investigation) |

### The `ralph doctor` Command

```
$ ralph doctor

Ralph Doctor - Checking system health...

Local Environment:
  [OK] Git installed (2.44.0)
  [OK] Claude Code installed (2.1.0)
  [OK] SSH client available

Node Connection:
  [OK] SSH connection to ralph-node (192.168.1.100)
  [OK] ralph user exists and is accessible
  [OK] Node uptime: 14 days

Node Runtime:
  [OK] Docker is running (26.1.3)
  [OK] Ralph container is running (up 3 hours)
  [OK] Bun version: 1.1.38 (inside container)
  [OK] Claude Code version: 2.1.0 (inside container)

Git Access:
  [OK] Node can reach github.com
  [OK] Node can clone my-project (deploy key valid)
  [OK] Node can push to my-project

API Access:
  [OK] ANTHROPIC_API_KEY is set
  [OK] API key is valid
  [OK] Model access: claude-sonnet-4-20250514
  [WARN] Monthly usage: $47.20 / $50.00 limit (94%)
         -> Consider increasing your limit at console.anthropic.com

Task Queue:
  [OK] .ralph/ directory exists in my-project
  [OK] 0 pending, 0 active, 3 review, 12 done, 1 failed

Overall: HEALTHY (1 warning)
```

### `ralph doctor --fix`

For common issues, doctor should offer to fix them:

```
$ ralph doctor

...
Git Access:
  [FAIL] Node cannot clone my-project
         Error: Permission denied (publickey)

Fix available! Run: ralph doctor --fix git-access

$ ralph doctor --fix git-access

Fixing git access...
  -> Node's public key:
     ssh-ed25519 AAAA... ralph-node@hostname

  This key needs to be added as a deploy key on GitHub.

  Repository: github.com/user/my-project
  Settings URL: https://github.com/user/my-project/settings/keys

  Steps:
  1. Open the URL above in your browser
  2. Click "Add deploy key"
  3. Title: ralph-node
  4. Paste the key above
  5. Check "Allow write access"
  6. Click "Add key"

  Press Enter when done...

  -> Testing... OK! Git access is working.
```

### Common Failure Scenarios and Solutions

#### 1. "API key works locally but not on the node"

**Cause:** Key was set in the user's shell but not in the node's environment.
**Fix:** `ralph doctor --fix api-key` re-prompts for the key and writes it to the node's `.env`.

#### 2. "Task stays in pending forever"

**Cause:** One of:
- Node is down
- Node can't pull from origin (git access)
- Ralph service crashed
- API key exhausted

**Fix:** `ralph doctor` checks all of these. `ralph logs` shows the orchestrator's output.

#### 3. "Task fails but tests pass locally"

**Cause:** Environment mismatch between local and node. Missing env vars, different OS, different tool versions.
**Fix:** `ralph doctor --check-env` compares local and node environments. Document the diff.

#### 4. "Git push rejected on the node"

**Cause:** Another process pushed to the same branch, or the user pushed to main while Ralph was working.
**Fix:** Ralph's orchestrator should handle this with `git pull --rebase` before push. If it still fails, the task goes to `failed` with a clear error message.

#### 5. "Docker container keeps restarting"

**Cause:** Usually OOM (out of memory) or a crash in the orchestrator.
**Fix:** `ralph logs --tail 50` shows the last 50 lines. `ralph doctor` checks available memory.

---

## 7. Documentation Structure

### What Docs the Project Needs

```
docs/
  README.md                    # Project overview + quick links
  quickstart.md                # 5-minute setup (the happy path)
  guides/
    setup-docker.md            # Detailed Docker setup
    setup-bare-vps.md          # Detailed bare VPS setup
    creating-tasks.md          # How to write good task files
    reviewing-results.md       # How to review and approve Ralph's work
    configuration.md           # All config options explained
    prompt-templates.md        # How to customize templates
    multi-project.md           # Running Ralph across multiple repos
  reference/
    cli.md                     # All CLI commands
    config-schema.md           # config.json schema
    task-schema.md             # Task file schema
    state-machine.md           # State transitions explained
  troubleshooting/
    common-issues.md           # FAQ / known issues
    doctor-guide.md            # Using ralph doctor
    ssh-keys.md                # SSH key setup in detail
    api-keys.md                # API key management
```

### Quick Start Guide Structure

```markdown
# Ralph Quick Start

## What You'll Need (2 minutes)
- A GitHub account with a project repo
- An Anthropic API key (console.anthropic.com)
- A VPS (Hetzner CX22 recommended, ~EUR 4.50/mo)

## Set Up Your Node (5 minutes)
  $ ralph init node --docker
  [guided flow]

## Add Ralph to Your Project (2 minutes)
  $ cd my-project
  $ ralph init project
  [guided flow]

## Run Your First Task (1 minute)
  $ ralph hello
  [watch it work]

## Create a Real Task (1 minute)
  $ ralph task create --title "Add input validation to signup form" --type feature
  [or use /ralph-task skill in Claude Code]

## What's Next?
- Customize prompt templates: docs/guides/prompt-templates.md
- Set up multiple projects: docs/guides/multi-project.md
- Troubleshooting: docs/troubleshooting/common-issues.md
```

Total time: ~10 minutes from zero to first task executed.

### Troubleshooting Guide Structure

```markdown
# Troubleshooting

## Quick Diagnostics
  $ ralph doctor           # Full health check
  $ ralph logs             # Recent orchestrator logs
  $ ralph status           # Current task queue state

## Common Issues

### Setup Issues
- "SSH connection refused"        -> Check firewall, SSH key
- "Docker not found"              -> Re-run ralph init node --docker
- "API key invalid"               -> Regenerate at console.anthropic.com

### Runtime Issues
- "Task stuck in pending"         -> ralph doctor (checks node health)
- "Task stuck in active"          -> ralph logs (check for crashes)
- "Task failed"                   -> ralph show <task-id> (see error details)

### Git Issues
- "Permission denied (publickey)" -> ralph doctor --fix git-access
- "Push rejected"                 -> Usually a concurrent push; Ralph retries automatically

## Getting Help
- ralph doctor --verbose          # Detailed diagnostics
- ralph logs --full               # Complete orchestrator log
- GitHub Issues: [link]
```

---

## 8. Implementation Priorities for V1

### What to Build First

1. **`ralph init project`** -- this is pure local scaffolding, zero risk, immediately useful
2. **`ralph hello`** -- proves the system works, best onboarding tool possible
3. **`ralph doctor`** -- essential for debugging, saves hours of support
4. **`ralph init node --docker`** -- automated provisioning over SSH
5. **`ralph init node --bare`** -- alternative path, can come later

### What to Skip in V1

- GitHub App authentication (deploy keys are fine)
- Multi-node setups
- Automatic VPS provisioning via provider API (user creates the VPS manually, Ralph sets it up)
- Web dashboard for monitoring
- Automatic project detection beyond the basic table above

### The `ralph init` Command Hierarchy

```
ralph init
  ralph init project             # Add .ralph/ to current project
  ralph init node                # Provision a remote node
    ralph init node --docker     # Docker deployment
    ralph init node --bare       # Bare VPS deployment
  ralph hello                    # First task walkthrough
  ralph doctor                   # Diagnose issues
    ralph doctor --fix <issue>   # Auto-fix known issues
    ralph doctor --check-env     # Compare local vs node env
```

---

## 9. Security Considerations

### API Key Handling

- Never store API keys in git, config files committed to git, or environment variables in Dockerfiles
- Store in `/home/ralph/.env` on the node with `chmod 600`
- Mount into Docker container via `--env-file` (not `-e` which shows in `ps aux`)
- `ralph init` masks key input and never displays it after storage
- `ralph doctor` validates the key works but never displays it

### SSH Key Management

- Ralph generates ED25519 keys (not RSA) -- smaller, faster, more secure
- Private keys stay on the node, never leave
- Deploy keys are scoped to specific repos (principle of least privilege)
- `ralph init` never asks the user to copy private keys

### Node Access

- `ralph init` creates a dedicated `ralph` user, not root
- Docker socket access is the biggest privilege (equivalent to root) -- documented clearly
- Bare VPS: ralph user has sudo for service management only
- Firewall: only port 22 (SSH) needs to be open. Ralph is entirely outbound (pulls from git, pushes to git, calls API)

---

## 10. Open Questions

### Q1: Should `ralph init node` use the VPS provider's API?

**Pro:** Full automation -- user doesn't even need to create the VPS manually.
**Con:** API key management for the provider, provider-specific code, another secret to manage.
**Recommendation:** No for V1. The user creates the VPS manually (it's a one-time 5-minute task on any provider's web UI). `ralph init node` takes over once SSH is available.

### Q2: How do we handle Claude Code authentication on the node?

Claude Code supports two auth modes relevant to us:
1. **API key via `ANTHROPIC_API_KEY`** -- simplest, what we use
2. **OAuth via browser** -- requires interactive login, not suitable for headless

For headless/server use, `ANTHROPIC_API_KEY` is the only viable option. This is well-documented by Anthropic for CI/CD use cases. The user creates a key at console.anthropic.com and provides it during `ralph init node`.

### Q3: Should `ralph init project` be a Claude Code skill too?

**Pro:** Users already in Claude Code can type `/ralph-init` instead of switching to terminal.
**Con:** Skills can't create directories or modify `.gitignore` reliably.
**Recommendation:** CLI command first, skill as a convenience wrapper later if needed.

### Q4: How do we handle node updates?

For Docker:
```bash
ralph update node  # Pulls latest image, restarts container
```

For bare VPS:
```bash
ralph update node  # SSH in, git pull, bun install, restart service
```

Both should be a single command. The user should never SSH into the node manually for routine operations.

### Q5: Multiple projects on one node?

The node watches a configurable list of repos. Each repo has its own `.ralph/` directory. The orchestrator round-robins across repos or can be configured with priorities.

For V1: one project per node invocation. Multi-project is a V2 concern.
