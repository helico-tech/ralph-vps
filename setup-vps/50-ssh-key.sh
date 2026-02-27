# shellcheck shell=bash
# 50-ssh-key.sh - Generate ed25519 SSH key

log_section "SSH key"

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
