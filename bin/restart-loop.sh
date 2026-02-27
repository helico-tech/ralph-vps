#!/usr/bin/env bash
#
# restart-loop.sh — Stop and start a ralph loop
#
# Usage: restart-loop.sh <name>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: restart-loop.sh <name>"
    exit 1
fi

require_project "$NAME"

# ── Restart ─────────────────────────────────────────────────────────────────

log_info "Restarting loop for '$NAME'..."

"$SCRIPT_DIR/stop-loop.sh" "$NAME"
sleep 2
"$SCRIPT_DIR/start-loop.sh" "$NAME"
