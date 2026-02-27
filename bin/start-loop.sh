#!/usr/bin/env bash
#
# start-loop.sh — Start a ralph loop in a tmux session
#
# Usage: start-loop.sh <name>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: start-loop.sh <name>"
    exit 1
fi

require_project "$NAME"
require_command tmux

PROJECT_DIR="$PROJECTS_DIR/$NAME"
LOG_DIR="$LOGS_DIR/$NAME"
LOG_FILE="$LOG_DIR/loop.log"
SESSION="$(tmux_session_name "$NAME")"

# ── Checks ──────────────────────────────────────────────────────────────────

if [[ ! -f "$PROJECT_DIR/PROMPT.md" ]]; then
    log_error "PROMPT.md not found in $PROJECT_DIR"
    log_error "Create it before starting the loop."
    exit 1
fi

if is_loop_running "$NAME"; then
    log_error "Loop is already running for '$NAME' (session: $SESSION)"
    log_error "Use './bin/attach.sh $NAME' to view it"
    exit 1
fi

# ── Archive previous log ───────────────────────────────────────────────────

mkdir -p "$LOG_DIR/archive"

if [[ -f "$LOG_FILE" ]]; then
    ARCHIVE_NAME="loop-$(date '+%Y%m%d-%H%M%S').log"
    mv "$LOG_FILE" "$LOG_DIR/archive/$ARCHIVE_NAME"
    log_info "Archived previous log to archive/$ARCHIVE_NAME"
fi

# ── Start tmux session ─────────────────────────────────────────────────────

log_info "Starting loop for '$NAME' in tmux session '$SESSION'..."

tmux new-session -d -s "$SESSION" \
    "$SCRIPT_DIR/ralph-loop.sh '$NAME' 2>&1 | tee '$LOG_FILE'"

log_info "Loop started!"
echo ""
echo "Commands:"
echo "  Attach:   ./bin/attach.sh $NAME    (Ctrl+B, D to detach)"
echo "  Logs:     ./bin/logs.sh $NAME -f"
echo "  Stop:     ./bin/stop-loop.sh $NAME"
echo "  Status:   ./bin/status.sh"
