#!/usr/bin/env bash
#
# ralph-loop.sh — Core loop engine for running Claude autonomously
#
# Usage: ralph-loop.sh <project-name>
#
# This script is called by start-loop.sh inside a tmux session.
# It repeatedly invokes Claude with the project's PROMPT.md until
# stopped via signal or iteration limit.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── Arguments ───────────────────────────────────────────────────────────────

PROJECT_NAME="${1:-}"
if [[ -z "$PROJECT_NAME" ]]; then
    log_error "Usage: ralph-loop.sh <project-name>"
    exit 1
fi

require_project "$PROJECT_NAME"

PROJECT_DIR="$PROJECTS_DIR/$PROJECT_NAME"
PROMPT_FILE="$PROJECT_DIR/PROMPT.md"

# ── Graceful shutdown ───────────────────────────────────────────────────────

SHUTDOWN=0

handle_shutdown() {
    log_warn "Shutdown signal received. Will exit after current iteration completes..."
    SHUTDOWN=1
}

trap handle_shutdown SIGINT SIGTERM

# ── Load config ─────────────────────────────────────────────────────────────

load_config "$PROJECT_NAME"

log_section "Ralph Loop: $PROJECT_NAME"
log_info "Project dir:  $PROJECT_DIR"
log_info "Max turns:    $MAX_TURNS"
log_info "Max iterations: $MAX_ITERATIONS (0=unlimited)"
log_info "Pause:        ${PAUSE_BETWEEN_LOOPS}s"
log_info "Restart:      $RESTART_POLICY"
[[ -n "$MODEL" ]] && log_info "Model:        $MODEL"
echo ""

# ── Main loop ───────────────────────────────────────────────────────────────

ITERATION=0

while true; do
    # Check shutdown flag
    if [[ "$SHUTDOWN" -eq 1 ]]; then
        log_info "Shutting down gracefully."
        exit 0
    fi

    # Check iteration limit
    ITERATION=$((ITERATION + 1))
    if [[ "$MAX_ITERATIONS" -gt 0 && "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log_info "Reached max iterations ($MAX_ITERATIONS). Exiting."
        exit 0
    fi

    # Re-read prompt each iteration (allows live updates)
    if [[ ! -f "$PROMPT_FILE" ]]; then
        log_error "PROMPT.md not found at $PROMPT_FILE"
        exit 1
    fi
    PROMPT="$(cat "$PROMPT_FILE")"

    # Re-load config each iteration (allows live config updates)
    load_config "$PROJECT_NAME"

    log_section "Iteration $ITERATION — $(date '+%Y-%m-%d %H:%M:%S')"

    # Build claude command
    CLAUDE_CMD=(claude -p --dangerously-skip-permissions --output-format text)

    if [[ "$MAX_TURNS" -gt 0 ]]; then
        CLAUDE_CMD+=(--max-turns "$MAX_TURNS")
    fi

    if [[ -n "$MODEL" ]]; then
        CLAUDE_CMD+=(--model "$MODEL")
    fi

    # Add extra flags (word-split intentional)
    if [[ -n "$CLAUDE_EXTRA_FLAGS" ]]; then
        # shellcheck disable=SC2206
        CLAUDE_CMD+=($CLAUDE_EXTRA_FLAGS)
    fi

    CLAUDE_CMD+=("$PROMPT")

    # Run Claude from the project directory
    EXIT_CODE=0
    (cd "$PROJECT_DIR" && "${CLAUDE_CMD[@]}") || EXIT_CODE=$?

    log_info "Claude exited with code $EXIT_CODE"

    # Check shutdown flag again after Claude finishes
    if [[ "$SHUTDOWN" -eq 1 ]]; then
        log_info "Shutting down gracefully."
        exit 0
    fi

    # Apply restart policy
    case "$RESTART_POLICY" in
        on-exit)
            # Always continue
            ;;
        on-success)
            if [[ "$EXIT_CODE" -ne 0 ]]; then
                log_warn "Claude exited with error (code $EXIT_CODE). Restart policy is 'on-success'. Stopping."
                exit "$EXIT_CODE"
            fi
            ;;
        never)
            log_info "Restart policy is 'never'. Exiting after single run."
            exit "$EXIT_CODE"
            ;;
        *)
            log_error "Unknown restart policy: $RESTART_POLICY"
            exit 1
            ;;
    esac

    # Pause between iterations (sleep in 1s increments for fast shutdown)
    log_info "Pausing ${PAUSE_BETWEEN_LOOPS}s before next iteration..."
    for ((i = 0; i < PAUSE_BETWEEN_LOOPS; i++)); do
        if [[ "$SHUTDOWN" -eq 1 ]]; then
            log_info "Shutting down during pause."
            exit 0
        fi
        sleep 1
    done
done
