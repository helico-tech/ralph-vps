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

If there's exactly one task, proceed with it. If multiple, show the list and ask the user which one to review.

### Step 2: Show the task details

Read the task file to show the user what Ralph was asked to do:

```bash
cat .ralph/tasks/review/<TASK-ID>.md
```

### Step 3: Show the diff

First, read the project config to determine the main branch and branch prefix:

```bash
cat .ralph/config.json
```

Look for `git.main_branch` (default: `main`) and `git.branch_prefix` (default: `ralph/`). The task's JSON output also includes a `branch` field if set.

Show the code changes Ralph made on the feature branch:

```bash
git diff <main_branch>...<branch_prefix><TASK-ID>
```

For example, with defaults: `git diff main...ralph/TASK-001`

Summarize the changes for the user — what files were modified, what was added/removed, and whether it looks correct.

### Step 4: Get the user's decision

Ask the user to **approve** or **reject** the task.

If rejecting, ask for a reason (optional — defaults to "no reason given").

### Step 5: Execute the decision

**Approve:**
```bash
ralph review <TASK-ID> --approve
```

This merges the feature branch into main, moves the task to done, and deletes the branch.

**Reject:**
```bash
ralph review <TASK-ID> --reject --reason "<reason>"
```

This moves the task back to pending (if retries remain) or to failed. The branch is deleted.

### Step 6: Report the result

Show the CLI output confirming the action. If the task was rejected with retries remaining, let the user know Ralph will retry it automatically.

## Error handling

- **Merge conflict on approve** — Tell the user the merge failed and they need to resolve conflicts manually. The task stays in review.
- **Push failed** — Check git remote connectivity.
- **Task not found** — The task ID may be wrong. Run `ralph task list --status review` to check.
