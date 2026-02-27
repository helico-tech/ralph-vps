# shellcheck shell=bash
# 50-log-directory.sh - Create log directory and archive

log_section "Log directory"

mkdir -p "$LOG_DIR/archive"
log_info "Created log directory: $LOG_DIR"
