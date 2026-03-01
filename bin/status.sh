#!/usr/bin/env bash
#
# status.sh — Show system resources and all project loop statuses
#
# Usage: status.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── System info ─────────────────────────────────────────────────────────────

log_section "System Resources"

# Load average
if command -v uptime &>/dev/null; then
    echo "  Load: $(uptime | sed 's/.*load average: //')"
fi

# Memory
if command -v free &>/dev/null; then
    mem_info="$(free -h | awk '/^Mem:/ {printf "Used: %s / %s (Free: %s)", $3, $2, $4}')"
    echo "  RAM:  $mem_info"
fi

# Disk
if command -v df &>/dev/null; then
    disk_info="$(df -h / | awk 'NR==2 {printf "Used: %s / %s (%s)", $3, $2, $5}')"
    echo "  Disk: $disk_info"
fi

# ── Projects ────────────────────────────────────────────────────────────────

log_section "Projects"

if [[ ! -d "$PROJECTS_DIR" ]] || [[ -z "$(ls -A "$PROJECTS_DIR" 2>/dev/null)" ]]; then
    log_info "No projects found."
    exit 0
fi

printf "${BOLD}%-20s %-10s %-20s %-12s %s${NC}\n" "PROJECT" "STATUS" "STOP REASON" "LOG SIZE" "LAST LOG LINE"
printf "%-20s %-10s %-20s %-12s %s\n" "-------" "------" "-----------" "--------" "-------------"

for project_dir in "$PROJECTS_DIR"/*/; do
    [[ -d "$project_dir" ]] || continue

    name="$(basename "$project_dir")"
    log_file="$LOGS_DIR/$name/loop.log"
    state_dir="$project_dir/.ralph"

    # Status
    if is_loop_running "$name"; then
        status="${GREEN}RUNNING${NC}"
    else
        status="${RED}STOPPED${NC}"
    fi

    # Stop reason
    if [[ -f "$state_dir/stop-reason" ]]; then
        stop_reason="$(cat "$state_dir/stop-reason" 2>/dev/null || echo "-")"
    else
        stop_reason="-"
    fi

    # Log size
    if [[ -f "$log_file" ]]; then
        log_size="$(du -h "$log_file" 2>/dev/null | cut -f1)"
    else
        log_size="-"
    fi

    # Last log line (truncated)
    if [[ -f "$log_file" ]]; then
        last_line="$(tail -1 "$log_file" 2>/dev/null || echo "")"
        if [[ ${#last_line} -gt 50 ]]; then
            last_line="${last_line:0:47}..."
        fi
    else
        last_line="-"
    fi

    printf "%-20s %-10b %-20s %-12s %s\n" "$name" "$status" "$stop_reason" "$log_size" "$last_line"
done
