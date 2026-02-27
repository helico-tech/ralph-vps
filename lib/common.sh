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
