---
name: ralph-review
description: Review a completed Ralph task — approve to merge or reject to re-queue. Use when the user wants to review, approve, reject, or inspect a Ralph task. Triggers on "review task", "approve task", "reject task", "ralph review".
---

# Review Ralph Task

Guide the user through reviewing a task that Ralph has completed.

## Instructions

### Step 1: List reviewable tasks

Run:

```bash
ralph task list --status review --json
```

If no tasks are in review, tell the user and stop.

If there's exactly one task, proceed with it. If multiple, show the list and ask which one.

### Step 2: Show task details and execution metadata

Read the task file:

```bash
cat .ralph/tasks/review/<TASK-ID>.md
```

Show the user:
- Task title, description, and acceptance criteria
- Execution metadata from the frontmatter:
  - **Cost**: `cost_usd` (e.g., "$0.47")
  - **Turns**: `turns`
  - **Duration**: `duration_s` (format as "2m 14s")
  - **Retries**: `retry_count` / `max_retries`
  - **Branch**: `branch`

### Step 3: Show the diff

Read the project config to get the main branch:

```bash
cat .ralph/config.json
```

Show the diff:

```bash
git diff <main_branch>...<branch>
```

Summarize: files changed, lines added/removed, overall approach.

### Step 4: Evaluate against acceptance criteria

For each acceptance criterion from the task file, assess whether the diff satisfies it:

- **Met** — the diff clearly addresses this criterion
- **Partially met** — some aspects are addressed but not completely
- **Not met** — no evidence of this criterion being addressed

Example format:
```
✓ Login form validates email format — EmailInput adds regex check
✓ Error message shown on failed login — AuthForm renders ErrorBanner
✗ Password field masked — no changes to PasswordInput found
```

If any criterion is not met, flag it as grounds for rejection.

### Step 5: Get the user's decision

Present your evaluation summary and ask the user to **approve** or **reject**.

If rejecting, ask for a reason (defaults to "criteria not met").

### Step 6: Execute the decision

**Approve:**
```bash
ralph review <TASK-ID> --approve
```

**Reject:**
```bash
ralph review <TASK-ID> --reject --reason "<reason>"
```

### Step 7: Report result

Confirm the action. If rejected with retries remaining, note that Ralph will retry automatically.

## Error handling

- **Merge conflict** — Tell the user the merge failed; they need to resolve manually. Task stays in review.
- **Push failed** — Check git remote connectivity.
- **Task not found** — Run `ralph task list --status review` to verify the ID.
