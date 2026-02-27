# shellcheck shell=bash
# 40-playwright-skills.sh - Install Playwright CLI skills

log_section "Playwright skills"

log_info "Installing Playwright skills..."
(cd "$PROJECT_DIR" && playwright-cli install --skills) \
    || log_warn "Playwright skills install failed (non-critical). Run: cd $PROJECT_DIR && playwright-cli install --skills"
