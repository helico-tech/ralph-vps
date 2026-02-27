# shellcheck shell=bash
# 20-config.sh - Copy project.conf

log_section "Project config"

cp "$TEMPLATES_DIR/project.conf" "$PROJECT_DIR/project.conf"
log_info "Created project.conf with defaults"
