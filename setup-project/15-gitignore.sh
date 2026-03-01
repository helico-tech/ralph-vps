# shellcheck shell=bash
# 15-gitignore.sh - Ensure .ralph/ (loop state dir) is gitignored

log_section "Gitignore"

if ! grep -q '^\.ralph/' "$PROJECT_DIR/.gitignore" 2>/dev/null; then
    echo -e "\n# Ralph loop state\n.ralph/" >> "$PROJECT_DIR/.gitignore"
    log_info "Added .ralph/ to .gitignore"
else
    log_info ".ralph/ already in .gitignore"
fi
