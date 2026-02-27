#!/usr/bin/env bash
#
# attach.sh — Attach to a project's tmux session
#
# Usage: attach.sh <name>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: attach.sh <name>"
    echo ""
    echo "Detach with: Ctrl+B, then D"
    exit 1
fi

require_project "$NAME"
require_command tmux

SESSION="$(tmux_session_name "$NAME")"

# ── Attach ──────────────────────────────────────────────────────────────────

if ! is_loop_running "$NAME"; then
    log_error "No running loop for '$NAME'. Start it first:"
    log_error "  ./bin/start-loop.sh $NAME"
    exit 1
fi

log_info "Attaching to session '$SESSION' (Ctrl+B, D to detach)..."
exec tmux attach-session -t "$SESSION"
