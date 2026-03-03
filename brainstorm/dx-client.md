# Developer Experience & Client Tooling Brainstorm

## 1. Task Generation Workflow

### How does the user create a backlog?

The user's primary interface is their local laptop running Claude Code interactively. Task generation should feel native to that workflow -- not some separate system they have to context-switch into.

### Approach: A `/ralph-task` Skill

A Claude Code skill at `.claude/skills/ralph-task/SKILL.md` that generates task files in a standardized format. The skill:

1. Takes a natural language description from the user
2. Structures it into a task YAML/Markdown file with metadata (priority, dependencies, acceptance criteria)
3. Places it in `tasks/backlog/` in the git repo
4. Commits and pushes to the remote

```yaml
# .claude/skills/ralph-task/SKILL.md
---
name: ralph-task
description: Create a new task for the remote Ralph agent to pick up
disable-model-invocation: true
argument-hint: "[description of what you want done]"
allowed-tools: Read, Write, Bash(git *)
---
```

### Task File Format

Keep it dead simple. A Markdown file with YAML frontmatter:

```markdown
---
id: task-20260303-001
status: backlog
priority: normal
created: 2026-03-03T10:30:00Z
author: avanwieringen
depends_on: []
---

# Add rate limiting to the API

## Description
Add rate limiting middleware to all API endpoints. Use a sliding window
algorithm with configurable limits per endpoint.

## Acceptance Criteria
- [ ] Rate limiter middleware implemented
- [ ] Configurable per-endpoint limits
- [ ] Returns 429 with Retry-After header
- [ ] Tests pass
```

### Why Markdown+YAML?

- Human-readable (you can review tasks in any editor or on GitHub)
- Git-diffable (easy to see what changed)
- No database needed -- the filesystem IS the database
- Claude Code can read/write it natively with zero additional tooling

### Batch vs Interactive

Both should be supported:

- **Interactive (primary)**: `/ralph-task Add rate limiting to the API` -- quick, one-off task creation during a coding session.
- **Batch**: `/ralph-backlog` skill that takes a feature description and breaks it into multiple ordered tasks with dependencies. This uses Claude to decompose work.

```yaml
# .claude/skills/ralph-backlog/SKILL.md
---
name: ralph-backlog
description: Break down a feature into multiple Ralph tasks with dependencies
disable-model-invocation: true
argument-hint: "[feature description]"
context: fork
agent: general-purpose
allowed-tools: Read, Write, Bash(git *)
---
```

### Task Lifecycle States

```
backlog -> queued -> in_progress -> review -> done
                  -> failed -> backlog (retry)
                            -> cancelled
```

File location encodes state:
```
tasks/
  backlog/     # Waiting to be picked up
  active/      # Currently being worked on by the node
  review/      # Completed, needs human review
  done/        # Approved and merged
  failed/      # Failed, needs attention
```

**Why directories instead of status field?** Because `git ls-files tasks/active/` is simpler than parsing YAML. The frontmatter `status` field is redundant but kept for human readability and as a cross-check.


## 2. Status Introspection

### How does the user check what the node is doing?

The user is on their laptop. The node is a VPS somewhere. The user needs answers to:
- Is the node running?
- What task is it working on?
- How far along is it?
- Did anything fail?

### Approach: Multi-Layer Status

#### Layer 1: Git-Based Status (Pull and Check)

A `status.json` file at the repo root, updated by the node after every significant action:

```json
{
  "node_id": "ralph-vps-01",
  "last_heartbeat": "2026-03-03T14:22:00Z",
  "current_task": "task-20260303-001",
  "task_status": "in_progress",
  "phase": "running_tests",
  "started_at": "2026-03-03T14:10:00Z",
  "tasks_completed_today": 3,
  "tasks_failed_today": 0,
  "last_commit": "abc1234"
}
```

The node pushes this to git periodically (every few minutes or after each phase transition). The user just does `git pull` and reads it. No SSH, no web server, no extra infrastructure.

#### Layer 2: `/ralph-status` Skill

A local Claude Code skill that reads status.json + git log and presents a human-friendly summary:

```yaml
---
name: ralph-status
description: Check the status of the remote Ralph agent node
disable-model-invocation: true
allowed-tools: Bash(git *), Read
---
```

Running `/ralph-status` would output something like:

```
Ralph Node: ralph-vps-01
Status: WORKING
Current Task: Add rate limiting to the API (task-20260303-001)
Phase: Running tests (started 12 min ago)
Last heartbeat: 2 min ago

Queue: 3 tasks in backlog, 0 in review
Today: 3 completed, 0 failed

Recent activity:
  14:22 - Running test suite
  14:15 - Implemented rate limiter middleware
  14:10 - Started task-20260303-001
  13:45 - Completed task-20260302-005 (refactor auth module)
```

#### Layer 3: Activity Log

The node writes an append-only `logs/activity.log` (or `logs/YYYY-MM-DD.log`) with structured entries:

```
2026-03-03T14:22:00Z [task-20260303-001] phase=test msg="Running test suite"
2026-03-03T14:15:00Z [task-20260303-001] phase=implement msg="Implemented rate limiter"
2026-03-03T14:10:00Z [task-20260303-001] phase=start msg="Starting task"
```

This is pushed to git along with status.json. It gives the user a detailed timeline without needing SSH or a dashboard. Think of it as the node's "commit log for actions taken."

#### Layer 4: SSH (Escape Hatch)

For when things go wrong and git-based introspection isn't enough, the user can SSH in. But this should be the exception, not the norm. The system should be designed so you almost never need SSH.

### What about a web dashboard?

**Not in v1.** A web dashboard is:
- More infrastructure to set up and maintain
- Another thing that can break
- Unnecessary when git + a skill gives you the same information

If we ever want one, the `status.json` and `activity.log` are the perfect data source. The dashboard just reads git. But let's not build it until we need it.


## 3. Review Workflow

### When a task needs human review, how is the user notified? How do they approve/reject?

The node completes a task, pushes results to a branch, and moves the task file to `tasks/review/`. The user sees this on their next `git pull` or `/ralph-status` check.

### Review Flow

1. **Node completes task**: Creates a feature branch (`ralph/task-20260303-001`), pushes code, moves task to `tasks/review/`, updates `status.json`
2. **User checks status**: `/ralph-status` shows "1 task awaiting review"
3. **User reviews**: `/ralph-review` skill walks them through the changes
4. **User approves or rejects**: Approve merges the branch. Reject adds feedback and moves back to backlog.

### `/ralph-review` Skill

```yaml
---
name: ralph-review
description: Review completed tasks from the Ralph agent
disable-model-invocation: true
allowed-tools: Bash(git *), Read, Write
---
```

This skill would:
1. List all tasks in `tasks/review/`
2. For each (or a selected one):
   - Show the task description and acceptance criteria
   - Show the git diff of the feature branch
   - Show test results
   - Ask the user to approve/reject/request-changes
3. On approve: merge branch, move task to `tasks/done/`
4. On reject: add review comments to the task file, move back to `tasks/backlog/` with `status: revision_needed`

### Review Task File (After Node Completes)

The node updates the task file when done:

```markdown
---
id: task-20260303-001
status: review
priority: normal
created: 2026-03-03T10:30:00Z
author: avanwieringen
completed_at: 2026-03-03T14:30:00Z
branch: ralph/task-20260303-001
commit_range: abc1234..def5678
test_results: all_passed
---

# Add rate limiting to the API

## Description
...

## Acceptance Criteria
- [x] Rate limiter middleware implemented
- [x] Configurable per-endpoint limits
- [x] Returns 429 with Retry-After header
- [x] Tests pass

## Agent Notes
Implemented using a sliding window algorithm in `src/middleware/rate-limiter.ts`.
Added configuration in `config/rate-limits.yaml`. All 12 tests pass.
```

### Rejection with Feedback

When the user rejects, their feedback is appended to the task:

```markdown
## Review Feedback (2026-03-03T15:00:00Z)
- The sliding window implementation looks correct but needs Redis backing for multi-instance support
- Add integration tests with actual HTTP requests, not just unit tests
```

The task gets moved back to `tasks/backlog/` (or a dedicated `tasks/revision/` directory) and the node picks it up again with the feedback context.


## 4. Task Management CLI

### Commands for listing, changing priority, adding, cancelling tasks

All of these should be Claude Code skills, not a separate CLI tool. The user's terminal already has Claude Code. Don't add another binary.

### Skill Overview

| Skill | Purpose |
|---|---|
| `/ralph-task <desc>` | Create a single task |
| `/ralph-backlog <feature>` | Decompose feature into multiple tasks |
| `/ralph-status` | Check node status and queue |
| `/ralph-review` | Review completed tasks |
| `/ralph-list` | List all tasks with filters |
| `/ralph-cancel <id>` | Cancel a task |
| `/ralph-priority <id> <level>` | Change task priority |
| `/ralph-pause` | Pause the node (stop picking up new tasks) |
| `/ralph-resume` | Resume the node |

### `/ralph-list` Skill

```yaml
---
name: ralph-list
description: List Ralph tasks with optional filters
disable-model-invocation: true
argument-hint: "[status|priority|all]"
allowed-tools: Bash(git *), Read, Glob, Grep
---
```

Output:

```
Tasks in backlog (3):
  HIGH   task-20260303-003  Fix authentication bypass vulnerability
  NORMAL task-20260303-001  Add rate limiting to the API
  LOW    task-20260303-002  Update README with new endpoints

In progress (1):
  task-20260303-004  Refactor database connection pooling

Awaiting review (1):
  task-20260302-005  Add pagination to user list endpoint

Completed today (2):
  task-20260302-003  Fix CORS headers
  task-20260302-004  Add health check endpoint
```

### `/ralph-cancel` Skill

Moves a task file to `tasks/cancelled/` (or deletes it), commits, and pushes. If the task is currently in progress, it also writes a cancel signal that the node checks for.

### Cancel Signal

When cancelling an active task, write a `tasks/signals/cancel-<task-id>` file. The node's loop checks for signals before each phase. This avoids needing a real-time communication channel -- it's just git.


## 5. Monitoring

### Real-time vs periodic status checks?

**Periodic is fine for v1.** The user doesn't need to watch the node work in real time. They throw tasks at it and check back. This is the whole point.

### What Info Does the User Need?

**Essential (v1):**
- Is the node alive? (heartbeat in status.json, last updated < 5 min ago)
- What is it doing? (current task + phase)
- What's in the queue? (count of backlog/active/review tasks)
- Did anything fail? (failed task count + basic error info)

**Nice to Have (v2):**
- Token usage / cost estimate per task
- Average task completion time
- Session ID for the running Claude Code instance (for debugging)
- Git commit history for a specific task

### Health Check

The node writes a heartbeat to `status.json` every 2-3 minutes. The `/ralph-status` skill checks this:

```
if (now - last_heartbeat > 5 minutes):
    status = "POSSIBLY DOWN"
if (now - last_heartbeat > 15 minutes):
    status = "DOWN"
```

No need for uptime monitoring services in v1. The user just runs `/ralph-status` when they care.


## 6. Notifications

### Should the user get notified when tasks complete? How?

**v1: No push notifications.** The user pulls status when they want it. This is simpler and avoids:
- Setting up notification infrastructure
- Managing notification preferences
- Dealing with notification fatigue

### Future Options (v2+)

If notifications become desired:

1. **Git hooks on the user's machine**: A local `post-merge` hook that checks if tasks moved to `review/` and shows a macOS notification. Zero infrastructure, purely local.

```bash
#!/bin/bash
# .git/hooks/post-merge
if git diff HEAD@{1} --name-only | grep -q "tasks/review/"; then
  osascript -e 'display notification "Ralph has tasks ready for review" with title "Ralph"'
fi
```

2. **Webhook to a simple endpoint**: The node could `curl` a webhook (ntfy.sh, Pushover, or a simple Slack webhook) when a task completes. One line of code, no server to manage.

```bash
curl -d "Task completed: $TASK_ID" ntfy.sh/ralph-notifications
```

3. **Email via a transactional service**: Overkill for v1 but trivial to add later since we have all the data.

### Recommendation

Start with pull-based status. Add ntfy.sh webhook as the first notification upgrade -- it's literally one curl command and gives you push notifications on phone/desktop.


## 7. The Ideal User Workflow

### Step-by-step: From "I have a feature idea" to "it's implemented and reviewed"

```
MORNING (User's Laptop)
========================
1. User opens their project in Claude Code
2. Has an idea for a feature: "We need rate limiting on the API"

3. User: /ralph-backlog Add rate limiting to all API endpoints with
   configurable per-endpoint limits and proper 429 responses

4. Claude Code (via the skill):
   - Decomposes into 3 tasks:
     a. Implement sliding window rate limiter core
     b. Add rate limiter middleware to Express routes
     c. Add rate limit configuration system
   - Sets dependencies (b depends on a, c depends on a)
   - Writes task files to tasks/backlog/
   - Commits and pushes

5. User: /ralph-status
   -> "Node is IDLE. 3 new tasks in backlog. Starting pickup..."

6. User closes laptop, goes to meetings.


AFTERNOON (Node, Autonomously)
===============================
7. Node pulls, finds 3 new tasks in backlog/
8. Picks up task (a) - highest priority, no dependencies
9. Creates branch ralph/task-20260303-001
10. Works on implementation (Claude Code -p with --agent ralph-worker)
11. Runs tests, they pass
12. Moves task to tasks/review/, updates status.json
13. Commits and pushes
14. Picks up task (b) - dependency (a) now satisfied
15. ... continues ...


EVENING (User's Laptop)
========================
16. User: /ralph-status
    -> "Node completed 2 tasks. 1 in progress. 2 awaiting review."

17. User: /ralph-review
    -> Claude shows diff for task (a): rate limiter core
    -> User reviews, approves
    -> Branch merged, task moved to done/

    -> Claude shows diff for task (b): middleware integration
    -> User spots an issue: "Should use Redis for multi-instance"
    -> User rejects with feedback
    -> Task moved back to backlog with feedback

18. User: /ralph-status
    -> "1 task in backlog (revision). 1 in progress. 0 in review."
    -> Node will pick up the revision task next.

19. User closes laptop. Node keeps working.


NEXT MORNING
=============
20. User: /ralph-status
    -> "All 3 tasks completed and awaiting review."

21. User: /ralph-review
    -> Reviews all. The Redis backing looks good now.
    -> Approves all.

22. Done.
```

### Key Properties of This Workflow

- **Asynchronous**: User throws work, checks back later. No need to watch.
- **Git-native**: Everything flows through git. No new protocols or services.
- **Review gate**: Nothing merges without human approval.
- **Feedback loop**: Rejection + feedback -> automatic retry with context.
- **No SSH needed**: Normal operations never require the user to SSH into the VPS.
- **Incremental**: Works with 1 task or 30 tasks.


## 8. Skill Design

### Complete Skill Inventory

All skills live in `.claude/skills/ralph-*/SKILL.md` in the project repo, so they're version-controlled and shared.

### Core Skills (v1)

#### `/ralph-task` - Create a Single Task
```yaml
---
name: ralph-task
description: Create a new task for the remote Ralph agent node
disable-model-invocation: true
argument-hint: "[task description]"
allowed-tools: Read, Write, Bash(git *)
---

Create a new task file for the Ralph remote agent.

1. Generate a task ID: task-YYYYMMDD-NNN (check existing tasks for next number)
2. Create the task file at tasks/backlog/$TASK_ID.md with this format:
   - YAML frontmatter: id, status (backlog), priority (normal), created, author
   - Markdown body: title, description, acceptance criteria
3. Parse the user's description ($ARGUMENTS) to extract:
   - A clear title
   - Detailed description with context
   - Concrete acceptance criteria
4. Git add, commit ("Add task: $TITLE"), and push

If the description is vague, ask the user to clarify before creating the task.
```

#### `/ralph-backlog` - Decompose Feature into Tasks
```yaml
---
name: ralph-backlog
description: Break a feature into multiple Ralph tasks with dependencies
disable-model-invocation: true
argument-hint: "[feature description]"
allowed-tools: Read, Write, Bash(git *), Glob, Grep
---

Decompose a feature request into multiple ordered tasks.

1. Analyze the feature description ($ARGUMENTS)
2. Read the current codebase to understand context
3. Break into 2-7 discrete tasks, each independently testable
4. Set dependencies where one task's output is another's input
5. Write all task files to tasks/backlog/
6. Show the user the task breakdown for confirmation before committing
7. Git add, commit, and push
```

#### `/ralph-status` - Check Node Status
```yaml
---
name: ralph-status
description: Check the status of the remote Ralph agent node
disable-model-invocation: true
allowed-tools: Bash(git *), Read, Glob, Grep
---

Check the Ralph node status.

1. Run `git fetch && git pull` to get latest state
2. Read status.json for node heartbeat and current activity
3. Count tasks in each directory (backlog, active, review, done, failed)
4. Read the last 20 lines of the activity log
5. Present a clear summary:
   - Node status (alive/possibly down/down based on heartbeat)
   - Current task and phase
   - Queue summary
   - Recent activity timeline
   - Any failures or warnings
```

#### `/ralph-review` - Review Completed Tasks
```yaml
---
name: ralph-review
description: Review and approve/reject completed Ralph tasks
disable-model-invocation: true
allowed-tools: Read, Write, Bash(git *), Glob, Grep
---

Review tasks completed by the Ralph node.

1. Run `git fetch && git pull`
2. List all tasks in tasks/review/
3. For each task (or let user pick one):
   a. Show task description and acceptance criteria
   b. Show the git diff: `git diff main...$BRANCH`
   c. Show test results from the task metadata
   d. Ask: approve, reject with feedback, or skip
4. On approve:
   - Merge the feature branch to main
   - Move task file to tasks/done/
   - Commit and push
5. On reject:
   - Ask user for feedback
   - Append feedback to the task file under "## Review Feedback"
   - Move task to tasks/backlog/ with status: revision_needed
   - Commit and push
```

#### `/ralph-list` - List Tasks
```yaml
---
name: ralph-list
description: List all Ralph tasks with optional status filter
disable-model-invocation: true
argument-hint: "[backlog|active|review|done|failed|all]"
allowed-tools: Bash(git *), Read, Glob, Grep
---

List Ralph tasks, optionally filtered by status.

1. Run `git pull` for latest state
2. If $ARGUMENTS is provided, filter to that directory
3. Otherwise show all non-done tasks grouped by status
4. For each task, show: priority, ID, title, created date
5. Sort by priority (high first), then by created date
```

### Control Skills (v1)

#### `/ralph-cancel` - Cancel a Task
```yaml
---
name: ralph-cancel
description: Cancel a Ralph task
disable-model-invocation: true
argument-hint: "[task-id]"
allowed-tools: Read, Write, Bash(git *)
---

Cancel a task by ID.

1. Find the task file across all status directories
2. If in active/: also write a cancel signal to tasks/signals/cancel-$ID
3. Move the task file to tasks/cancelled/
4. Update the frontmatter status to cancelled
5. Commit and push
```

#### `/ralph-priority` - Change Priority
```yaml
---
name: ralph-priority
description: Change the priority of a Ralph task
disable-model-invocation: true
argument-hint: "[task-id] [high|normal|low]"
allowed-tools: Read, Write, Bash(git *)
---

Change a task's priority.

1. Find the task file
2. Update the priority field in frontmatter
3. Commit and push
```

#### `/ralph-pause` / `/ralph-resume` - Control Node
```yaml
---
name: ralph-pause
description: Pause the Ralph node (stop picking up new tasks)
disable-model-invocation: true
allowed-tools: Write, Bash(git *)
---

Write a pause signal file (tasks/signals/pause) and push.
The node checks for this before picking up new tasks.
```

### Design Principles for Skills

1. **All skills start with `git pull`**: Always get the latest state before acting.
2. **All skills end with `git push`**: Changes propagate immediately.
3. **All skills are `disable-model-invocation: true`**: These are user-initiated actions, not things Claude should decide to do on its own.
4. **All skills use only basic tools**: Read, Write, Bash(git), Glob, Grep. No fancy infrastructure needed.
5. **All skills are idempotent where possible**: Running `/ralph-status` twice should be fine. Creating a task with the same content should warn, not duplicate.


## 9. Implementation Priority

### Phase 1 (MVP -- Get the Loop Running)
1. Task file format (Markdown + YAML frontmatter)
2. Directory-based state machine (backlog/ -> active/ -> review/ -> done/)
3. `/ralph-task` skill (create single task)
4. `/ralph-status` skill (check node status)
5. `/ralph-review` skill (approve/reject)
6. `status.json` heartbeat from node
7. Activity log

### Phase 2 (Improve Workflow)
8. `/ralph-backlog` skill (decompose features)
9. `/ralph-list` skill (list with filters)
10. `/ralph-cancel` and `/ralph-priority` skills
11. Cancel signals
12. Dependency tracking (don't pick up task until deps are done)

### Phase 3 (Quality of Life)
13. `/ralph-pause` and `/ralph-resume`
14. ntfy.sh notifications on task completion
15. Local git hooks for macOS notifications
16. Token usage tracking in task metadata
17. Automated retry with backoff for failed tasks


## 10. Open Questions

1. **Branch strategy**: One branch per task? Or one branch per batch? Per-task is cleaner but creates more branches. Recommend per-task with auto-cleanup after merge.

2. **Conflict resolution**: What if the user edits files on main while the node is working on a branch? The node should rebase before pushing, and fail gracefully if conflicts are detected. Failed tasks go back to backlog.

3. **Task size**: How do we prevent tasks that are too large? The decomposition skill should enforce single-responsibility. But we may need a max token budget per task.

4. **Multiple nodes**: The design supports multiple nodes (node_id in status.json, file locking via git), but v1 should focus on a single node.

5. **Secrets management**: Tasks might need API keys or credentials. These should NOT be in git. The node should have a `.env` file that's gitignored, set up during initial VPS configuration.
