#!/usr/bin/env bash
#
# remove-project.sh — Remove a ralph project and its logs
#
# Usage: remove-project.sh <name>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: remove-project.sh <name>"
    exit 1
fi

require_project "$NAME"

PROJECT_DIR="$PROJECTS_DIR/$NAME"
LOG_DIR="$LOGS_DIR/$NAME"

# ── Checks ──────────────────────────────────────────────────────────────────

if is_loop_running "$NAME"; then
    log_error "Loop is still running for '$NAME'. Stop it first:"
    log_error "  ./bin/stop-loop.sh $NAME"
    exit 1
fi

# ── Confirm ─────────────────────────────────────────────────────────────────

log_warn "This will permanently delete:"
echo "  Project: $PROJECT_DIR"
echo "  Logs:    $LOG_DIR"
echo ""
read -r -p "Are you sure? (y/N) " confirm

if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    log_info "Cancelled."
    exit 0
fi

# ── Remove ──────────────────────────────────────────────────────────────────

log_info "Removing project '$NAME'..."

rm -rf "$PROJECT_DIR"
rm -rf "$LOG_DIR"

log_info "Project '$NAME' removed."
