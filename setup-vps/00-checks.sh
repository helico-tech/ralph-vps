# shellcheck shell=bash
# 00-checks.sh - Root check, user detection, banner
#
# Sets: ACTUAL_USER, ACTUAL_HOME

if [[ "$EUID" -ne 0 ]]; then
    log_error "Please run with sudo: sudo ./setup-vps.sh"
    exit 1
fi

# Detect the actual user (when run via sudo)
ACTUAL_USER="${SUDO_USER:-$USER}"
# shellcheck disable=SC2034  # used by later phases
ACTUAL_HOME="$(eval echo "~$ACTUAL_USER")"

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║       ralph-vps Setup Script         ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"
