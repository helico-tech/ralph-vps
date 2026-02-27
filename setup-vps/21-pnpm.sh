# shellcheck shell=bash
# 21-pnpm.sh - Install pnpm package manager

log_section "pnpm"

NVM_DIR="$ACTUAL_HOME/.nvm"

if sudo -u "$ACTUAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && command -v pnpm" &>/dev/null; then
    PNPM_VERSION="$(sudo -u "$ACTUAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && pnpm --version")"
    log_info "pnpm already installed ($PNPM_VERSION)."
else
    log_info "Installing pnpm..."
    sudo -u "$ACTUAL_USER" bash -c "
        source '$NVM_DIR/nvm.sh'
        npm install -g pnpm
    "
    PNPM_VERSION="$(sudo -u "$ACTUAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && pnpm --version")"
    log_info "pnpm $PNPM_VERSION installed."
fi
