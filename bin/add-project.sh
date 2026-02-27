#!/usr/bin/env bash
#
# add-project.sh — Clone a repo and scaffold it as a ralph project
#
# Usage: add-project.sh <name> <github-url>
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

# ── Scaffold ────────────────────────────────────────────────────────────────

# Copy PROMPT.md template (only if repo doesn't already have one)
if [[ ! -f "$PROJECT_DIR/PROMPT.md" ]]; then
    cp "$TEMPLATES_DIR/PROMPT.md" "$PROJECT_DIR/PROMPT.md"
    log_info "Created PROMPT.md from template — edit it with your task"
else
    log_info "PROMPT.md already exists in repo, keeping it"
fi

# Copy BACKLOG.md template (only if repo doesn't already have one)
if [[ ! -f "$PROJECT_DIR/BACKLOG.md" ]]; then
    cp "$TEMPLATES_DIR/BACKLOG.md" "$PROJECT_DIR/BACKLOG.md"
    log_info "Created BACKLOG.md from template — fill in your epics and stories"
else
    log_info "BACKLOG.md already exists in repo, keeping it"
fi

# Copy PROGRESS.md template (only if repo doesn't already have one)
if [[ ! -f "$PROJECT_DIR/PROGRESS.md" ]]; then
    cp "$TEMPLATES_DIR/PROGRESS.md" "$PROJECT_DIR/PROGRESS.md"
    log_info "Created PROGRESS.md from template"
else
    log_info "PROGRESS.md already exists in repo, keeping it"
fi

# Copy project.conf
cp "$TEMPLATES_DIR/project.conf" "$PROJECT_DIR/project.conf"
log_info "Created project.conf with defaults"

# Set up .claude/settings.json
mkdir -p "$PROJECT_DIR/.claude"
cp "$TEMPLATES_DIR/claude-settings.json" "$PROJECT_DIR/.claude/settings.json"
log_info "Created .claude/settings.json with broad permissions"

# Create log directory
mkdir -p "$LOG_DIR/archive"
log_info "Created log directory: $LOG_DIR"

# ── Commit & push scaffolding if needed ────────────────────────────────────

cd "$PROJECT_DIR"
if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "Add ralph scaffolding (PROMPT.md, BACKLOG.md, project.conf, .claude/settings.json)"
    log_info "Committed scaffolding files."

    if git push 2>/dev/null; then
        log_info "Pushed scaffolding to remote."
    else
        log_warn "Could not push (remote may be empty). Run: ./bin/push-project.sh $NAME"
    fi
fi
cd "$ROOT_DIR"

# ── Done ────────────────────────────────────────────────────────────────────

echo ""
log_info "Project '$NAME' added successfully!"
echo ""
echo "Next steps:"
echo "  1. Edit the backlog: nano $PROJECT_DIR/BACKLOG.md"
echo "  2. Edit the prompt:  nano $PROJECT_DIR/PROMPT.md"
echo "  3. Adjust config:    nano $PROJECT_DIR/project.conf"
echo "  4. Start the loop:   ./bin/start-loop.sh $NAME"
