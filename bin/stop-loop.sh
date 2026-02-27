#!/usr/bin/env bash
#
# stop-loop.sh — Gracefully stop a ralph loop
#
# Usage: stop-loop.sh <name>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: stop-loop.sh <name>"
    exit 1
fi

require_project "$NAME"

SESSION="$(tmux_session_name "$NAME")"

# ── Check ───────────────────────────────────────────────────────────────────

if ! is_loop_running "$NAME"; then
    log_warn "No running loop found for '$NAME'"
    exit 0
fi

# ── Stop ────────────────────────────────────────────────────────────────────

log_info "Sending interrupt to '$NAME' (session: $SESSION)..."

# Send Ctrl+C to the tmux session
tmux send-keys -t "$SESSION" C-c

# Wait up to 10 seconds for graceful shutdown
for _ in $(seq 1 10); do
    if ! is_loop_running "$NAME"; then
        log_info "Loop stopped gracefully."
        exit 0
    fi
    echo -n "."
    sleep 1
done
echo ""

# Force kill if still running
log_warn "Loop did not stop gracefully. Killing session..."
tmux kill-session -t "$SESSION" 2>/dev/null || true
log_info "Session killed."
