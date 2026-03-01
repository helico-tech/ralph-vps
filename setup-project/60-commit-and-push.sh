# shellcheck shell=bash
# 60-commit-and-push.sh - Git add, commit, push scaffolding

log_section "Commit & push"

cd "$PROJECT_DIR" || return 1
if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "Add ralph scaffolding (PROMPT.md, BACKLOG.md, epics/, project.conf, .claude/settings.json)"
    log_info "Committed scaffolding files."

    if git push 2>/dev/null; then
        log_info "Pushed scaffolding to remote."
    else
        log_warn "Could not push (remote may be empty). Run: ./bin/push-project.sh $NAME"
    fi
fi
cd "$ROOT_DIR" || return 1
