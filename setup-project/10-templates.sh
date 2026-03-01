# shellcheck shell=bash
# 10-templates.sh - Copy PROMPT.md, BACKLOG.md, epics/ (if missing)

log_section "Templates"

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

# Create epics/ directory with example epic (only if it doesn't exist)
if [[ ! -d "$PROJECT_DIR/epics" ]]; then
    mkdir -p "$PROJECT_DIR/epics"
    cp "$TEMPLATES_DIR/epics/example-setup.md" "$PROJECT_DIR/epics/"
    log_info "Created epics/ directory with example epic"
else
    log_info "epics/ directory already exists, keeping it"
fi
