# Git Workflow & Synchronization Strategy

## Context

We need git to serve as the communication layer between a user's laptop and a remote VPS running autonomous Claude Code "Ralph loops." Git was not designed as a message queue or state machine -- this document explores how to make it work anyway, where the sharp edges are, and what the simplest viable design looks like.

---

## 1. Repository Structure

### Option A: Single Repo (Project + Tasks)

Task definitions, status files, and agent output all live alongside the project code.

```
project-root/
  .ralph/
    tasks/
      001-fix-auth-bug.md        # task definition
      002-add-logging.md
    status/
      001-fix-auth-bug.json      # status: pending|running|done|failed
      002-add-logging.json
    logs/
      001-fix-auth-bug.log       # agent stdout/stderr
  src/
    ...project code...
```

**Pros:**
- Simplest setup. One repo, one remote, one clone.
- Task context is right next to the code -- the agent can reference files naturally.
- User can see everything with `git log` in one place.

**Cons:**
- Agent commits (code changes + status updates) are interleaved with task management commits.
- If the project is large, cloning/pulling on the VPS is heavier.
- Risk of the `.ralph/` directory becoming a dumping ground.

### Option B: Separate Orchestration Repo

A dedicated repo just for task definitions, status, and logs. The project repo is separate.

**Pros:**
- Clean separation of concerns.
- Orchestration repo stays tiny and fast to clone/pull.

**Cons:**
- Now you have two repos to keep in sync. The agent needs to clone both.
- Cross-referencing between task definitions and code is indirect.
- More moving parts for a user who isn't very knowledgeable about Linux.

### Recommendation: Single Repo (Option A)

The complexity of managing two repos is not justified at this stage. A `.ralph/` directory in the project root is simple, discoverable, and keeps everything in one place. If it gets unwieldy later, extracting to a separate repo is straightforward -- but we shouldn't pay that cost now.

---

## 2. Branching Strategy

This is where things get interesting. There are three credible approaches:

### Option A: Task Branches (one branch per task)

```
main
  \-- ralph/001-fix-auth-bug
  \-- ralph/002-add-logging
```

The node creates a branch for each task, does its work there, and either merges it back or creates a PR-like artifact.

**Pros:**
- Isolation: a failed task doesn't pollute main.
- Natural "PR" workflow: user can review the branch diff before merging.
- Familiar mental model for developers.

**Cons:**
- Merge conflicts when tasks touch overlapping files.
- Branch proliferation -- needs cleanup discipline.
- The node needs to rebase/merge against main before starting each task (or risk working on stale code).
- Complexity in the orchestrator: branch creation, checkout, push, merge.

### Option B: Linear Commits on a Dedicated Branch

```
main (user's code)
ralph/work (agent's linear commit stream)
```

The agent works on a single `ralph/work` branch. Each task is a sequence of commits. Task boundaries are marked by commit conventions (see section 5).

**Pros:**
- No branch management complexity.
- Simple: pull, work, commit, push.
- Easy to introspect: `git log ralph/work` shows the full timeline.

**Cons:**
- No isolation between tasks -- a broken task can leave the branch in a bad state.
- Merging back to main is a manual step (but that might be a feature, not a bug -- it forces review).

### Option C: Direct Commits to Main

The agent commits directly to main.

**Pros:**
- Maximum simplicity.

**Cons:**
- Dangerous. No review gate. A bad agent run can break main.
- Merge conflicts with user's local changes are almost guaranteed.
- No undo without `git revert` or `git reset`.

### Recommendation: Task Branches (Option A), with simplifications

Task branches give us the isolation we need without being overly complex. The key simplifications:

1. **Branch naming convention:** `ralph/<task-id>-<slug>` (e.g., `ralph/001-fix-auth-bug`)
2. **Always branch from main's HEAD:** The node does `git fetch origin && git checkout -b ralph/001-fix-auth-bug origin/main` before starting each task.
3. **No auto-merge:** The node never merges back to main. It pushes the branch and updates the task status to `done`. The user reviews and merges (manually or via a simple script).
4. **Cleanup:** Branches are deleted after merge. A periodic cleanup script removes stale branches.

This gives us isolation, introspection (each branch is a self-contained diff), and a review gate, while keeping the orchestrator logic simple.

**Important caveat:** If tasks are sequential and depend on each other, the second task should branch from the first task's branch (not main). The orchestrator needs to handle this -- but we should defer that complexity until we actually need dependent tasks.

---

## 3. Sync Protocol: How Does the Node Know About New Tasks?

### Option A: Polling (git pull on interval)

The node runs a loop:
```bash
while true; do
  git fetch origin
  # check .ralph/tasks/ for new pending tasks
  # if found, pick one up and execute
  sleep 30
done
```

**Pros:**
- Dead simple. No infrastructure beyond git.
- Works with any git host (GitHub, GitLab, self-hosted).
- Easy to test: just commit a task file and wait.

**Cons:**
- Latency: up to N seconds before a task is picked up.
- Wasteful: most polls find nothing.
- 30-second delay isn't terrible, but it's noticeable.

### Option B: Webhook (GitHub push event triggers the node)

GitHub sends a POST to the VPS when a push happens. The VPS has a tiny HTTP server listening.

**Pros:**
- Instant task pickup.
- No wasted polling.

**Cons:**
- Requires the VPS to be reachable from the internet (or use a tunnel like ngrok/Cloudflare Tunnel).
- More infrastructure: an HTTP server, webhook configuration, security (validating signatures).
- Fragile: if the webhook fails, the task is lost unless there's a fallback.

### Option C: Hybrid (Poll + Webhook)

Poll on a slow interval (e.g., 60s) as a safety net, but also accept webhooks for instant pickup.

**Pros:**
- Best of both worlds.

**Cons:**
- Most complex to set up.

### Recommendation: Polling (Option A)

For a system that needs to be buildable step-by-step by someone not deeply familiar with Linux, polling is the right starting point. The latency of 15-30 seconds is acceptable for autonomous task execution (these aren't real-time interactions). Webhooks can be layered on later as an optimization.

The polling loop should be smart about it:
- Use `git fetch --dry-run` (or check `git rev-parse origin/main` before/after fetch) to detect actual changes.
- Only scan for tasks when something actually changed.
- Exponential backoff when idle (poll every 15s when active, every 60s when idle for 5+ minutes).

---

## 4. Conflict Avoidance

This is the critical challenge. Git merge conflicts will derail the entire system if they occur frequently. The strategy must be **conflict avoidance by design**, not conflict resolution after the fact.

### Rule 1: Ownership Boundaries

The user and the agent must never edit the same files at the same time.

- **User owns:** Task definitions (`.ralph/tasks/*.md`). The user creates and edits these.
- **Agent owns:** Task status (`.ralph/status/*.json`), logs (`.ralph/logs/*`), and code on task branches.
- **Neither modifies the other's files.** The user doesn't edit status files; the agent doesn't edit task definitions after picking them up.

### Rule 2: Task Branches Eliminate Code Conflicts

Since the agent works on task branches (not main), its code changes never directly conflict with the user's commits to main. Conflicts only surface at merge time, and at that point the user resolves them manually -- which is the correct time to handle them.

### Rule 3: Append-Only Patterns for Shared State

For any file that both sides might touch (e.g., a task queue file), use append-only semantics:
- New tasks are new files, not edits to an existing queue file.
- Status updates are separate files per task, not rows in a shared table.

This eliminates the "two people edit the same line" class of conflicts entirely.

### Rule 4: The Agent Never Force-Pushes

The agent should always `git pull --rebase` (or `git fetch` + check) before pushing. If the push fails due to a conflict, the agent should:
1. Log the error.
2. Mark the task as `failed` (locally).
3. Move on to the next task.
4. The user can investigate and retry.

Never `git push --force`. Ever.

### Rule 5: File-Per-Task, Not Shared Queue File

Instead of a single `queue.json`:
```
.ralph/tasks/001-fix-auth-bug.md    # one file per task
.ralph/tasks/002-add-logging.md
```

This means creating task A and creating task B are conflict-free operations even if they happen simultaneously.

### Remaining Sharp Edge: Status File Race Condition

If the user creates a new task while the agent is pushing a status update, the push will still succeed because they're modifying different files. Git handles this cleanly as long as the files don't overlap.

The one dangerous scenario: the user manually edits a status file while the agent is also updating it. This is prevented by Rule 1 (ownership boundaries). Discipline here is essential.

---

## 5. Commit Convention

Good commit messages make `git log` a useful introspection tool. The convention should be machine-parseable but also human-readable.

### Format

```
ralph(<task-id>): <action> - <description>

<optional body with details>
```

### Actions

| Action      | Meaning                                    |
|-------------|--------------------------------------------|
| `pickup`    | Agent started working on this task         |
| `progress`  | Intermediate checkpoint                    |
| `complete`  | Task finished successfully                 |
| `fail`      | Task failed                                |
| `status`    | Status file update only (no code changes)  |

### Examples

```
ralph(001): pickup - Fix authentication bug in login flow
ralph(001): progress - Identified root cause in auth middleware
ralph(001): complete - Fixed auth bug, added regression test

Task: 001-fix-auth-bug
Duration: 4m32s
Files changed: src/auth/middleware.ts, tests/auth.test.ts
```

### Why This Matters

With this convention, the user can:
```bash
# See all agent activity
git log --oneline --grep="ralph("

# See activity for a specific task
git log --oneline --grep="ralph(001)"

# See only completions
git log --oneline --grep="ralph.*complete"
```

This turns `git log` into a lightweight dashboard -- no extra tooling needed.

---

## 6. Push Strategy

### Option A: Push After Each Commit

Every commit is immediately pushed.

**Pros:**
- Maximum visibility. The user sees progress in real-time.
- If the agent crashes, minimal work is lost.

**Cons:**
- Lots of pushes. Noisy git history on the remote.
- More chances for push failures (network issues, conflicts).
- GitHub rate limits could theoretically bite (unlikely in practice).

### Option B: Push After Each Task

The agent batches all commits for a task and pushes once when done.

**Pros:**
- Clean: one push per task.
- Fewer network operations.

**Cons:**
- If the agent crashes mid-task, all progress is lost (from the remote's perspective).
- User can't see intermediate progress.

### Option C: Push at Key Milestones

Push at: task pickup, significant progress checkpoints, and task completion.

**Pros:**
- Balanced: user sees progress without excessive noise.
- Crash recovery: at most one segment of work is lost.

**Cons:**
- Requires the agent to know what "significant progress" means (can be approximated by time-based or step-based thresholds).

### Recommendation: Push at Key Milestones (Option C)

The push strategy should be:
1. **Push on pickup** (so the user knows the task was claimed).
2. **Push every N minutes** while working (e.g., every 2-3 minutes, configurable).
3. **Push on completion or failure** (final state).

This gives good visibility without being noisy. The time-based push is a safety net against crashes.

For the status files specifically (`.ralph/status/*.json`), push immediately on every status change. These are tiny files and the user relies on them for introspection.

---

## 7. Git as State Store: Pros, Cons, and Sharp Edges

### Pros

- **No additional infrastructure.** No database, no message queue, no Redis. Just git.
- **Full audit trail.** Every state change is a commit. You get history for free.
- **Offline-capable.** The user can queue tasks while disconnected, push when online.
- **Familiar tooling.** `git log`, `git diff`, `git show` -- the user already knows these.
- **Durable.** Git repos are backed up on the remote. Hard to lose data.

### Cons and Sharp Edges

- **Not designed for concurrency.** Git assumes one writer at a time on a branch. Multiple agents writing to the same branch will collide.
- **No atomic read-modify-write.** There's no `SELECT ... FOR UPDATE` equivalent. Two agents can both read a task as "pending" and both pick it up. (Solved by having exactly one agent per branch, or per task directory.)
- **Latency.** `git push` and `git pull` are not instant. Network latency + SSH handshake + pack negotiation = seconds, not milliseconds.
- **Large files.** Git is bad at large binary files. Agent logs should be kept small or rotated.
- **No notifications.** Git doesn't push events to clients. You have to poll or use external webhooks.
- **Garbage accumulation.** Without discipline, the repo fills with status files, logs, and stale branches. Needs periodic cleanup.
- **Authentication management.** The VPS needs git credentials (SSH key or token). This is a security consideration.
- **Rate limits.** GitHub has API and push rate limits. Unlikely to hit them with one agent, but worth knowing.

### The Biggest Sharp Edge: Lack of Locking

In a traditional task queue, claiming a task is atomic: `UPDATE tasks SET status='running' WHERE status='pending' LIMIT 1`. In git, the equivalent is:
1. Read the task file (status: pending).
2. Write the task file (status: running).
3. Commit.
4. Push.

Between steps 1 and 4, another process could do the same thing. There's no lock.

**Mitigation for our case:** We're running exactly one agent on one VPS. There's no concurrent worker problem. If we scale to multiple agents later, we need either:
- A file-per-agent claim mechanism (agent writes `.ralph/claims/001-agent-1.lock`).
- An external coordinator (defeats the purpose of git-only).
- Careful partitioning (agent-1 handles tasks 001-099, agent-2 handles 100-199 -- gross).

For now, single agent = no locking problem. Keep it simple.

---

## 8. Alternative: Lightweight JSON Sidecar

Instead of complex branching and status files, what if the entire task queue was a single JSON file synced via git?

### Design

```json
// .ralph/queue.json
{
  "tasks": [
    {
      "id": "001",
      "title": "Fix auth bug",
      "status": "pending",
      "created": "2026-03-01T10:00:00Z",
      "branch": null,
      "result": null
    },
    {
      "id": "002",
      "title": "Add logging",
      "status": "running",
      "created": "2026-03-01T11:00:00Z",
      "branch": "ralph/002-add-logging",
      "result": null
    }
  ]
}
```

### Why It's Tempting

- One file to rule them all. Simple to parse, simple to display.
- Easy to build a CLI tool around (`jq` works great).

### Why It's a Bad Idea

- **Guaranteed merge conflicts.** Every task creation and every status update modifies the same file. The user adding task 003 while the agent updates task 002's status = conflict.
- **No append-only semantics.** JSON doesn't support concurrent appends the way separate files do.
- **Atomic updates are impossible.** Changing one field requires rewriting the entire file.

### Hybrid Alternative: JSON Per Task

```
.ralph/tasks/001.json    # { "title": "Fix auth bug", "status": "pending", ... }
.ralph/tasks/002.json    # { "title": "Add logging", "status": "running", ... }
```

This preserves the simplicity of JSON while avoiding the shared-file conflict problem. Each task is its own file. The agent only writes to the task it's working on. The user only writes when creating new tasks.

### Recommendation: JSON Per Task with Markdown Descriptions

```
.ralph/tasks/
  001.json               # metadata: status, timestamps, branch, result summary
  001.md                  # human-written task description (what to do)
  002.json
  002.md
```

Separation of concerns: `.json` is machine-readable state, `.md` is the human-written task prompt. The agent reads the `.md`, updates the `.json`. No conflicts.

---

## 9. Monorepo vs Separate Repo

### Monorepo (Task Definitions in Project Repo)

```
my-project/
  .ralph/
    tasks/
    status/
    config.json
  src/
  package.json
```

**Pros:**
- One repo. Simple mental model.
- Task context is naturally co-located with code.
- `git log` shows everything.
- Agent can reference project files in task descriptions without cross-repo hassle.

**Cons:**
- Agent's infrastructure files (`.ralph/`) pollute the project's git history.
- If you want to use Ralph on multiple projects, you need `.ralph/` in each one.

### Separate Orchestration Repo

```
my-project/          # project code only
ralph-orchestrator/  # .ralph/ directory contents
```

**Pros:**
- Clean project history.
- One orchestrator for multiple projects (theoretically).

**Cons:**
- Two repos to manage. Two clones on the VPS. Two push/pull cycles.
- Agent needs to map task IDs to project repos.
- Cross-referencing is painful.
- Significantly more complex for a user who's not a Linux power user.

### Recommendation: Monorepo (Single Repo)

The extra complexity of a separate repo buys us almost nothing at this scale. A `.ralph/` directory is tidy, `.gitignore`-able for parts we don't want tracked (like large logs), and keeps the user's workflow simple: one repo, one remote, everything in one place.

If the `.ralph/` commits in `git log` become annoying, a simple alias solves it:
```bash
alias glog='git log --oneline -- ":!.ralph"'
```

---

## 10. Complete Proposed Workflow

Putting it all together, here's the end-to-end workflow:

### User Creates a Task (Laptop)

```bash
# User writes a task description
cat > .ralph/tasks/003.md << 'EOF'
# Refactor database connection pooling

The current DB connection code creates a new connection per request.
Implement connection pooling using the built-in pool from pg library.

Files to look at: src/db/connection.ts
EOF

# User creates the task metadata
cat > .ralph/tasks/003.json << 'EOF'
{
  "id": "003",
  "status": "pending",
  "created": "2026-03-03T10:00:00Z",
  "priority": "normal"
}
EOF

# Push to remote
git add .ralph/tasks/003.*
git commit -m "task(003): create - Refactor database connection pooling"
git push origin main
```

### Node Picks Up the Task (VPS)

```bash
# Poll loop detects new commit on main
git fetch origin
git diff --name-only HEAD origin/main | grep ".ralph/tasks/"

# Found new task! Update local
git pull origin main

# Read pending tasks
for f in .ralph/tasks/*.json; do
  status=$(jq -r .status "$f")
  if [ "$status" = "pending" ]; then
    TASK_ID=$(basename "$f" .json)
    break
  fi
done

# Claim the task
jq '.status = "running" | .started = now' .ralph/tasks/${TASK_ID}.json > tmp && mv tmp .ralph/tasks/${TASK_ID}.json
git add .ralph/tasks/${TASK_ID}.json
git commit -m "ralph(${TASK_ID}): pickup - Claimed task"
git push origin main

# Create task branch
git checkout -b ralph/${TASK_ID} origin/main

# Execute the agent (Claude Code)
claude --task "$(cat .ralph/tasks/${TASK_ID}.md)" --branch ralph/${TASK_ID}

# Push the task branch
git push origin ralph/${TASK_ID}

# Update status on main
git checkout main
jq '.status = "done" | .completed = now' .ralph/tasks/${TASK_ID}.json > tmp && mv tmp .ralph/tasks/${TASK_ID}.json
git add .ralph/tasks/${TASK_ID}.json
git commit -m "ralph(${TASK_ID}): complete - Task finished"
git push origin main
```

### User Reviews (Laptop)

```bash
# See what happened
git fetch origin
git log --oneline --grep="ralph("

# Review the task branch
git diff main...origin/ralph/003

# Happy? Merge it
git merge origin/ralph/003
git push origin main

# Or reject it
jq '.status = "rejected"' .ralph/tasks/003.json > tmp && mv tmp .ralph/tasks/003.json
git commit -am "task(003): reject - Needs different approach"
git push origin main
```

---

## 11. Sharp Edges Summary & Mitigations

| Sharp Edge | Impact | Mitigation |
|---|---|---|
| No locking / atomic claims | Double-pickup | Single agent only (for now) |
| Push conflicts | Agent push fails | Agent retries with rebase; marks task failed after 3 retries |
| Large repo size over time | Slow clones | `.gitignore` large logs; periodic `git gc`; keep `.ralph/` lean |
| Stale branches | Clutter | Cleanup script: delete merged branches older than 7 days |
| Credential management | Security | SSH key per VPS, scoped to repo; rotate regularly |
| Network dependency | Agent blocks on push/pull | Local-first: agent works locally, pushes when network available |
| No real-time notifications | Latency in task pickup | Acceptable at 15-30s poll; webhook upgrade path exists |
| Git history noise | Hard to read project log | Commit conventions + `git log -- ":!.ralph"` alias |

---

## 12. Design Principles

1. **File-per-entity, not shared files.** Every task is its own file. Every status is its own file. This eliminates merge conflicts by design.
2. **Ownership boundaries are sacred.** User writes task definitions. Agent writes status and code. Never cross the boundary.
3. **Append-only where possible.** New tasks are new files. Status changes are new commits. Never delete, only transition state.
4. **Agent never touches main directly.** Code changes go on task branches. Only status updates go to main, and they touch files the user doesn't edit.
5. **Everything is inspectable with standard git tools.** No proprietary formats, no databases, no hidden state. `git log`, `git diff`, `git show` tell the whole story.
6. **Start with polling, upgrade later.** The simplest sync mechanism that works. Webhooks and real-time notifications are optimizations, not requirements.

---

## 13. Open Questions for Other Specialists

- **For distributed-arch:** How should we handle task dependencies? If task 002 depends on task 001's output, the branch strategy needs to account for chaining.
- **For infra-ops:** Git credential management on the VPS -- SSH key provisioning, key rotation, and scoping permissions.
- **For dx-client:** What CLI commands should the user have? `ralph create`, `ralph status`, `ralph merge`? These would wrap the git operations described above.
- **For testing:** How do we test the polling loop and push/pull cycle in CI? We need a mock git remote.
- **For prompting:** The agent needs clear instructions about commit conventions and branch workflow. How do we inject these into the Claude Code prompt?
