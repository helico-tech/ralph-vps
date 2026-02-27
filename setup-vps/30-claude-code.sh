# shellcheck shell=bash
# 30-claude-code.sh - Install Claude Code CLI

log_section "Claude Code CLI"

sudo -u "$ACTUAL_USER" bash -c "
    export NVM_DIR='$ACTUAL_HOME/.nvm'
    source '$ACTUAL_HOME/.nvm/nvm.sh'
    npm install -g @anthropic-ai/claude-code
"

log_info "Claude Code CLI installed."
