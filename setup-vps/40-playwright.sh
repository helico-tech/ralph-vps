# shellcheck shell=bash
# 40-playwright.sh - Install Playwright CLI (https://github.com/microsoft/playwright-cli)

log_section "Playwright CLI"

NVM_DIR="$ACTUAL_HOME/.nvm"

if sudo -u "$ACTUAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && command -v playwright-cli" &>/dev/null; then
    log_info "Playwright CLI already installed."
else
    log_info "Installing Playwright CLI..."
    sudo -u "$ACTUAL_USER" bash -c "
        source '$NVM_DIR/nvm.sh'
        npm install -g @playwright/cli@latest
    " || log_warn "Playwright CLI install failed (non-critical). You can install it later."
fi

log_info "Installing Chrome browser for Playwright..."
sudo -u "$ACTUAL_USER" bash -c "
    source '$NVM_DIR/nvm.sh'
    npx playwright install chrome
" || log_warn "Chrome install failed (non-critical). You can install it later."
