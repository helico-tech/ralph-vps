#!/usr/bin/env bash
#
# common.sh — Shared functions for ralph-vps scripts
#

# Resolve ROOT_DIR (ralph-vps repo root)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ROOT_DIR

readonly PROJECTS_DIR="$ROOT_DIR/projects"
# shellcheck disable=SC2034
readonly LOGS_DIR="$ROOT_DIR/logs"
# shellcheck disable=SC2034
readonly TEMPLATES_DIR="$ROOT_DIR/templates"
readonly CONFIG_DIR="$ROOT_DIR/config"
readonly GLOBAL_CONF="$CONFIG_DIR/ralph.conf"
readonly GLOBAL_CONF_DEFAULT="$CONFIG_DIR/ralph.conf.default"

# ── Colors ──────────────────────────────────────────────────────────────────

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly BOLD='\033[1m'
readonly NC='\033[0m' # No Color

# ── Logging ─────────────────────────────────────────────────────────────────

log_info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*" >&2
}

log_section() {
    echo ""
    echo -e "${BLUE}${BOLD}── $* ──${NC}"
}

# ── Validation ──────────────────────────────────────────────────────────────

# Check that a command exists on PATH
require_command() {
    local cmd="$1"
    if ! command -v "$cmd" &>/dev/null; then
        log_error "Required command not found: $cmd"
        exit 1
    fi
}

# Validate project name (alphanumeric, hyphens, underscores only)
validate_project_name() {
    local name="$1"
    if [[ -z "$name" ]]; then
        log_error "Project name cannot be empty"
        return 1
    fi
    if [[ ! "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        log_error "Project name must contain only letters, numbers, hyphens, and underscores"
        return 1
    fi
}

# Check that a project exists in the projects directory
require_project() {
    local name="$1"
    validate_project_name "$name" || exit 1
    if [[ ! -d "$PROJECTS_DIR/$name" ]]; then
        log_error "Project not found: $name"
        log_error "Run './bin/list-projects.sh' to see available projects"
        exit 1
    fi
}

# ── tmux helpers ────────────────────────────────────────────────────────────

# Get the tmux session name for a project
tmux_session_name() {
    echo "ralph-$1"
}

# Check if a tmux session exists for a project
is_loop_running() {
    local name="$1"
    local session
    session="$(tmux_session_name "$name")"
    tmux has-session -t "$session" 2>/dev/null
}

# ── Config loading ──────────────────────────────────────────────────────────

# Load global config, then project config (project overrides global)
load_config() {
    local project_name="$1"
    local project_conf="$PROJECTS_DIR/$project_name/project.conf"

    # Defaults (in case no config files exist)
    # shellcheck disable=SC2034  # Variables used by the calling script
    MAX_TURNS=50
    # shellcheck disable=SC2034
    MAX_ITERATIONS=0
    # shellcheck disable=SC2034
    PAUSE_BETWEEN_LOOPS=30
    # shellcheck disable=SC2034
    RESTART_POLICY="on-exit"
    # shellcheck disable=SC2034
    MODEL=""
    # shellcheck disable=SC2034
    CLAUDE_EXTRA_FLAGS=""

    # Circuit breaker defaults
    # shellcheck disable=SC2034
    MAX_STALL_ITERATIONS=3
    # shellcheck disable=SC2034
    MAX_CONSECUTIVE_ERRORS=3
    # shellcheck disable=SC2034
    MIN_ITERATION_DURATION=30
    # shellcheck disable=SC2034
    BACKLOG_COMPLETION_STOP="true"

    # Load global config
    if [[ -f "$GLOBAL_CONF" ]]; then
        # shellcheck source=/dev/null
        source "$GLOBAL_CONF"
    elif [[ -f "$GLOBAL_CONF_DEFAULT" ]]; then
        # shellcheck source=/dev/null
        source "$GLOBAL_CONF_DEFAULT"
    fi

    # Load project config (overrides global)
    if [[ -f "$project_conf" ]]; then
        # shellcheck source=/dev/null
        source "$project_conf"
    fi
}

# ── State tracking ──────────────────────────────────────────────────────────

# Create .ralph/ state directory inside a project, echo the path
init_state_dir() {
    local project_dir="$1"
    local state_dir="$project_dir/.ralph"
    mkdir -p "$state_dir"
    echo "$state_dir"
}

# Snapshot git hash + backlog hash before an iteration
record_pre_state() {
    local project_dir="$1"
    local state_dir="$2"

    # Git HEAD hash
    local git_hash
    git_hash="$(cd "$project_dir" && git rev-parse HEAD 2>/dev/null || echo "none")"
    echo "$git_hash" > "$state_dir/pre_git_hash"

    # BACKLOG.md hash
    if [[ -f "$project_dir/BACKLOG.md" ]]; then
        md5sum "$project_dir/BACKLOG.md" | cut -d' ' -f1 > "$state_dir/pre_backlog_hash"
    else
        echo "none" > "$state_dir/pre_backlog_hash"
    fi

    # Active epic file hash (find [~] epic slug from BACKLOG.md)
    local active_slug
    active_slug="$(grep -oP '^\- \[~\] \K[^ ]+' "$project_dir/BACKLOG.md" 2>/dev/null | head -1 || true)"
    if [[ -n "$active_slug" && -f "$project_dir/epics/$active_slug.md" ]]; then
        md5sum "$project_dir/epics/$active_slug.md" | cut -d' ' -f1 > "$state_dir/pre_epic_hash"
        echo "$active_slug" > "$state_dir/pre_epic_slug"
    else
        echo "none" > "$state_dir/pre_epic_hash"
        echo "" > "$state_dir/pre_epic_slug"
    fi
}

# Compare pre/post state to detect progress. Echoes "true" or "false".
detect_progress() {
    local project_dir="$1"
    local state_dir="$2"

    # Check if git HEAD changed (new commits)
    local pre_hash post_hash
    pre_hash="$(cat "$state_dir/pre_git_hash" 2>/dev/null || echo "none")"
    post_hash="$(cd "$project_dir" && git rev-parse HEAD 2>/dev/null || echo "none")"
    if [[ "$pre_hash" != "$post_hash" ]]; then
        echo "true"
        return
    fi

    # Check for uncommitted changes
    if (cd "$project_dir" && git diff --stat --quiet 2>/dev/null); then
        : # no uncommitted changes
    else
        echo "true"
        return
    fi

    # Check if BACKLOG.md changed
    local pre_backlog_hash post_backlog_hash
    pre_backlog_hash="$(cat "$state_dir/pre_backlog_hash" 2>/dev/null || echo "none")"
    if [[ -f "$project_dir/BACKLOG.md" ]]; then
        post_backlog_hash="$(md5sum "$project_dir/BACKLOG.md" | cut -d' ' -f1)"
    else
        post_backlog_hash="none"
    fi
    if [[ "$pre_backlog_hash" != "$post_backlog_hash" ]]; then
        echo "true"
        return
    fi

    # Check if active epic file changed
    local pre_epic_hash post_epic_hash active_slug
    pre_epic_hash="$(cat "$state_dir/pre_epic_hash" 2>/dev/null || echo "none")"
    active_slug="$(cat "$state_dir/pre_epic_slug" 2>/dev/null || true)"
    if [[ -n "$active_slug" && -f "$project_dir/epics/$active_slug.md" ]]; then
        post_epic_hash="$(md5sum "$project_dir/epics/$active_slug.md" | cut -d' ' -f1)"
    else
        post_epic_hash="none"
    fi
    if [[ "$pre_epic_hash" != "$post_epic_hash" ]]; then
        echo "true"
        return
    fi

    echo "false"
}

# Check if all epics in BACKLOG.md are [x] done. Returns 0 if complete, 1 if work remains.
check_backlog_complete() {
    local backlog_file="$1"

    if [[ ! -f "$backlog_file" ]]; then
        return 1
    fi

    # If any epic is [ ] todo or [~] in-progress, work remains
    if grep -qP '^\- \[[ ~]\]' "$backlog_file" 2>/dev/null; then
        return 1
    fi

    # Check there's at least one [x] epic (not an empty backlog)
    if grep -qP '^\- \[x\]' "$backlog_file" 2>/dev/null; then
        return 0
    fi

    # No epics at all
    return 1
}

# Write stop reason and timestamp
save_stop_reason() {
    local state_dir="$1"
    local reason="$2"
    echo "$reason" > "$state_dir/stop-reason"
    date -u '+%Y-%m-%dT%H:%M:%SZ' > "$state_dir/stop-timestamp"
}

# Write iteration state file (bash-sourceable)
save_iteration_state() {
    local state_dir="$1"
    local iteration="$2"
    local exit_code="$3"
    local duration="$4"
    local no_progress_count="$5"
    local error_count="$6"
    local project_dir="$7"

    local git_hash
    git_hash="$(cd "$project_dir" && git rev-parse HEAD 2>/dev/null || echo "none")"

    cat > "$state_dir/state" <<EOF
LAST_ITERATION=$iteration
LAST_EXIT_CODE=$exit_code
LAST_ITERATION_DURATION=$duration
CONSECUTIVE_NO_PROGRESS=$no_progress_count
CONSECUTIVE_ERRORS=$error_count
LAST_GIT_HASH="$git_hash"
LAST_TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
EOF
}
