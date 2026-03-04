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

**For failed tasks**, include retry information:

| ID | Status | Type | Retries | Title |
|----|--------|------|---------|-------|
| TASK-005 | failed | bugfix | 2/2 | Fix auth crash |

Show `retry_count / max_retries` so the user knows if retries were exhausted.

If no tasks are found, tell the user the queue is empty (or no tasks match the filter).

### Step 4: Offer follow-up actions

Based on what's shown, suggest relevant next steps:
- Tasks in **review** — offer to review them (the ralph-review skill can help)
- Queue **empty** — offer to create a task (the ralph-task skill can help)
- **Failed** tasks — read the task file to show details:
  ```bash
  cat .ralph/tasks/failed/<TASK-ID>.md
  ```
  Then help the user decide whether to investigate the failure or create a new task.
