---
name: ralph-list
description: List Ralph tasks with optional status filter. Use when the user wants to see tasks, list the queue, check pending or failed tasks. Triggers on "list tasks", "show tasks", "ralph list", "what tasks", "task queue".
---

# List Ralph Tasks

Show the current tasks in the Ralph queue.

## Instructions

### Step 1: Determine filter

If the user asks for a specific status (e.g., "show me failed tasks", "what's pending"), use the status filter. Otherwise, show all tasks.

Valid statuses: `pending`, `active`, `review`, `done`, `failed`

### Step 2: Fetch tasks

**All tasks:**
```bash
ralph task list --json
```

**Filtered by status:**
```bash
ralph task list --status <status> --json
```

### Step 3: Present the results

Parse the JSON output and display a formatted table:

| ID | Status | Type | Priority | Title |
|----|--------|------|----------|-------|
| TASK-001 | pending | feature | 100 | Add user authentication |
| TASK-002 | active | bugfix | 10 | Fix null crash in auth |
| TASK-003 | done | refactor | 50 | Clean up logging |

If no tasks are found, tell the user the queue is empty (or no tasks match the filter).

### Step 4: Offer follow-up actions

Based on what's shown, suggest relevant next steps:
- If tasks are in **review** — offer to review them (the ralph-review skill can help)
- If the queue is **empty** — offer to create a task (the ralph-task skill can help)
- If tasks are **failed** — show the task details so the user can decide whether to retry or investigate
