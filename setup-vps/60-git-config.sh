# shellcheck shell=bash
# 60-git-config.sh - Prompt for git name/email if not set

log_section "Git config"

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
