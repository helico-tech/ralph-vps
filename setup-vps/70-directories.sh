# shellcheck shell=bash
# 70-directories.sh - Create runtime directories

log_section "Directories"

mkdir -p "$SCRIPT_DIR/projects"
mkdir -p "$SCRIPT_DIR/logs"
mkdir -p "$SCRIPT_DIR/config"
chown -R "$ACTUAL_USER:$ACTUAL_USER" "$SCRIPT_DIR/projects" "$SCRIPT_DIR/logs" "$SCRIPT_DIR/config"

log_info "Runtime directories created."
