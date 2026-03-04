---
name: ralph-task
description: Create a new Ralph task. Use when the user wants to create, add, or queue a task for Ralph to execute. Triggers on "create task", "add task", "new task", "ralph task".
---

# Create Ralph Task

Guide the user through creating a task for Ralph's autonomous execution queue.

## Instructions

### Step 1: Gather task details

Ask the user for the following. Only **title** is required — provide sensible defaults for the rest.

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| Title | Yes | — | Short, actionable description |
| Type | No | `feature` | One of: `feature`, `bugfix`, `refactor`, `research`, `test`, `chore` |
| Priority | No | `100` | Lower number = higher priority |
| Description | No | `""` | Detailed explanation of what needs to be done |
| Author | No | — | Who requested this task |

If the user provides everything in their initial message (e.g., "create a bugfix task to fix the login crash"), extract the details directly instead of asking.

### Step 2: Create the task

Run the CLI command:

```bash
ralph task create --title "<title>" [--type <type>] [--priority <priority>] [--description "<description>"] [--author "<author>"]
```

**Important:** Only include optional flags when the user provided a value. Do not pass empty strings — omit the flag entirely.

### Step 3: Report the result

Show the user the CLI output confirming the task was created. Include the generated task ID.

If the command fails, show the error and suggest fixes:
- "Config file not found" — run `ralph doctor` to check setup
- "Failed to push" — check git remote configuration

## Examples

**Simple task:**
```bash
ralph task create --title "Add user authentication"
```

**Detailed task:**
```bash
ralph task create --title "Fix null crash in auth handler" --type bugfix --priority 10 --description "The authenticate() function crashes when email is null" --author "Arjan"
```
