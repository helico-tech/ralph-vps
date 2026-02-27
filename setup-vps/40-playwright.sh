# shellcheck shell=bash
# 40-playwright.sh - Install Playwright browsers

log_section "Playwright"

log_info "Installing Playwright browsers (this may take a while)..."
sudo -u "$ACTUAL_USER" bash -c "
    export NVM_DIR='$ACTUAL_HOME/.nvm'
    source '$ACTUAL_HOME/.nvm/nvm.sh'
    npx playwright install --with-deps
" || log_warn "Playwright install failed (non-critical). You can install it later."
