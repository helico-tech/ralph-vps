#!/usr/bin/env bash
#
# setup-vps.sh — One-time VPS bootstrap for ralph
#
# Run with: sudo ./setup-vps.sh
# Safe to re-run (idempotent).
#
# Phases live in setup-vps/*.sh and are sourced in numeric order.
# To add a new step, create e.g. setup-vps/45-docker.sh — it will be
# picked up automatically on the next run.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared logging functions and colors
source "$SCRIPT_DIR/lib/common.sh"

# ── Run phases in order ───────────────────────────────────────────────────────

for phase in "$SCRIPT_DIR"/setup-vps/[0-9][0-9]-*.sh; do
    phase_name="$(basename "$phase")"
    log_info "Running phase: $phase_name"
    # shellcheck source=/dev/null
    if ! source "$phase"; then
        log_error "Phase failed: $phase_name"
        exit 1
    fi
done
