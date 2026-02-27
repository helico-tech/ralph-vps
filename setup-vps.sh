#!/usr/bin/env bash
#
# setup-vps.sh — One-time VPS bootstrap for ralph
#
# Run with: sudo ./setup-vps.sh
# Safe to re-run (idempotent).
#

set -euo pipefail

# ── Colors & helpers ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_section() { echo ""; echo -e "${BLUE}${BOLD}── $* ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Root check ──────────────────────────────────────────────────────────────

if [[ "$EUID" -ne 0 ]]; then
    log_error "Please run with sudo: sudo ./setup-vps.sh"
    exit 1
fi

# Detect the actual user (when run via sudo)
ACTUAL_USER="${SUDO_USER:-$USER}"
ACTUAL_HOME="$(eval echo "~$ACTUAL_USER")"

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║       ralph-vps Setup Script         ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ── Step 1: System packages ────────────────────────────────────────────────

log_section "Step 1: System packages"

apt-get update -qq
apt-get install -y -qq \
    tmux git curl jq build-essential unzip \
    python3 python3-pip python3-venv \
    ca-certificates gnupg

log_info "System packages installed."

# ── Step 2: Node.js via nvm ────────────────────────────────────────────────

log_section "Step 2: Node.js (via nvm)"

NVM_DIR="$ACTUAL_HOME/.nvm"

if [[ ! -d "$NVM_DIR" ]]; then
    log_info "Installing nvm..."
    sudo -u "$ACTUAL_USER" bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
else
    log_info "nvm already installed."
fi

# Install LTS Node
sudo -u "$ACTUAL_USER" bash -c "
    export NVM_DIR='$NVM_DIR'
    source '$NVM_DIR/nvm.sh'
    nvm install --lts
    nvm use --lts
    nvm alias default 'lts/*'
"

NODE_VERSION="$(sudo -u "$ACTUAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && node --version")"
log_info "Node.js $NODE_VERSION installed."

# ── Step 3: Claude Code CLI ────────────────────────────────────────────────

log_section "Step 3: Claude Code CLI"

sudo -u "$ACTUAL_USER" bash -c "
    export NVM_DIR='$NVM_DIR'
    source '$NVM_DIR/nvm.sh'
    npm install -g @anthropic-ai/claude-code
"

log_info "Claude Code CLI installed."

# ── Step 4: Playwright (optional) ──────────────────────────────────────────

log_section "Step 4: Playwright"

log_info "Installing Playwright browsers (this may take a while)..."
sudo -u "$ACTUAL_USER" bash -c "
    export NVM_DIR='$NVM_DIR'
    source '$NVM_DIR/nvm.sh'
    npx playwright install --with-deps
" || log_warn "Playwright install failed (non-critical). You can install it later."

# ── Step 5: SSH key ────────────────────────────────────────────────────────

log_section "Step 5: SSH key"

SSH_KEY="$ACTUAL_HOME/.ssh/id_ed25519"

if [[ ! -f "$SSH_KEY" ]]; then
    log_info "Generating SSH key..."
    sudo -u "$ACTUAL_USER" ssh-keygen -t ed25519 -f "$SSH_KEY" -N "" -C "$ACTUAL_USER@ralph-vps"
    log_info "SSH key generated."
else
    log_info "SSH key already exists."
fi

echo ""
echo -e "${YELLOW}Add this public key to GitHub (Settings > SSH Keys):${NC}"
echo ""
cat "${SSH_KEY}.pub"
echo ""

# ── Step 6: Git config ─────────────────────────────────────────────────────

log_section "Step 6: Git config"

CURRENT_NAME="$(sudo -u "$ACTUAL_USER" git config --global user.name 2>/dev/null || echo "")"
CURRENT_EMAIL="$(sudo -u "$ACTUAL_USER" git config --global user.email 2>/dev/null || echo "")"

if [[ -z "$CURRENT_NAME" ]]; then
    read -r -p "Git name: " GIT_NAME
    sudo -u "$ACTUAL_USER" git config --global user.name "$GIT_NAME"
else
    log_info "Git name already set: $CURRENT_NAME"
fi

if [[ -z "$CURRENT_EMAIL" ]]; then
    read -r -p "Git email: " GIT_EMAIL
    sudo -u "$ACTUAL_USER" git config --global user.email "$GIT_EMAIL"
else
    log_info "Git email already set: $CURRENT_EMAIL"
fi

# ── Step 7: Create directories ─────────────────────────────────────────────

log_section "Step 7: Directories"

mkdir -p "$SCRIPT_DIR/projects"
mkdir -p "$SCRIPT_DIR/logs"
mkdir -p "$SCRIPT_DIR/config"
chown -R "$ACTUAL_USER:$ACTUAL_USER" "$SCRIPT_DIR/projects" "$SCRIPT_DIR/logs" "$SCRIPT_DIR/config"

log_info "Runtime directories created."

# ── Step 8: Global config ──────────────────────────────────────────────────

log_section "Step 8: Global config"

if [[ ! -f "$SCRIPT_DIR/config/ralph.conf" ]]; then
    cp "$SCRIPT_DIR/config/ralph.conf.default" "$SCRIPT_DIR/config/ralph.conf"
    chown "$ACTUAL_USER:$ACTUAL_USER" "$SCRIPT_DIR/config/ralph.conf"
    log_info "Created config/ralph.conf from defaults."
else
    log_info "config/ralph.conf already exists, keeping it."
fi

# ── Step 9: Make scripts executable ─────────────────────────────────────────

chmod +x "$SCRIPT_DIR/setup-vps.sh"
chmod +x "$SCRIPT_DIR"/bin/*.sh

log_info "Scripts marked executable."

# ── Done ────────────────────────────────────────────────────────────────────

log_section "Setup Complete!"

echo ""
echo -e "${BOLD}Next steps:${NC}"
echo ""
echo "  1. Authenticate Claude (run as your user, NOT root):"
echo "     claude auth login"
echo ""
echo "  2. Add the SSH key above to GitHub:"
echo "     https://github.com/settings/keys"
echo ""
echo "  3. Add your first project:"
echo "     ./bin/add-project.sh my-app git@github.com:user/my-app.git"
echo ""
echo "  4. Edit the task prompt:"
echo "     nano projects/my-app/PROMPT.md"
echo ""
echo "  5. Start the loop:"
echo "     ./bin/start-loop.sh my-app"
echo ""
echo -e "See ${BLUE}docs/VPS-SETUP.md${NC} for the full guide."
