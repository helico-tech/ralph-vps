# Distributed Systems & Task Queue Architecture

> Brainstorm by **distributed-arch** -- designing a distributed task queue where git is the only shared state.

---

## 1. Task Definition Format

### Recommendation: Markdown with YAML Frontmatter

This is the clear winner for several reasons:

- **Human-readable**: Users can inspect task files without tooling
- **Git-friendly**: Clean diffs, easy to review in PRs
- **Ecosystem alignment**: GitHub Agentic Workflows, Anthropic's Agent Skills (SKILL.md), and Claude Code all use this pattern already
- **Machine-parseable**: YAML frontmatter gives structured metadata; Markdown body gives freeform instructions

### Proposed Task File Structure

```markdown
---
id: "task-20260303-001"
title: "Add user authentication endpoint"
status: "pending"
priority: 100
created_at: "2026-03-03T10:00:00Z"
updated_at: "2026-03-03T10:00:00Z"
assigned_to: null
depends_on: []
group: "auth-epic"
retry_count: 0
max_retries: 2
tags: ["backend", "auth"]
---

## Description

Add a POST /api/auth/login endpoint that accepts email and password,
validates credentials against the user store, and returns a JWT token.

## Acceptance Criteria

- Endpoint returns 200 with JWT on valid credentials
- Endpoint returns 401 on invalid credentials
- JWT expires after 24 hours
- Rate-limited to 5 attempts per minute per IP

## Context

Related files: `src/api/routes.ts`, `src/auth/jwt.ts`
```

### Field Breakdown

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `id` | string | yes | Unique identifier, also serves as filename |
| `title` | string | yes | Human-readable summary |
| `status` | enum | yes | Current state (see state machine below) |
| `priority` | integer | yes | Lower = higher priority. Default 100. |
| `created_at` | ISO 8601 | yes | Immutable creation timestamp |
| `updated_at` | ISO 8601 | yes | Last state change |
| `assigned_to` | string/null | no | Worker ID that claimed this task |
| `depends_on` | string[] | no | IDs of tasks that must complete first |
| `group` | string/null | no | Epic/milestone grouping |
| `retry_count` | integer | yes | How many times this has been retried |
| `max_retries` | integer | yes | Max retry attempts before permanent failure |
| `tags` | string[] | no | Freeform labels for filtering |

### Why Not JSON?

JSON lacks comments, is harder to read in diffs, and doesn't support the freeform body section well. YAML-only would work but loses the Markdown body for rich task descriptions.

### Why Not Pure YAML?

YAML-only files would be fine for machine processing but lose the benefit of having a rich, Markdown-rendered task description with headers, code blocks, and checklists. The Markdown body is what Claude Code actually reads when executing the task.

### File Naming Convention

```
.tasks/
  pending/
    100-task-20260303-001.md
    200-task-20260303-002.md
  in_progress/
    100-task-20260303-003.md
  done/
    100-task-20260303-000.md
  failed/
    100-task-20260302-099.md
```

**Alternative (simpler):** All tasks in a flat `.tasks/` directory, with status tracked purely in frontmatter. This is simpler but makes "what's pending?" queries require parsing every file.

**Recommended approach:** Use directory-per-status. Moving a file between directories IS the state transition, which makes it visible in git diffs and trivially queryable with `ls`. The filename prefix is the priority for sort-order determinism.

---

## 2. Task States (State Machine)

### Core States

```
                    ┌──────────┐
                    │ pending  │
                    └────┬─────┘
                         │ pickup (worker claims)
                         v
                    ┌──────────────┐
                    │ in_progress  │
                    └──┬───┬───┬──┘
                       │   │   │
            success ───┘   │   └─── failure
                           │
                       needs_review
                           │
                    ┌──────v───────┐
         ┌─────────┤    review    ├──────────┐
         │         └──────────────┘          │
         │ approved                  rejected│
         v                                   v
    ┌─────────┐                      ┌──────────┐
    │  done   │                      │ pending  │
    └─────────┘                      │ (re-open)│
                                     └──────────┘

    On failure with retries remaining:
    failed → pending (retry_count incremented)

    On failure with no retries:
    failed → failed (terminal)
```

### State Definitions

| State | Meaning | Entry Condition |
|-------|---------|-----------------|
| `pending` | Ready to be picked up | Created, or returned from review/retry |
| `in_progress` | A worker is actively executing this | Worker claimed it |
| `review` | Completed but needs human approval | Worker marked it for review |
| `done` | Completed and accepted | Worker completed or reviewer approved |
| `failed` | Execution failed | Worker reported failure, retries exhausted |

### State Transition Rules

1. `pending -> in_progress`: Only a worker can do this. Must set `assigned_to`.
2. `in_progress -> done`: Worker completed successfully, no review needed.
3. `in_progress -> review`: Worker completed but flagged for human review.
4. `in_progress -> failed`: Worker failed. If `retry_count < max_retries`, auto-transition to `pending` with incremented `retry_count`.
5. `in_progress -> pending`: Worker explicitly abandoned (crash recovery).
6. `review -> done`: Human approved.
7. `review -> pending`: Human rejected; task goes back to queue (effectively a new attempt).

### Implementation: Status = Directory

The simplest implementation: task status IS which directory the file lives in. A state transition = `git mv` from one directory to another. This is:

- **Atomic in git**: A single commit with the `git mv` is atomic
- **Visible in git log**: `git log --follow` tracks the file across directories
- **Trivially queryable**: `ls .tasks/pending/` gives you the queue
- **Diff-friendly**: Reviewers see files moving between directories

---

## 3. Deterministic Pickup

### The Problem

When a worker polls for the next task, it must pick the same task every time given the same queue state. If multiple workers poll simultaneously, they must not pick the same task.

### Pickup Algorithm

```
1. List files in .tasks/pending/
2. Filter out tasks where depends_on contains any non-done task
3. Sort by: priority ASC, then created_at ASC, then id ASC
4. Pick the first task in the sorted list
5. Attempt to claim it (see Concurrency section)
```

This is fully deterministic: given the same directory contents, every worker computes the same "next task." The tiebreaker is creation timestamp then ID, which guarantees a stable total order.

### Priority Encoding in Filename

By prefixing filenames with priority (e.g., `100-task-foo.md`), a simple `ls | sort` gives you priority order without parsing YAML. This is a useful optimization but the frontmatter `priority` field remains the source of truth.

### Why Not Random/Round-Robin?

Deterministic pickup means you can predict and test behavior. If you know the queue state, you know exactly which task gets picked next. This is critical for:

- **Testing**: You can write assertions about pickup order
- **Debugging**: When something goes wrong, you can reconstruct the decision
- **Consistency**: Multiple workers agreeing on ordering prevents conflicts

---

## 4. Concurrency

### Single Worker (Recommended Starting Point)

Start with ONE worker. Seriously. The complexity of multi-worker coordination with git as the only shared state is substantial. A single worker with a simple polling loop eliminates entire categories of problems:

- No race conditions on task pickup
- No merge conflicts
- No need for distributed locking
- Trivial to reason about

### Multiple Workers (If Needed Later)

If you eventually need multiple workers, here are the options ranked by complexity:

#### Option A: Branch-Per-Task (Recommended for Multi-Worker)

Each worker creates a branch for the task it picks up:

```
1. Worker polls main branch for next pending task
2. Worker creates branch: task/<task-id>
3. Worker moves task file to in_progress/ on that branch
4. Worker executes task, commits results on that branch
5. Worker moves task file to done/ (or failed/)
6. Worker merges branch back to main (or creates PR)
```

**Claim mechanism**: Creating the branch IS the claim. If two workers race, only one `git push origin task/<task-id>` succeeds (the remote rejects the second push because the ref already exists). The losing worker simply picks the next task.

**Pros**: Natural git workflow, clean history, easy to review
**Cons**: Merge conflicts possible if tasks touch same files

#### Option B: Optimistic Locking via Git Push

```
1. Worker does git pull
2. Worker moves task to in_progress/, commits
3. Worker does git push
4. If push fails (someone else pushed first), git pull --rebase and re-evaluate
5. If task is still pending after rebase, retry claim
6. If task was claimed by someone else, pick next task
```

This is the approach used by [git-queue](https://github.com/Nautilus-Cyberneering/git-queue). It works but can lead to retry storms under high contention.

**Pros**: Simple, no branches needed
**Cons**: Push conflicts under load, potential livelock

#### Option C: External Lock File (Simple but Fragile)

A `.tasks/lock` file containing the worker ID. Workers check the lock before claiming. But this requires a coordination mechanism to manage the lock itself, which brings you back to the same problem.

**Verdict**: Not recommended. You're just building a bad mutex.

### Recommendation

**Phase 1**: Single worker. Don't even think about multi-worker.
**Phase 2**: Branch-per-task if scaling is needed. The "branch creation as atomic claim" pattern is elegant and leverages git's built-in conflict detection.

---

## 5. Atomicity

### The Core Challenge

A task state transition involves:
1. Moving the task file to a new directory (status change)
2. Updating the task's frontmatter (`updated_at`, `assigned_to`, etc.)
3. Possibly creating result artifacts (logs, code changes)

All of these must happen atomically -- either the whole transition succeeds or none of it does.

### Git Gives Us Atomicity (Mostly)

A single git commit IS atomic. If you bundle the file move + frontmatter update + results into one commit, it either all lands or none of it does.

```bash
# Atomic state transition
git mv .tasks/pending/100-task-foo.md .tasks/in_progress/100-task-foo.md
# Update frontmatter in the moved file
sed -i 's/status: "pending"/status: "in_progress"/' .tasks/in_progress/100-task-foo.md
git add .tasks/in_progress/100-task-foo.md
git commit -m "task(task-foo): claimed by worker-1"
```

### The Push Problem

The commit is atomic locally, but `git push` can fail if someone else pushed first. This is where atomicity breaks down:

- **Local state**: Task is in_progress
- **Remote state**: Task is still pending (or claimed by someone else)

**Solution**: Always `git pull --rebase` before acting on state, and treat `git push` failure as "transaction abort -- retry."

### Commit Convention for State Transitions

```
task(<task-id>): <transition description>

Examples:
task(task-20260303-001): claimed by worker-1
task(task-20260303-001): completed successfully
task(task-20260303-001): failed (exit code 1), retry 1/2
task(task-20260303-001): moved to review
task(task-20260303-001): approved by user
```

This makes `git log --oneline --grep="task(task-20260303-001)"` show the full lifecycle of a task.

### Double-Write Prevention

The frontmatter contains `status` AND the file lives in a status directory. This is intentional redundancy:

- The directory is the fast-path query mechanism (ls)
- The frontmatter is the source of truth for the complete task record
- If they disagree, something went wrong and the system should halt

A simple validation script can check consistency:

```bash
for dir in pending in_progress done failed review; do
  for file in .tasks/$dir/*.md; do
    status=$(grep '^status:' "$file" | awk '{print $2}' | tr -d '"')
    if [ "$status" != "$dir" ]; then
      echo "INCONSISTENCY: $file has status=$status but is in $dir/"
    fi
  done
done
```

---

## 6. Failure Handling

### Failure Modes

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Task execution fails (nonzero exit) | Worker detects exit code | Retry or mark failed |
| Worker crashes mid-task | Task stuck in `in_progress` with no heartbeat | Timeout-based recovery |
| Git push fails | Push returns nonzero | Retry with rebase |
| Network failure | Git operations fail | Worker retries connection |
| Claude Code rate limit | API error | Exponential backoff |

### Retry Logic

```yaml
retry_count: 0
max_retries: 2
```

When a task fails:

1. If `retry_count < max_retries`:
   - Increment `retry_count`
   - Move task back to `pending/`
   - Commit: `task(<id>): failed (reason), retry <n>/<max>`
   - The task will be picked up again on next poll cycle
2. If `retry_count >= max_retries`:
   - Move task to `failed/`
   - Commit: `task(<id>): permanently failed after <max> retries`
   - Append failure log to task body

### Crash Recovery (Stale Task Detection)

If a worker crashes, its tasks are stuck in `in_progress` forever. Detection:

**Option A: Timestamp-Based Timeout**

Add a `claimed_at` field to frontmatter. A supervisor process (or the worker itself on startup) checks:

```
if task.status == "in_progress" AND (now - task.claimed_at) > TIMEOUT:
    move task back to pending
    increment retry_count
```

A reasonable timeout for Claude Code tasks: **30 minutes** (configurable per task).

**Option B: Heartbeat File**

The worker periodically updates a `.tasks/heartbeat/<worker-id>` file. If the heartbeat is stale, assume the worker is dead and reclaim its tasks.

**Recommendation**: Option A (timestamp-based). Simpler, no extra files, works with single-worker setup. Heartbeats add complexity and more git commits.

### Failure Artifacts

When a task fails, preserve the context:

```markdown
---
status: "failed"
retry_count: 2
max_retries: 2
failed_at: "2026-03-03T12:30:00Z"
failure_reason: "Test suite failed with 3 errors"
---

## Description
(original task description)

## Failure Log

### Attempt 1 (2026-03-03T11:00:00Z)
Exit code: 1
Error: TypeError in src/auth/jwt.ts line 42

### Attempt 2 (2026-03-03T11:30:00Z)
Exit code: 1
Error: TypeError in src/auth/jwt.ts line 42 (same root cause)

### Attempt 3 (2026-03-03T12:30:00Z)
Exit code: 1
Error: TypeError in src/auth/jwt.ts line 42 (same root cause, giving up)
```

---

## 7. Task Dependencies

### Modeling Dependencies

The `depends_on` field in frontmatter contains an array of task IDs:

```yaml
depends_on: ["task-20260303-001", "task-20260303-002"]
```

A task is **eligible for pickup** only when ALL tasks in its `depends_on` list have status `done`.

### Dependency Resolution Algorithm

```
function isEligible(task):
    for dep_id in task.depends_on:
        dep = findTask(dep_id)
        if dep is null:
            ERROR: dangling dependency
        if dep.status != "done":
            return false
    return true
```

### Cycle Detection

Before adding a dependency, verify no cycles exist. A simple DFS from the target task back through `depends_on` chains:

```
function hasCycle(task, newDep):
    visited = set()
    stack = [newDep]
    while stack:
        current = stack.pop()
        if current.id == task.id:
            return true  // CYCLE!
        if current.id in visited:
            continue
        visited.add(current.id)
        for dep in current.depends_on:
            stack.push(findTask(dep))
    return false
```

**Enforcement**: Run cycle detection as a validation step before committing any dependency change. This can be a pre-commit hook or part of the task creation tooling.

### Dependency Visualization

A simple script can generate a dependency graph:

```bash
# Output DOT format for graphviz
echo "digraph tasks {"
for file in .tasks/*/*.md; do
  id=$(grep '^id:' "$file" | awk '{print $2}' | tr -d '"')
  deps=$(grep '^depends_on:' "$file")
  # parse deps array and output edges
done
echo "}"
```

### Keep It Simple

For Phase 1, **linear dependencies only** (task B depends on task A). Don't build a full DAG scheduler. The complexity is not worth it until you have proven the basic loop works.

---

## 8. Task Grouping

### Approach: Flat Groups via Tags

Rather than building a hierarchy (epics contain stories contain tasks), use a flat grouping model:

```yaml
group: "auth-epic"
tags: ["backend", "auth", "sprint-1"]
```

The `group` field is a single string that logically groups tasks. Tags provide additional cross-cutting categorization.

### Querying Groups

```bash
# All tasks in the auth epic
grep -rl 'group: "auth-epic"' .tasks/

# All pending tasks in the auth epic
grep -rl 'group: "auth-epic"' .tasks/pending/

# Progress report
echo "Auth Epic Progress:"
echo "  Pending: $(ls .tasks/pending/ | xargs grep -l 'group: "auth-epic"' 2>/dev/null | wc -l)"
echo "  In Progress: $(ls .tasks/in_progress/ | xargs grep -l 'group: "auth-epic"' 2>/dev/null | wc -l)"
echo "  Done: $(ls .tasks/done/ | xargs grep -l 'group: "auth-epic"' 2>/dev/null | wc -l)"
```

### Why Not Nested Directories?

You might think `tasks/auth-epic/pending/task-001.md` makes sense. It doesn't:

- Task status changes require moving files across TWO directory levels
- A task can only belong to one group (directory)
- Git history gets messier with deeper paths
- Querying "all pending" now requires scanning all group directories

Flat directories with metadata-based grouping is simpler and more flexible.

### Group Metadata File (Optional)

```markdown
---
id: "auth-epic"
title: "User Authentication"
description: "Implement complete auth flow"
created_at: "2026-03-03T10:00:00Z"
---

## Auth Epic

Implement user authentication including login, registration,
password reset, and JWT token management.
```

Stored in `.tasks/groups/auth-epic.md`. This is optional -- groups can exist implicitly through the `group` field on tasks.

---

## 9. Feedback Loop (Review Task Auto-Creation)

### When Are Review Tasks Created?

A worker can mark a task for review in two scenarios:

1. **Explicit review flag**: The task definition says `needs_review: true`
2. **Worker-initiated**: The worker decides the output needs human eyes (e.g., it made significant changes, or it's uncertain about the result)

### Review Workflow

```
1. Worker completes task, moves to .tasks/review/
2. Worker updates frontmatter:
   - status: "review"
   - review_notes: "Changed 5 files, added new API endpoint"
   - review_branch: "task/task-20260303-001"  (if using branch-per-task)
3. Worker commits and pushes
4. User sees task in review/ directory (via polling, status command, or notification)
5. User reviews the changes (on the branch, or in the task file)
6. User either:
   a. Approves: moves to done/, commits "task(<id>): approved by user"
   b. Rejects with feedback: moves back to pending/, adds rejection notes
```

### Auto-Generated Follow-Up Tasks

When a task completes (or fails), the system can auto-generate follow-up tasks:

#### Pattern 1: Review Task

```yaml
---
id: "review-task-20260303-001"
title: "Review: Add user authentication endpoint"
status: "pending"
priority: 50  # Reviews get higher priority (lower number)
depends_on: []
group: "auth-epic"
tags: ["review"]
review_of: "task-20260303-001"
---

## Review Required

Task `task-20260303-001` has been completed and needs review.

### Changes Made
- Added POST /api/auth/login endpoint
- Created src/auth/jwt.ts
- Updated src/api/routes.ts

### Review Branch
`task/task-20260303-001`

### What to Check
- [ ] JWT token expiry is set correctly
- [ ] Rate limiting is implemented
- [ ] Error responses follow API conventions
```

#### Pattern 2: Failure Investigation Task

When a task fails permanently, auto-create an investigation task:

```yaml
---
id: "investigate-task-20260303-001"
title: "Investigate failure: Add user authentication endpoint"
status: "pending"
priority: 30  # Investigation gets high priority
tags: ["investigation", "failure"]
related_to: "task-20260303-001"
---

## Investigation Required

Task `task-20260303-001` failed after 2 retries.

### Failure Summary
TypeError in src/auth/jwt.ts line 42 (all attempts)

### Suggested Actions
- Review the error and determine root cause
- Fix the underlying issue
- Re-create the original task once fixed
```

#### Pattern 3: Chained Tasks

A task can define `on_complete` actions in its frontmatter:

```yaml
on_complete:
  create_tasks:
    - template: "integration-test"
      title: "Integration test: {{parent.title}}"
      depends_on: ["{{parent.id}}"]
```

**Recommendation for Phase 1**: Keep this dead simple. The worker script checks if a completed task has `needs_review: true` and if so, moves it to `review/` instead of `done/`. Auto-creation of follow-up tasks can come later.

---

## 10. Summary: The Simplest Viable Design

### Directory Structure

```
.tasks/
  pending/       # Tasks waiting to be picked up
  in_progress/   # Tasks currently being executed
  review/        # Tasks awaiting human review
  done/          # Completed tasks
  failed/        # Permanently failed tasks
  groups/        # Optional group metadata
```

### Worker Loop (Pseudocode)

```bash
while true; do
    git pull origin main

    # Find next eligible task
    task=$(ls .tasks/pending/ | sort | head -1)

    if [ -z "$task" ]; then
        sleep 30
        continue
    fi

    # Check dependencies
    if ! dependencies_met "$task"; then
        # Try next task, or sleep
        continue
    fi

    # Claim task
    git mv ".tasks/pending/$task" ".tasks/in_progress/$task"
    update_frontmatter "$task" status=in_progress assigned_to=worker-1
    git add -A && git commit -m "task($id): claimed by worker-1"
    git push origin main || { handle_conflict; continue; }

    # Execute task
    result=$(claude -p "Execute this task: $(cat .tasks/in_progress/$task)")

    # Handle result
    if [ $? -eq 0 ]; then
        if needs_review "$task"; then
            git mv ".tasks/in_progress/$task" ".tasks/review/$task"
            git commit -m "task($id): completed, moved to review"
        else
            git mv ".tasks/in_progress/$task" ".tasks/done/$task"
            git commit -m "task($id): completed successfully"
        fi
    else
        handle_failure "$task"
    fi

    git push origin main
done
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Format | Markdown + YAML frontmatter | Human-readable, git-friendly, ecosystem-aligned |
| Status tracking | Directory-per-status | Visible in git, trivially queryable, atomic via git mv |
| Pickup order | Priority ASC, created_at ASC, id ASC | Deterministic, testable, predictable |
| Concurrency | Single worker (Phase 1) | Eliminates entire categories of complexity |
| Atomicity | Single commit per transition | Git commits are atomic |
| Failure handling | Retry with count, timeout-based crash recovery | Simple, no external dependencies |
| Dependencies | depends_on array in frontmatter | Linear deps only for Phase 1 |
| Grouping | Flat group field + tags | No nested directories, metadata-based |
| Feedback | needs_review flag, review/ directory | Simple, human-driven approval |

### What This Design Intentionally Avoids

- **No distributed locking** (single worker)
- **No external databases** (git is the database)
- **No message brokers** (polling + directory listing)
- **No complex DAG scheduling** (linear dependencies only)
- **No real-time notifications** (polling-based)
- **No elaborate retry strategies** (simple count-based retry)

These can all be added later if needed. The goal is a working system you can build, test, and iterate on.

---

## References

- [Git Queue (GitHub Action)](https://github.com/Nautilus-Cyberneering/git-queue) -- Job queue using git empty commits with optimistic locking
- [GitMQ](https://github.com/emad-elsaid/gitmq) -- Git-based message queue using commits as messages
- [Continuous-Claude](https://github.com/AnandChowdhary/continuous-claude) -- Ralph loop with PRs for autonomous Claude Code execution
- [Claude Code Headless Mode](https://code.claude.com/docs/en/how-claude-code-works) -- Foundation for programmatic Claude Code integration
- [Anthropic Agent Skills Standard](https://agentskills.io/specification) -- YAML frontmatter + Markdown for agent task definitions
- [Temporal](https://temporal.io/blog/temporal-replaces-state-machines-for-distributed-applications) -- State machine patterns for distributed applications
- [Distributed Task Queue Patterns](https://www.geeksforgeeks.org/system-design/distributed-task-queue-distributed-systems/) -- General DTQ architecture
