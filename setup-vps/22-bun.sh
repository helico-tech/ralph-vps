# shellcheck shell=bash
# 22-bun.sh - Install bun runtime

log_section "Bun"

BUN_DIR="$ACTUAL_HOME/.bun"

if [[ -x "$BUN_DIR/bin/bun" ]]; then
    BUN_VERSION="$(sudo -u "$ACTUAL_USER" "$BUN_DIR/bin/bun" --version)"
    log_info "Bun already installed ($BUN_VERSION)."
else
    log_info "Installing Bun..."
    sudo -u "$ACTUAL_USER" bash -c 'curl -fsSL https://bun.sh/install | bash'
    BUN_VERSION="$(sudo -u "$ACTUAL_USER" "$BUN_DIR/bin/bun" --version)"
    log_info "Bun $BUN_VERSION installed."
fi
