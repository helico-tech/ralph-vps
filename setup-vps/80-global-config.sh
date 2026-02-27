# shellcheck shell=bash
# 80-global-config.sh - Copy ralph.conf.default to ralph.conf

log_section "Global config"

if [[ ! -f "$SCRIPT_DIR/config/ralph.conf" ]]; then
    cp "$SCRIPT_DIR/config/ralph.conf.default" "$SCRIPT_DIR/config/ralph.conf"
    chown "$ACTUAL_USER:$ACTUAL_USER" "$SCRIPT_DIR/config/ralph.conf"
    log_info "Created config/ralph.conf from defaults."
else
    log_info "config/ralph.conf already exists, keeping it."
fi
