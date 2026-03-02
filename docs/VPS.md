# Provisioning Ralph on a Hetzner VPS

Get Ralph running on a VPS so you can remotely dispatch AI-powered coding tasks.

## Architecture

```
┌─────────────────────┐          SSH (control)          ┌──────────────────────┐
│   Your Machine      │ ──────────────────────────────▶ │   Hetzner VPS        │
│                     │                                 │                      │
│   ralph remote      │          Git (data)             │   ralph loop run     │
│   ralph node        │ ◀──────────────────────────────▶│   (inside tmux)      │
│                     │       (shared git remote)       │                      │
│   .ralph/           │                                 │   .ralph/            │
│     client.json     │                                 │     project.json     │
│     tasks/          │                                 │     tasks/           │
└─────────────────────┘                                 └──────────────────────┘
```

- **SSH** is the control plane — you send commands (`loop start`, `loop status`, etc.)
- **Git** is the data plane — tasks are markdown files synced via a shared remote
- **No daemon, no API server** — the VPS just runs `ralph` via SSH

## 1. Create the VPS and Prepare Root

This is the only part you do manually via SSH. Everything after this is automated from your local machine.

### 1.1 Create the Server

[Hetzner Cloud Console](https://console.hetzner.cloud/):

| Setting | Recommendation |
|---|---|
| **Image** | Ubuntu 24.04 |
| **Type** | CX22 (2 vCPU, 4 GB) — minimum viable |
| **SSH Key** | Add your public key |
| **Firewall** | Allow TCP 22 inbound only |

### 1.2 Root Setup

SSH in as root once to create the `ralph` user and harden the server:

```bash
ssh root@<your-vps-ip>

# System updates
apt update && apt upgrade -y

# Install system packages
apt install -y git tmux

# Create ralph user
useradd -m -s /bin/bash ralph
mkdir -p /home/ralph/.ssh
cp ~/.ssh/authorized_keys /home/ralph/.ssh/authorized_keys
chmod 700 /home/ralph/.ssh
chmod 600 /home/ralph/.ssh/authorized_keys
chown -R ralph:ralph /home/ralph/.ssh

# Harden SSH — edit /etc/ssh/sshd_config:
#   PermitRootLogin no
#   PasswordAuthentication no
#   ChallengeResponseAuthentication no
systemctl restart sshd
```

> **Test** that `ssh ralph@<your-vps-ip>` works before closing the root session.

### 1.3 Install Claude Code CLI

SSH in as `ralph` and install Claude Code:

```bash
ssh ralph@<your-vps-ip>
npm install -g @anthropic-ai/claude-code
claude auth login
```

This step requires interactive authentication and can't be automated.

## 2. Set Up Your Local Client

On your local machine, in your project repo:

```bash
ralph init client
ralph node add my-vps --host <your-vps-ip> --user ralph --identity-file ~/.ssh/id_ed25519
```

Test the connection:

```bash
ralph remote my-vps echo hello
```

## 3. Bootstrap the Node

Everything from here runs from your local machine. No more SSHing in.

### 3.1 Generate Deploy Key

```bash
ralph node deploy-key my-vps
```

This generates an SSH key on the VPS and prints the public key. Add it as a deploy key on GitHub: **Repo → Settings → Deploy keys → Add deploy key** (check "Allow write access").

### 3.2 Install Tooling

```bash
ralph node setup my-vps \
  --git-name "Ralph Bot" \
  --git-email "ralph@yourdomain.com" \
  --api-key "sk-ant-..."
```

This installs Bun, clones and links Ralph, configures git identity, creates `~/projects`, and sets the Anthropic API key.

### 3.3 Clone a Project

```bash
ralph node clone my-vps git@github.com:you/your-project.git
```

This clones the repo into `~/projects/<name>`, runs `ralph init project`, and `ralph sync`.

### 3.4 Verify

```bash
ralph node projects my-vps
```

```
NAME            PATH                          PHASE     ITERATION
your-project    ~/projects/your-project       idle      0
```

## 4. Workflow

### Start the loop

```bash
ralph remote my-vps loop start
```

### Add tasks

```bash
ralph task add "Fix authentication bug" --type bug-fix --priority 1
git add .ralph/tasks/ && git commit -m "Add task" && git push
```

### Monitor

```bash
ralph remote my-vps loop status     # Quick status
ralph remote my-vps log list        # Recent logs
ralph remote my-vps log errors      # Errors
ralph remote my-vps loop attach     # Live tmux (Ctrl+B, D to detach)
```

### Stop

```bash
ralph remote my-vps loop stop
```

## 5. Circuit Breakers

Edit `.ralph/project.json`:

```json
{
  "name": "my-project",
  "circuitBreakers": {
    "maxConsecutiveErrors": 3,
    "maxStallIterations": 5,
    "maxCostUsd": 50,
    "maxIterations": 20
  }
}
```

| Breaker | Default | What it does |
|---|---|---|
| `maxConsecutiveErrors` | 3 | Stops after N consecutive failed iterations |
| `maxStallIterations` | 5 | Stops after N iterations with no progress |
| `maxCostUsd` | 0 (off) | Stops when cumulative cost exceeds $N |
| `maxTokens` | 0 (off) | Stops when cumulative tokens exceed N |
| `maxIterations` | 0 (off) | Stops after N total iterations |

Set `maxCostUsd` on a VPS. You don't want a runaway loop burning through your API credits while you sleep.

## 6. Multiple Projects

Each project gets its own tmux session (`ralph-<project-name>`):

```bash
ralph node clone my-vps git@github.com:you/project-b.git
ralph node projects my-vps    # verify both listed
```

## 7. Troubleshooting

### "claude: command not found" in tmux

Make sure `~/.bun/bin` is in PATH in `~/.bashrc` (not just `.profile`):

```bash
ralph remote my-vps 'echo "export PATH=\$HOME/.bun/bin:\$PATH" >> ~/.bashrc'
```

### SSH connection refused

- Firewall allows port 22: `sudo ufw status`
- sshd running: `systemctl status sshd`
- Key permissions: `chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys`

### Loop exits immediately

```bash
ralph remote my-vps loop status
ralph remote my-vps log errors
```

Common causes: no `ready` tasks, circuit breaker tripped, Claude CLI not authenticated.

### Git push/pull failing

- VPS has SSH key access to the git remote
- No merge conflicts in `.ralph/tasks/`
- Remote is reachable from the VPS

### Multiple repos with deploy keys

Deploy keys are per-repo. For multiple repos, add an `~/.ssh/config` on the VPS with host aliases:

```
Host github-project-a
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519

Host github-project-b
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_project_b
```

Then clone using the alias: `git clone github-project-b:you/project-b.git`

Alternative: add the VPS key to a GitHub account (Settings → SSH keys) — one key, all repos. Bigger blast radius.
