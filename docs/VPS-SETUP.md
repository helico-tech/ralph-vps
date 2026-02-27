# VPS Setup Guide

Complete guide for setting up ralph-vps on a Hetzner VPS.

## 1. Create a Hetzner Account

1. Go to [Hetzner Cloud](https://console.hetzner.cloud/)
2. Sign up and add a payment method
3. Create a new project (e.g., "ralph")

## 2. Create a VPS

In the Hetzner Cloud Console:

1. Click **Add Server**
2. **Location**: Choose nearest (e.g., Falkenstein or Nuremberg for EU)
3. **Image**: Ubuntu 24.04
4. **Type**: Shared vCPU — **CX22** (2 vCPU, 4 GB RAM, 40 GB disk, ~4.50/mo)
   - Runs 2-3 concurrent Ralph loops comfortably
   - Upgrade to CX32 (8 GB) if you need more
5. **SSH Key**: Add your public key (from your laptop: `cat ~/.ssh/id_ed25519.pub`)
6. **Name**: e.g., `ralph-vps`
7. Click **Create & Buy Now**

Note the server IP address once created.

## 3. First SSH Connection

```bash
# From your laptop
ssh root@<server-ip>
```

### Create a non-root user

```bash
adduser ralph
usermod -aG sudo ralph

# Copy SSH key to new user
mkdir -p /home/ralph/.ssh
cp ~/.ssh/authorized_keys /home/ralph/.ssh/
chown -R ralph:ralph /home/ralph/.ssh
chmod 700 /home/ralph/.ssh
chmod 600 /home/ralph/.ssh/authorized_keys
```

### Basic firewall

```bash
ufw allow OpenSSH
ufw enable
```

Now disconnect and reconnect as the new user:

```bash
ssh ralph@<server-ip>
```

## 4. Clone ralph-vps

```bash
cd ~
git clone https://github.com/your-org/ralph-vps.git
cd ralph-vps
```

## 5. Run Setup

```bash
sudo ./setup-vps.sh
```

This installs:
- System packages (tmux, git, curl, jq, build-essential, etc.)
- Node.js (LTS via nvm)
- Claude Code CLI
- Playwright + browsers
- Generates an SSH key for GitHub access

## 6. Authenticate Claude

**Important**: Run this as your user, not root.

```bash
claude auth login
```

Follow the interactive prompts to authenticate with your Claude account.

## 7. Add SSH Key to GitHub

The setup script printed your VPS public key. Add it to GitHub:

1. Copy the key: `cat ~/.ssh/id_ed25519.pub`
2. Go to [GitHub SSH Keys](https://github.com/settings/keys)
3. Click **New SSH key**, paste the key, save

Test the connection:

```bash
ssh -T git@github.com
```

## 8. Add Your First Project

```bash
cd ~/ralph-vps

# Clone and scaffold a project
./bin/add-project.sh my-app git@github.com:you/my-app.git

# Write your task prompt
nano projects/my-app/PROMPT.md

# (Optional) Adjust loop settings
nano projects/my-app/project.conf

# Start the loop
./bin/start-loop.sh my-app

# Watch Claude work
./bin/attach.sh my-app
```

## 9. tmux Cheat Sheet

Ralph loops run inside tmux sessions. Here are the essential commands:

| Action | Command |
|--------|---------|
| Attach to a session | `./bin/attach.sh <name>` or `tmux attach -t ralph-<name>` |
| Detach (leave running) | `Ctrl+B`, then `D` |
| List all sessions | `tmux ls` |
| Scroll up in session | `Ctrl+B`, then `[`, then arrow keys. `q` to exit scroll |
| Kill a session | `./bin/stop-loop.sh <name>` |

## Daily Workflow

```bash
# SSH into your VPS
ssh ralph@<server-ip>
cd ~/ralph-vps

# Update scripts (if you changed them locally)
git pull

# Check status of all loops
./bin/status.sh

# Update a task while a loop is running
nano projects/my-app/PROMPT.md
# (next iteration automatically picks up changes)

# View live output
./bin/logs.sh my-app -f

# Disconnect — loops keep running
exit
```

## Resource Planning

| VPS Type | RAM | Concurrent Loops | Cost/mo |
|----------|-----|-------------------|---------|
| CX22 | 4 GB | 2-3 | ~4.50 |
| CX32 | 8 GB | 4-6 | ~8.50 |
| CX42 | 16 GB | 8-10 | ~16.90 |

Each Claude Code session uses approximately 200-400 MB of RAM. Monitor with `./bin/status.sh`.
