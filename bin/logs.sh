#!/usr/bin/env bash
#
# logs.sh — View or follow logs for a project
#
# Usage: logs.sh <name> [lines|-f]
#   logs.sh my-app          # Last 50 lines
#   logs.sh my-app 100      # Last 100 lines
#   logs.sh my-app -f       # Follow mode (tail -f)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"
ARG="${2:-50}"

if [[ -z "$NAME" ]]; then
    echo "Usage: logs.sh <name> [lines|-f]"
    echo ""
    echo "Examples:"
    echo "  logs.sh my-app          # Last 50 lines"
    echo "  logs.sh my-app 100      # Last 100 lines"
    echo "  logs.sh my-app -f       # Follow mode"
    exit 1
fi

require_project "$NAME"

LOG_FILE="$LOGS_DIR/$NAME/loop.log"

# ── Show logs ───────────────────────────────────────────────────────────────

if [[ ! -f "$LOG_FILE" ]]; then
    log_warn "No log file found for '$NAME'. Has the loop been started?"
    exit 0
fi

if [[ "$ARG" == "-f" ]]; then
    log_info "Following logs for '$NAME' (Ctrl+C to stop)..."
    exec tail -f "$LOG_FILE"
else
    tail -n "$ARG" "$LOG_FILE"
fi
