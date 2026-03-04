---
name: ralph-status
description: Check Ralph system status and queue health. Use when the user asks about Ralph status, queue state, active tasks, or system health. Triggers on "ralph status", "queue status", "is ralph running", "what is ralph doing".
---

# Ralph Status

Show the current state of the Ralph task queue and system health.

## Instructions

### Step 1: Fetch status

Run:

```bash
ralph status --json
```

### Step 2: Check for errors

If the command exits with a non-zero status code or the output is not valid JSON, show the raw error output and suggest running `ralph doctor` to diagnose.

### Step 3: Present the results

Parse the JSON output and present a human-friendly summary:

1. **Queue overview** — Total tasks and counts per status (pending, active, review, done, failed)
2. **Active task** — If Ralph is currently working on something, show the task ID and title
3. **Last activity** — Show the most recent commit timestamp and message

Format example:

> **Ralph Status**
> 12 tasks total: 3 pending, 1 active, 2 review, 5 done, 1 failed
>
> Currently working on: **TASK-007** — Refactor auth module
>
> Last activity: 2 minutes ago — `ralph(TASK-007): work complete`

### Step 4: Health inference

If there is an active task but the last commit is older than 10 minutes, note that Ralph may be stuck or the task may be long-running.
