---
name: ralph-task
description: Create a new Ralph task. Use when the user wants to create, add, or queue a task for Ralph to execute. Triggers on "create task", "add task", "new task", "ralph task".
---

# Create Ralph Task

Guide the user through creating a high-quality, well-specified task for Ralph's autonomous execution queue.

## Instructions

### Step 1: Extract initial context

Parse the user's message to extract as much as possible:
- Task intent (what needs to be done)
- Task type (feature / bugfix / refactor / research / test / chore) — infer from language ("fix" = bugfix, "add" = feature, "refactor"/"clean up" = refactor, etc.)
- Priority hint ("urgent", "low priority", etc.)
- Any mentioned files or components

If the message is a single vague sentence, proceed to Step 2. If it contains enough detail (clear what, why, and how to verify), skip to Step 3.

### Step 2: Clarify and enrich

Ask these questions **in one message** (don't ask one at a time):

1. **Expected behavior**: "What should happen after this is done? How would you verify it works?"
2. **Affected files/components**: "Which parts of the codebase does this touch? Any specific files?"
3. **Constraints**: "Any technical constraints? (e.g., don't change the public API, must work without new dependencies)"

While asking, **search the codebase** to suggest relevant files:

- Run 2-3 targeted grep/glob searches based on the task topic
- Include your findings in the question: "I found these potentially relevant files — do any of these apply? [list]"

Convert the user's answer to the "Expected behavior" question into acceptance criteria. Each distinct verifiable outcome becomes one criterion.

### Step 3: Determine task metadata

| Field | Value |
|-------|-------|
| Title | Short, actionable (max ~60 chars). Start with a verb: "Add", "Fix", "Refactor", "Investigate" |
| Type | Inferred from intent |
| Priority | 100 default; 10-50 for urgent; 150+ for low priority |
| Description | 2-4 sentences: what and why |
| Author | Ask if not provided, or omit |

### Step 4: Show preview and confirm

Present the full task before creating it:

```
Title: <title>
Type: <type> | Priority: <priority>
Description: <description>

Acceptance criteria:
- <criterion 1>
- <criterion 2>

Files: <list or "none specified">
Constraints: <list or "none">
```

Ask: "Does this look right? I'll create it once you confirm."

If the user wants changes, update and show the preview again.

### Step 5: Create the task

Run the CLI command with all collected fields:

```bash
ralph task create \
  --title "<title>" \
  --type <type> \
  --priority <priority> \
  --description "<description>" \
  [--author "<author>"] \
  [--criteria "<criterion 1>"] \
  [--criteria "<criterion 2>"] \
  [--files "<path1>"] \
  [--files "<path2>"] \
  [--constraints "<constraint1>"]
```

Only include flags where values were collected. `--criteria`, `--files`, and `--constraints` are repeatable — pass one flag per item.

### Step 6: Report result

Show the created task ID and confirm it was queued. If the command fails:
- "Config file not found" — run `ralph doctor` to check setup
- "Failed to push" — check git remote configuration
