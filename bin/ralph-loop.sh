#!/usr/bin/env bash
#
# ralph-loop.sh — Core loop engine for running Claude autonomously
#
# Usage: ralph-loop.sh <project-name>
#
# This script is called by start-loop.sh inside a tmux session.
# It repeatedly invokes Claude with the project's PROMPT.md until
# stopped via signal, iteration limit, backlog completion, or circuit breaker.
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
BACKLOG_FILE="$PROJECT_DIR/BACKLOG.md"
COLLECTOR="$ROOT_DIR/lib/ralph-collector.js"

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
log_info "Circuit breaker: stall=$MAX_STALL_ITERATIONS errors=$MAX_CONSECUTIVE_ERRORS min_duration=${MIN_ITERATION_DURATION}s"
log_info "Backlog completion stop: $BACKLOG_COMPLETION_STOP"
[[ -n "$MODEL" ]] && log_info "Model:        $MODEL"
echo ""

# ── Initialize state ───────────────────────────────────────────────────────

STATE_DIR="$(init_state_dir "$PROJECT_DIR")"
CONSECUTIVE_NO_PROGRESS=0
CONSECUTIVE_ERRORS=0

# ── Main loop ───────────────────────────────────────────────────────────────

ITERATION=0

while true; do
    # Check shutdown flag
    if [[ "$SHUTDOWN" -eq 1 ]]; then
        log_info "Shutting down gracefully."
        save_stop_reason "$STATE_DIR" "shutdown_signal"
        exit 0
    fi

    # Check iteration limit
    ITERATION=$((ITERATION + 1))
    if [[ "$MAX_ITERATIONS" -gt 0 && "$ITERATION" -gt "$MAX_ITERATIONS" ]]; then
        log_info "Reached max iterations ($MAX_ITERATIONS). Exiting."
        save_stop_reason "$STATE_DIR" "max_iterations"
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

    # Record pre-iteration state for progress detection
    record_pre_state "$PROJECT_DIR" "$STATE_DIR"
    ITER_START="$(date +%s)"

    # Build claude command
    CLAUDE_CMD=(claude -p --verbose --output-format stream-json)

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

    # Run Claude from the project directory, pipe through collector
    # With set -o pipefail, the pipe returns Claude's exit code if it fails
    EXIT_CODE=0
    if [[ -f "$COLLECTOR" ]]; then
        (cd "$PROJECT_DIR" && export RALPH_ITERATION="$ITERATION" && "${CLAUDE_CMD[@]}" | node "$COLLECTOR") || EXIT_CODE=$?
    else
        (cd "$PROJECT_DIR" && "${CLAUDE_CMD[@]}") || EXIT_CODE=$?
    fi

    ITER_END="$(date +%s)"
    ITER_DURATION=$((ITER_END - ITER_START))

    log_info "Claude exited with code $EXIT_CODE (duration: ${ITER_DURATION}s)"

    # Check shutdown flag again after Claude finishes
    if [[ "$SHUTDOWN" -eq 1 ]]; then
        log_info "Shutting down gracefully."
        save_stop_reason "$STATE_DIR" "shutdown_signal"
        save_iteration_state "$STATE_DIR" "$ITERATION" "$EXIT_CODE" "$ITER_DURATION" "$CONSECUTIVE_NO_PROGRESS" "$CONSECUTIVE_ERRORS" "$PROJECT_DIR"
        exit 0
    fi

    # ── Post-iteration intelligence ─────────────────────────────────────────

    # 1. Backlog completion check
    if [[ "$BACKLOG_COMPLETION_STOP" == "true" ]] && check_backlog_complete "$BACKLOG_FILE"; then
        log_info "All epics in BACKLOG.md are done! Stopping loop."
        save_stop_reason "$STATE_DIR" "backlog_complete"
        save_iteration_state "$STATE_DIR" "$ITERATION" "$EXIT_CODE" "$ITER_DURATION" "0" "0" "$PROJECT_DIR"
        exit 0
    fi

    # 2. Progress detection
    PROGRESS="$(detect_progress "$PROJECT_DIR" "$STATE_DIR")"
    if [[ "$PROGRESS" == "false" ]] || [[ "$ITER_DURATION" -lt "$MIN_ITERATION_DURATION" ]]; then
        CONSECUTIVE_NO_PROGRESS=$((CONSECUTIVE_NO_PROGRESS + 1))
        log_warn "No progress detected (${CONSECUTIVE_NO_PROGRESS}/${MAX_STALL_ITERATIONS})"

        if [[ "$MAX_STALL_ITERATIONS" -gt 0 && "$CONSECUTIVE_NO_PROGRESS" -ge "$MAX_STALL_ITERATIONS" ]]; then
            log_error "No progress in $MAX_STALL_ITERATIONS consecutive iterations. Stopping loop."
            save_stop_reason "$STATE_DIR" "no_progress"
            save_iteration_state "$STATE_DIR" "$ITERATION" "$EXIT_CODE" "$ITER_DURATION" "$CONSECUTIVE_NO_PROGRESS" "$CONSECUTIVE_ERRORS" "$PROJECT_DIR"
            exit 1
        fi
    else
        CONSECUTIVE_NO_PROGRESS=0
    fi

    # 3. Error tracking
    if [[ "$EXIT_CODE" -ne 0 ]]; then
        CONSECUTIVE_ERRORS=$((CONSECUTIVE_ERRORS + 1))
        log_warn "Consecutive errors: ${CONSECUTIVE_ERRORS}/${MAX_CONSECUTIVE_ERRORS}"

        if [[ "$MAX_CONSECUTIVE_ERRORS" -gt 0 && "$CONSECUTIVE_ERRORS" -ge "$MAX_CONSECUTIVE_ERRORS" ]]; then
            log_error "$MAX_CONSECUTIVE_ERRORS consecutive errors. Stopping loop."
            save_stop_reason "$STATE_DIR" "consecutive_errors"
            save_iteration_state "$STATE_DIR" "$ITERATION" "$EXIT_CODE" "$ITER_DURATION" "$CONSECUTIVE_NO_PROGRESS" "$CONSECUTIVE_ERRORS" "$PROJECT_DIR"
            exit 1
        fi
    else
        CONSECUTIVE_ERRORS=0
    fi

    # Save iteration state
    save_iteration_state "$STATE_DIR" "$ITERATION" "$EXIT_CODE" "$ITER_DURATION" "$CONSECUTIVE_NO_PROGRESS" "$CONSECUTIVE_ERRORS" "$PROJECT_DIR"

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
            save_stop_reason "$STATE_DIR" "shutdown_signal"
            exit 0
        fi
        sleep 1
    done
done
