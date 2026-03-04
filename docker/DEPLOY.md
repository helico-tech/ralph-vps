# Ralph VPS Deployment Guide

> Minimal setup for Hetzner CX22 (2 vCPU, 4GB RAM, 40GB SSD)

## Prerequisites

- A Hetzner CX22 (or equivalent) with Ubuntu 22.04+
- An Anthropic API key
- A git repository with `.ralph/` configured (config.json, tasks/, templates/)
- SSH access to the server

## Option A: Docker Deployment (Recommended)

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect
```

### 2. Install Bun (for building)

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 3. Clone Ralph

```bash
git clone https://github.com/helico/ralph-vps.git /opt/ralph
cd /opt/ralph
```

### 4. Configure

```bash
cp docker/.env.example docker/.env
# Edit docker/.env with your values:
#   ANTHROPIC_API_KEY=sk-ant-...
#   PROJECT_PATH=/home/$USER/projects/my-project
nano docker/.env
```

### 5. Clone your target project

```bash
mkdir -p ~/projects
git clone git@github.com:your-org/your-project.git ~/projects/my-project
```

### 6. Start Ralph

```bash
cd /opt/ralph/docker
docker compose up -d
```

### 7. Verify

```bash
# Check logs
docker compose logs -f

# Run doctor (from project dir)
cd ~/projects/my-project
bun run /opt/ralph/src/cli.ts doctor
```

## Option B: systemd Deployment (Bare Metal)

### 1. Install dependencies

```bash
# System packages
sudo apt-get update
sudo apt-get install -y git curl

# Bun
curl -fsSL https://bun.sh/install | bash
sudo cp ~/.bun/bin/bun /usr/local/bin/

# Node.js (for Claude CLI)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# Claude CLI
sudo npm install -g @anthropic-ai/claude-code
```

### 2. Create ralph user

```bash
sudo useradd -r -m -s /bin/bash ralph
```

### 3. Install Ralph

```bash
sudo git clone https://github.com/helico/ralph-vps.git /opt/ralph
sudo chown -R ralph:ralph /opt/ralph
sudo -u ralph bun install --production --cwd /opt/ralph
```

### 4. Clone target project(s)

Each project gets its own directory under `/home/ralph/projects/`:

```bash
sudo mkdir -p /home/ralph/projects
sudo -u ralph git clone git@github.com:your-org/my-api.git /home/ralph/projects/my-api
# Add more projects as needed:
# sudo -u ralph git clone git@github.com:your-org/my-app.git /home/ralph/projects/my-app
```

### 5. Configure environment (per project)

Each project gets its own env file at `/etc/ralph/<project>.env`:

```bash
sudo mkdir -p /etc/ralph
sudo tee /etc/ralph/my-api.env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-...
# RALPH_MODEL=claude-opus-4-5
# RALPH_MAIN_BRANCH=main
# RALPH_PERMISSION_MODE=skip_all
EOF
sudo chmod 600 /etc/ralph/my-api.env
```

### 6. Configure git for ralph user

```bash
sudo -u ralph git config --global user.name "Ralph"
sudo -u ralph git config --global user.email "ralph@helico.dev"
```

### 7. Install and start service

The service file is a systemd template (`ralph@.service`). The part after `@` is the
project directory name under `/home/ralph/projects/`.

```bash
sudo cp /opt/ralph/systemd/ralph@.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable and start per project:
sudo systemctl enable ralph@my-api
sudo systemctl start ralph@my-api

# Multiple projects? Just add more instances:
# sudo systemctl enable ralph@my-app
# sudo systemctl start ralph@my-app
```

### 8. Verify

```bash
# Check a specific instance
sudo systemctl status ralph@my-api

# Follow logs for one instance
sudo journalctl -u ralph@my-api -f

# Follow logs for ALL Ralph instances
sudo journalctl -u 'ralph@*' -f

# Run doctor
sudo -u ralph bash -c 'cd /home/ralph/projects/my-api && bun run /opt/ralph/src/cli.ts doctor'
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `RALPH_MODEL` | No | Override model (default: from config) |
| `RALPH_MAIN_BRANCH` | No | Override main branch (default: from config) |
| `RALPH_PERMISSION_MODE` | No | Override permission mode (default: from config) |

## Maintenance

### View logs

```bash
# Docker
docker compose logs -f

# systemd — single instance
sudo journalctl -u ralph@my-api -f

# systemd — all instances
sudo journalctl -u 'ralph@*' -f
```

### Restart

```bash
# Docker
docker compose restart

# systemd
sudo systemctl restart ralph@my-api
```

### Stop

```bash
# Docker — graceful shutdown (waits for current task)
docker compose stop

# systemd
sudo systemctl stop ralph@my-api
```

### Update Ralph

```bash
cd /opt/ralph
git pull
bun install --production

# Docker
cd docker && docker compose up -d --build

# systemd — restart all instances
sudo systemctl restart 'ralph@*'
```
