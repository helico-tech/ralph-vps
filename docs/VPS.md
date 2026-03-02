# Provisioning Ralph on a Hetzner VPS

Complete guide to getting Ralph running on a Hetzner Cloud VPS so you can remotely dispatch AI-powered coding tasks.

## Architecture Overview

```
┌─────────────────────┐          SSH (control)          ┌──────────────────────┐
│   Your Machine      │ ──────────────────────────────▶ │   Hetzner VPS        │
│                     │                                 │                      │
│   ralph remote      │          Git (data)             │   ralph loop run     │
│   ralph node add    │ ◀──────────────────────────────▶│   (inside tmux)      │
│                     │       (shared git remote)       │                      │
│   .ralph/           │                                 │   .ralph/            │
│     client.json     │                                 │     project.json     │
│     tasks/          │                                 │     tasks/           │
└─────────────────────┘                                 └──────────────────────┘
```

- **SSH** is the control plane — you send commands (`loop start`, `loop status`, etc.)
- **Git** is the data plane — tasks are markdown files synced via a shared remote (GitHub, etc.)
- **No daemon, no API server** — the VPS just runs `ralph` via SSH

## 1. Create the Hetzner VPS

Go to [Hetzner Cloud Console](https://console.hetzner.cloud/) and create a server:

| Setting | Recommendation |
|---|---|
| **Location** | Falkenstein (fsn1) or Nuremberg (nbg1) — cheapest EU |
| **Image** | Ubuntu 24.04 |
| **Type** | CX22 (2 vCPU, 4 GB RAM) — minimum viable; CX32 if running multiple projects |
| **SSH Key** | Add your public key during creation |
| **Networking** | Public IPv4 + IPv6 |
| **Firewall** | Allow TCP 22 inbound only |

Cost: ~€4-8/month. Ralph itself is lightweight — the bottleneck is the Claude API, not compute.

## 2. Initial Server Setup

SSH in as root and lock things down:

```bash
ssh root@<your-vps-ip>
```

### 2.1 System Updates

```bash
apt update && apt upgrade -y
```

### 2.2 Create the `ralph` User

```bash
useradd -m -s /bin/bash ralph
mkdir -p /home/ralph/.ssh
cp ~/.ssh/authorized_keys /home/ralph/.ssh/authorized_keys
chmod 700 /home/ralph/.ssh
chmod 600 /home/ralph/.ssh/authorized_keys
chown -R ralph:ralph /home/ralph/.ssh
```

If you want to use a **separate** SSH key for Ralph (recommended), replace the `cp` step:

```bash
echo "ssh-ed25519 AAAA... your-ralph-key" > /home/ralph/.ssh/authorized_keys
```

### 2.3 Harden SSH

Edit `/etc/ssh/sshd_config`:

```
Port 22
PermitRootLogin no
PubkeyAuthentication yes
PasswordAuthentication no
ChallengeResponseAuthentication no
X11Forwarding no
```

```bash
systemctl restart sshd
```

> **Test** that you can `ssh ralph@<your-vps-ip>` before you close the root session.

### 2.4 Firewall (if not using Hetzner's Cloud Firewall)

```bash
apt install -y ufw
ufw allow 22/tcp
ufw enable
```

## 3. Install Dependencies

SSH in as `ralph`:

```bash
ssh ralph@<your-vps-ip>
```

### 3.1 System Packages

```bash
sudo apt install -y git tmux
```

That's it for system packages. SSH server is already running.

### 3.2 Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version
```

### 3.3 Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
# or via bun:
bun install -g @anthropic-ai/claude-code
```

Authenticate:

```bash
claude auth login
# Follow the prompts — you need an Anthropic API key or OAuth
```

Verify it works:

```bash
claude --version
claude -p "Say hello" --output-format text
```

### 3.4 Install Ralph

Clone the ralph repo and link it globally:

```bash
mkdir -p ~/tools
cd ~/tools
git clone <your-ralph-repo-url> ralph
cd ralph
bun install
bun link
```

This puts `ralph` on your PATH. Verify:

```bash
ralph version
```

### 3.5 Configure Git

Required for task state commits:

```bash
git config --global user.name "Ralph Bot"
git config --global user.email "ralph@yourdomain.com"
```

## 4. Set Up the API Key

The Claude CLI needs authentication when `ralph loop run` spawns it inside tmux. Add to `~/.bashrc`:

```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.bashrc
```

> tmux inherits the environment of the shell that launches it, so `.bashrc` works.
> If you use `.profile` instead, make sure tmux sessions pick it up.

## 5. Set Up a Project on the VPS

### 5.1 Clone Your Project

```bash
mkdir -p ~/projects
cd ~/projects
git clone git@github.com:you/your-project.git
cd your-project
```

> Make sure the VPS has SSH key access to your git remote. Either generate a deploy key on the VPS (`ssh-keygen -t ed25519`) and add it to GitHub, or use HTTPS with a token.

### 5.2 Initialize Ralph

```bash
ralph init project my-project
```

This creates:
```
.ralph/
  project.json          # Project config
  tasks/                # Task storage
  types/                # Custom type templates
.ralph-local/
  logs/                 # Iteration logs (gitignored)
```

### 5.3 Sync Built-in Task Types

```bash
ralph sync
```

Copies the built-in prompt templates (`feature-dev`, `bug-fix`, `research`, `review`) to `.ralph/types/`.

### 5.4 Commit the Ralph Config

```bash
git add .ralph/
git commit -m "Initialize Ralph project config"
git push
```

## 6. Set Up Your Local Machine (Client)

On your local machine, in the same project repo:

```bash
cd ~/your-project
ralph init client
ralph node add my-vps --host <your-vps-ip> --user ralph --identity-file ~/.ssh/id_ed25519
```

This writes `.ralph/client.json`:

```json
{
  "nodes": {
    "my-vps": {
      "host": "123.45.67.89",
      "user": "ralph",
      "port": 22,
      "identityFile": "~/.ssh/id_ed25519"
    }
  }
}
```

Test the connection:

```bash
ralph remote my-vps version
```

## 7. Workflow

### Add a task (locally)

```bash
ralph task add "Fix authentication bug in login flow" --type bug-fix --priority 1
git add .ralph/tasks/
git commit -m "Add auth bug fix task"
git push
```

### Pull tasks on VPS and start the loop

```bash
ralph remote my-vps loop start
# Or SSH in directly:
ssh ralph@<your-vps-ip>
cd ~/projects/your-project
git pull
ralph loop start
```

### Monitor

```bash
ralph remote my-vps loop status     # Quick status check
ralph remote my-vps log list        # Recent iteration logs
ralph remote my-vps log errors      # Any errors?
ralph remote my-vps loop attach     # Live tmux session (Ctrl+B, D to detach)
```

### Stop

```bash
ralph remote my-vps loop stop
```

## 8. Circuit Breaker Configuration

Edit `.ralph/project.json` to tune safety limits:

```json
{
  "name": "my-project",
  "circuitBreakers": {
    "maxConsecutiveErrors": 3,
    "maxStallIterations": 5,
    "maxCostUsd": 50,
    "maxTokens": 0,
    "maxIterations": 20
  }
}
```

| Breaker | Default | What it does |
|---|---|---|
| `maxConsecutiveErrors` | 3 | Stops after N consecutive failed iterations |
| `maxStallIterations` | 5 | Stops after N iterations with no progress (no commits, no file changes) |
| `maxCostUsd` | 0 (off) | Stops when cumulative cost exceeds $N |
| `maxTokens` | 0 (off) | Stops when cumulative tokens exceed N |
| `maxIterations` | 0 (off) | Stops after N total iterations |

Set `maxCostUsd` on a VPS. You don't want a runaway loop burning through your API credits while you sleep. 💸

## 9. Multiple Projects

Each project gets its own tmux session (`ralph-<project-name>`). To run multiple projects:

```bash
cd ~/projects/project-a && ralph loop start
cd ~/projects/project-b && ralph loop start
```

They run independently. Monitor each with `ralph loop status` from the respective directory.

## 10. Troubleshooting

### "claude: command not found" in tmux

tmux inherits the environment of the launching shell. If `claude` is installed via `bun install -g`, make sure `~/.bun/bin` is in your PATH in `~/.bashrc` (not just `.profile`):

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
```

### SSH connection refused

- Check the firewall allows port 22: `sudo ufw status`
- Check sshd is running: `systemctl status sshd`
- Check key permissions: `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`

### Loop exits immediately

Check the state and logs:

```bash
ralph loop status
ralph log errors
ralph log list -n 5
```

Common causes:
- No tasks in `ready` status
- Circuit breaker tripped (check state.json)
- Claude CLI not authenticated

### Git push/pull failing in the loop

The loop runs `git pull --rebase` before each iteration and `git add .ralph/ && git commit && git push` after. If this fails, check:
- The VPS has SSH key access to the git remote
- There are no merge conflicts in `.ralph/tasks/`
- The remote is reachable from the VPS

## Dependency Summary

| Dependency | Purpose | Install |
|---|---|---|
| **Ubuntu 24.04** | OS | Hetzner image |
| **openssh-server** | Remote control | Pre-installed on Ubuntu |
| **git** | Data sync, progress detection | `apt install git` |
| **tmux** | Loop session management | `apt install tmux` |
| **Bun** | Runtime | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code CLI** | AI execution | `bun install -g @anthropic-ai/claude-code` |
| **Ralph** | Loop orchestrator | Clone + `bun install` + `bun link` |
