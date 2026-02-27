#!/usr/bin/env bash
#
# push-project.sh - Push a project's commits to its remote
#
# Usage: push-project.sh <name>
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"

if [[ -z "$NAME" ]]; then
    echo "Usage: push-project.sh <name>"
    echo ""
    echo "Example: push-project.sh my-app"
    exit 1
fi

require_project "$NAME"

PROJECT_DIR="$PROJECTS_DIR/$NAME"

# ── Push ────────────────────────────────────────────────────────────────────

cd "$PROJECT_DIR"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

log_info "Pushing $NAME ($BRANCH) to remote..."

if git push -u origin "$BRANCH"; then
    log_info "Pushed successfully."
else
    log_error "Push failed. Check your remote and SSH key configuration."
    exit 1
fi
