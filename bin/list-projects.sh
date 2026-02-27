#!/usr/bin/env bash
#
# list-projects.sh — List all ralph projects with their status
#
# Usage: list-projects.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

# ── List ────────────────────────────────────────────────────────────────────

if [[ ! -d "$PROJECTS_DIR" ]] || [[ -z "$(ls -A "$PROJECTS_DIR" 2>/dev/null)" ]]; then
    log_info "No projects found. Add one with:"
    echo "  ./bin/add-project.sh <name> <github-url>"
    exit 0
fi

printf "${BOLD}%-20s %-10s %s${NC}\n" "PROJECT" "STATUS" "PROMPT (first line)"
printf "%-20s %-10s %s\n" "-------" "------" "-------------------"

for project_dir in "$PROJECTS_DIR"/*/; do
    [[ -d "$project_dir" ]] || continue

    name="$(basename "$project_dir")"

    # Status
    if is_loop_running "$name"; then
        status="${GREEN}RUNNING${NC}"
    else
        status="${RED}STOPPED${NC}"
    fi

    # First meaningful line of PROMPT.md
    prompt_line=""
    if [[ -f "$project_dir/PROMPT.md" ]]; then
        prompt_line="$(grep -m1 -v '^#\|^$\|^---' "$project_dir/PROMPT.md" 2>/dev/null || echo "(empty)")"
        # Truncate long lines
        if [[ ${#prompt_line} -gt 50 ]]; then
            prompt_line="${prompt_line:0:47}..."
        fi
    else
        prompt_line="${YELLOW}(no PROMPT.md)${NC}"
    fi

    printf "%-20s %-10b %s\n" "$name" "$status" "$prompt_line"
done
