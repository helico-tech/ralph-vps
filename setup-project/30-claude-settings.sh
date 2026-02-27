# shellcheck shell=bash
# 30-claude-settings.sh - Create .claude/settings.json

log_section "Claude settings"

mkdir -p "$PROJECT_DIR/.claude"
cp "$TEMPLATES_DIR/claude-settings.json" "$PROJECT_DIR/.claude/settings.json"
log_info "Created .claude/settings.json with broad permissions"
