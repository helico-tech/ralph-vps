#!/usr/bin/env bash
#
# add-project.sh — Clone a repo and scaffold it as a ralph project
#
# Usage: add-project.sh <name> <github-url>
#
# Phases live in setup-project/*.sh and are sourced in numeric order.
# To add a new step, create e.g. setup-project/45-foo.sh — it will be
# picked up automatically on the next run.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

NAME="${1:-}"
REPO_URL="${2:-}"

if [[ -z "$NAME" || -z "$REPO_URL" ]]; then
    echo "Usage: add-project.sh <name> <github-url>"
    echo ""
    echo "Example: add-project.sh my-app git@github.com:user/my-app.git"
    exit 1
fi

validate_project_name "$NAME" || exit 1

PROJECT_DIR="$PROJECTS_DIR/$NAME"
LOG_DIR="$LOGS_DIR/$NAME"

# ── Checks ──────────────────────────────────────────────────────────────────

if [[ -d "$PROJECT_DIR" ]]; then
    log_error "Project already exists: $PROJECT_DIR"
    exit 1
fi

require_command git

# ── Clone ───────────────────────────────────────────────────────────────────

log_section "Adding project: $NAME"

log_info "Cloning $REPO_URL ..."
mkdir -p "$PROJECTS_DIR"
git clone "$REPO_URL" "$PROJECT_DIR"

# ── Run phases in order ─────────────────────────────────────────────────────

for phase in "$ROOT_DIR"/setup-project/[0-9][0-9]-*.sh; do
    phase_name="$(basename "$phase")"
    log_info "Running phase: $phase_name"
    # shellcheck source=/dev/null
    if ! source "$phase"; then
        log_error "Phase failed: $phase_name"
        exit 1
    fi
done

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
log_info "Project '$NAME' added successfully!"
echo ""
echo "Next steps:"
echo "  1. Edit the backlog:   nano $PROJECT_DIR/BACKLOG.md"
echo "  2. Create epic files:  nano $PROJECT_DIR/epics/<slug>.md"
echo "  3. Edit the prompt:    nano $PROJECT_DIR/PROMPT.md"
echo "  4. Adjust config:      nano $PROJECT_DIR/project.conf"
echo "  5. Start the loop:     ./bin/start-loop.sh $NAME"
