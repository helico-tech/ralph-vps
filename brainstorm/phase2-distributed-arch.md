# Phase 2: Distributed Systems Cross-Review & Architecture Proposal

> By **distributed-arch** | 2026-03-03
>
> Reviewing: infra-ops, git-workflow, dx-client, prompt-engineer, test-architect

---

## Part 1: Critique of Each Agent's Proposal

### 1. infra-ops.md -- Infrastructure & Docker

**What's sound:**
- Hetzner CX22 recommendation is correct. Price/performance is unbeatable.
- Docker restart policy + bash loop is the right level of simplicity.
- Non-root user inside the container is correct.
- "All state lives in git, container is disposable" is the right principle.

**Where the consistency holes are:**

**Problem 1: The loop script has no crash recovery for in-progress tasks.**

The `ralph-loop.sh` (line ~274) does `git pull`, claims task, executes, pushes. If the container crashes between claiming a task and pushing results, the task is stuck in `in_progress` on the remote. The docker restart policy will restart the container, but the loop script starts from scratch -- it does `git pull` and looks for pending tasks. The in_progress task is orphaned forever.

The script needs a startup recovery step: "On boot, check if any tasks are `in_progress` with `assigned_to` matching this worker. If so, either resume or release them." infra-ops mentions this in the crash recovery table ("Container restart: `restart: unless-stopped` restarts it") but never addresses what happens to the task state.

**Problem 2: `git add -A` is dangerous.**

Line 298: `git add -A && git commit -m "ralph: completed task"`. This stages EVERYTHING in the working directory. If Claude Code created temporary files, debug artifacts, or `.env` files, they all get committed. This should be `git add <specific files>` or at minimum have a `.gitignore` that's airtight.

**Problem 3: No sequencing between git pull and task claim.**

The loop does `git pull --rebase`, then finds a task, then executes it. But between the pull and the claim, the remote could have changed (another user pushed, or the task was cancelled). The claim commit is made locally and then pushed. If the push fails, the script doesn't handle it -- it just falls through. The `|| { handle_conflict; continue; }` after the push is never defined.

**Problem 4: `--dangerously-skip-permissions` is hand-waved.**

infra-ops correctly identifies this flag is needed but says "should ONLY be used inside a sandboxed container with restricted network access" and then proposes a container with full outbound HTTPS access. That's not sandboxed. The container can `curl` arbitrary endpoints, exfiltrate data, install packages. The network restrictions proposed (iptables on the host) are described as "Option A for v1" but no concrete implementation is given. This is a real security gap.

**Rating: 7/10** -- Solid infrastructure thinking, but glosses over state consistency and security implementation.

---

### 2. git-workflow.md -- Git Workflow & Synchronization

**What's sound:**
- Single repo recommendation is correct.
- Task branches (Option A) is the right choice.
- The ownership boundary rules (Section 4) are excellent -- user writes tasks, agent writes status/code.
- Append-only patterns for shared state is exactly right.
- Commit convention with `ralph(<task-id>): <action>` is good and grep-able.
- "Agent never force-pushes" -- correct and non-negotiable.

**Where the consistency holes are:**

**Problem 1: The two-file-per-task design (.json + .md) is a split-brain risk.**

Section 8 proposes `001.json` (machine state) + `001.md` (human description). This creates TWO sources of truth for one entity. What happens when:
- The `.json` says `status: running` but someone manually edited the `.md` and added `status: done` in frontmatter?
- The `.json` is committed but the `.md` commit failed?
- A merge conflict corrupts the `.json` but not the `.md`?

One file per task with YAML frontmatter + Markdown body eliminates this class of bugs entirely. The git-workflow agent actually acknowledges this as a "Hybrid Alternative" but then goes with the two-file approach anyway. Wrong call.

**Problem 2: Claiming on main, working on branch creates a race.**

The workflow (Section 10, line ~551) does:
1. Claim task by updating `.json` on main, push to main
2. Create task branch from main
3. Work on branch
4. Push branch
5. Update status on main, push to main

Step 1 and step 5 both push to main. If the user pushes a new task between steps 1 and 5, step 5's push can fail. More critically, between step 1 and step 5, the agent checks out the branch and back. If the `git checkout main` at step 5 encounters new files from the user's push, you have a merge situation on main that the script doesn't handle.

**Problem 3: `jq` pipes to `tmp && mv tmp` is not atomic.**

Lines 551-552: `jq '.status = "running"' .ralph/tasks/${TASK_ID}.json > tmp && mv tmp .ralph/tasks/${TASK_ID}.json`. If the process is killed between the `> tmp` write and the `mv`, you have a `tmp` file and an unchanged original. This isn't a big deal on a single machine, but it's sloppy. Use `sponge`, `mktemp`, or write to a temp file in the same directory and `mv` (which IS atomic on POSIX when same filesystem).

**Problem 4: Polling with `git fetch --dry-run` doesn't actually work that way.**

Section 3 suggests "Use `git fetch --dry-run` to detect actual changes." `git fetch --dry-run` doesn't update refs and its output format isn't reliable for scripting. The correct approach is to compare `git rev-parse origin/main` before and after `git fetch`.

**Rating: 8/10** -- Best overall understanding of git's limitations. Ownership boundaries are the most important insight across all documents. The two-file split is the main mistake.

---

### 3. dx-client.md -- Developer Experience & Client Tooling

**What's sound:**
- Claude Code skills as the interface layer is elegant and avoids building a separate CLI.
- The ideal user workflow (Section 7) is the best visualization of the end-to-end flow across all documents.
- `status.json` heartbeat updated by the node is simple and effective.
- The phased implementation (Section 9) is realistic.
- "Not in v1" for the web dashboard is correct.
- ntfy.sh for notifications is a great pragmatic choice.

**Where the consistency holes are:**

**Problem 1: Skills doing `git pull` + `git push` create race conditions with the node.**

Every skill starts with `git pull` and ends with `git push`. Meanwhile, the node is ALSO doing `git pull` and `git push`. If the user runs `/ralph-cancel` while the node is mid-push, you get a push conflict. The user's push succeeds (they pushed first), but now the node's push fails because the remote has moved forward.

This is mitigated by the ownership boundaries from git-workflow, but only if they're perfectly enforced. The cancel signal design (writing to `tasks/signals/cancel-<task-id>`) is actually smart because it's a NEW file, not a modification -- so no conflict. But `/ralph-priority` modifies an existing task file, which CAN conflict if the node is also modifying it.

**Mitigation needed:** Skills that modify task metadata should only modify files in `backlog/`. If a task is `active`, the user should not be able to modify its metadata directly -- only signal to it (cancel, pause).

**Problem 2: `status.json` as a single shared file is a conflict magnet.**

The node writes `status.json` every few minutes. If the user happens to `git push` at the same time, and the user's commit touches any file, the node's next push will fail because the remote HEAD moved. The node didn't change `status.json` in a conflicting way, but git doesn't do file-level conflict detection on push -- it's branch-level.

Actually wait -- this is fine. The node does `git pull --rebase` before pushing, and since the user never touches `status.json`, the rebase will succeed cleanly. The concern is only real if the user edits `status.json`, which the ownership rules prohibit. So this works IF the ownership rules are enforced.

**Problem 3: The `/ralph-review` skill merges branches.**

When the user approves a task, the skill merges `ralph/task-xxx` into main. This is a destructive operation happening from the user's laptop. What if:
- The branch has diverged from main (merge conflict)?
- The node has already started working on a task that depends on the reviewed task?
- The merge creates a new commit on main that the node hasn't pulled yet?

The skill should do a `git merge --no-ff` to create a merge commit (for history clarity), and the node should always `git pull --rebase` before starting work. But there's a subtle timing issue: if the node picks up a task that depends on the reviewed task, and the review branch hasn't been merged yet, the dependent task starts on stale code.

**Rating: 7/10** -- Great UX thinking, some concurrency gaps. The skill-based approach is the right abstraction.

---

### 4. prompt-engineer.md -- Prompting & Agent Loop Design

**What's sound:**
- The task-to-prompt pipeline (Section 3) is well-structured.
- Exit condition matrix (Section 4) is comprehensive and the most thorough treatment across all documents.
- Per-task-type tool profiles (Section 6) is the right approach.
- The ralph-system.md prompt (Section 8) with "Do not ask questions -- there is no one to answer" is critical for headless operation.
- The distinction between `--system-prompt` (replace) and `--append-system-prompt` (add to) is important and correctly handled.
- Verification step after every Claude Code invocation is non-negotiable, and this document gets it right.

**Where the consistency holes are:**

**Problem 1: Session continuation after test failure is dangerous.**

Section 4 proposes resuming a session when tests fail: `claude -r "$SESSION_ID" -p "The tests failed..."`. The problem: the resumed session has ALL the context from the previous run, including the wrong approach. Claude might double down on the same broken strategy. A fresh session with the test failure output appended to the task description would be more reliable.

Also, session IDs are stored in Claude Code's local state (`~/.claude/`). If the container restarts between the original run and the retry, the session data might be gone (unless the volume mount preserves it). This is a subtle infrastructure dependency that prompt-engineer didn't coordinate with infra-ops.

**Problem 2: Auto-accept criteria are too aggressive.**

Section 5: "Tests pass + task type is `bugfix` + diff < 50 lines → Auto-accept." This is risky. A bugfix that introduces a subtle security vulnerability can be under 50 lines and pass all existing tests. The whole point of the review gate is that automated checks catch known-bad outcomes, not unknown-bad ones.

For v1, NOTHING should be auto-accepted. Every task goes through review. Auto-accept is an optimization for when you've built trust in the system and the test suite. Starting with auto-accept on day one is premature optimization of the worst kind -- you're optimizing away the safety net.

**Problem 3: The orchestration script (Section 10) modifies task state on main and then works on a branch.**

Same problem as git-workflow: the script marks a task as `in_progress` on main, pushes, then creates a branch and works there. Two separate pushes to main per task (claim and completion). The orchestration script shows `git push` at line 1039 (after claiming) and doesn't show a push after completion -- so completion status updates seem to be missing entirely, or they're assumed to be handled by another mechanism that isn't specified.

**Problem 4: Template interpolation is underspecified.**

The templates use `{{variable}}` and `{{#list}}` syntax. What renders these? Mustache? Handlebars? A custom sed script? This matters because the rendering engine needs to handle edge cases (special characters in task descriptions, multi-line fields, YAML in Markdown, etc.). The document says "envsubst, mustache, or even sed -- keep it boring" but these have wildly different capabilities. `envsubst` can't handle lists. `sed` will break on special characters. This needs a concrete decision.

**Rating: 8/10** -- Most technically thorough document. The exit condition matrix and tool profiles are the best individual contributions. Auto-accept is the main dangerous assumption.

---

### 5. test-architect.md -- Testing & Verification Strategy

**What's sound:**
- The "confidence ladder" (build order) is excellent. Inside-out testing is the right approach.
- Local bare repos for git testing is the critical insight that makes this system testable without infrastructure.
- Verification gates are well-defined and the "no skipping" rule is correct.
- The mock strategies (CLI stub -> behavior-based -> record/replay -> real) are properly tiered.
- Test file structure (Appendix A) is clean and follows good conventions.
- "Under 4 minutes" for the full test suite is a good target.

**Where the consistency holes are:**

**Problem 1: Gate 2 claims "atomic" file claiming but never specifies how.**

Gate 2: "Claiming a task atomically updates the file" and "Two concurrent claims: only one succeeds (file locking)." But HOW? The document never specifies a locking mechanism. File locking in a git-based system is not trivial:

- `flock` works on a local filesystem but not across git clones (the whole point of the system).
- Git's own locking (`git lock`) doesn't exist as a user-facing command.
- The only "lock" in a git-based system is "push first wins" -- which is what git-workflow and my own document describe.

For a single-worker system, there IS no concurrent claim problem, so the test is moot. But the gate implies multi-worker capability that doesn't exist yet. The test should verify that a single worker claims tasks correctly, and leave multi-worker locking for when it's actually implemented.

**Problem 2: The "conflict path" test (Section 7) has an unresolvable scenario.**

The conflict test says: "User modifies task while agent is working on it -> Agent finishes and tries to push -> Push fails -> Agent handles conflict." But the agent is working on a BRANCH, not main. The agent pushes the branch, not main. The user's modification was to the task file on main. These are different branches -- there's no conflict on push.

The conflict only happens when the agent tries to update the task status on main. And at that point, the agent should `git pull --rebase` first, which should cleanly apply because the agent modified the status file and the user modified... what? The task description? If ownership boundaries are enforced, this conflict doesn't happen.

The test should be testing the scenarios that CAN actually conflict, not hypothetical ones.

**Problem 3: Bun is assumed without justification.**

The document recommends "Bun's built-in test runner" and the entire CI pipeline uses `bun`. But nothing in the system requirements specifies Bun. The loop runner from infra-ops is bash. The orchestrator from prompt-engineer starts as bash. If the core system is bash scripts + Claude Code CLI, why add a Bun/TypeScript dependency for the orchestrator?

I'm not against Bun/TypeScript -- it's a fine choice. But the testing strategy should match the implementation language. If the orchestrator is bash, the tests should be able to test bash scripts (using something like bats-core). If we're committing to TypeScript for the orchestrator, that should be an explicit decision, not an assumption.

**Problem 4: No testing of the feedback loop.**

The test scenarios cover: golden path, failure path, conflict path. Missing: review path. What happens when a task completes, the user rejects it with feedback, and it goes back to the queue? This is a critical workflow (dx-client's Section 7 depends on it) and there's no test for it.

**Rating: 8/10** -- Best testing strategy. The confidence ladder alone is worth the price of admission. Some tests are for scenarios that can't actually happen given the architecture, and the review loop is untested.

---

## Part 2: Agent Rankings

### Ranking: Most Sound to Most Dangerous

| Rank | Agent | Score | Rationale |
|------|-------|-------|-----------|
| 1 | **git-workflow** | 8/10 | Best understanding of the fundamental constraint (git is not a database). Ownership boundaries are the most important design insight. Two-file-per-task is the main mistake. |
| 2 | **prompt-engineer** | 8/10 | Most technically detailed. Exit conditions and tool profiles are essential. Auto-accept is the dangerous assumption. |
| 3 | **test-architect** | 8/10 | Confidence ladder is the right build methodology. Some tests target impossible scenarios. Missing review loop test. |
| 4 | **infra-ops** | 7/10 | Solid infrastructure recommendations. Security and crash recovery are hand-waved. `git add -A` is a footgun. |
| 5 | **dx-client** | 7/10 | Best UX vision. Skill-based approach is right. Concurrency between skills and node needs more thought. |

**Most dangerous assumptions across all documents:**

1. **Auto-accept without review** (prompt-engineer) -- Automating away the safety net on day one.
2. **`git add -A`** (infra-ops) -- Will eventually commit something that shouldn't be committed.
3. **Two files per task** (git-workflow) -- Split-brain waiting to happen.
4. **No crash recovery for in_progress tasks** (infra-ops) -- Orphaned tasks after container restart.
5. **Session resume across container restarts** (prompt-engineer) -- Infrastructure dependency that's not guaranteed.

---

## Part 3: Synthesized Architecture Proposal

### Core Principles

1. **One file per task.** Markdown with YAML frontmatter. No split-brain.
2. **Directory-per-status.** `git mv` IS the state transition. Visible in diffs, queryable with `ls`.
3. **Ownership boundaries are sacred.** User writes to `pending/`. Agent writes to `in_progress/`, `review/`, `done/`, `failed/`. Cross-writes are bugs.
4. **Single worker. Period.** No multi-worker until the single-worker system is proven.
5. **Nothing auto-accepted.** Every completed task goes to `review/`.
6. **Git push failure = transaction abort.** Pull, rebase, re-evaluate.
7. **Crash recovery on startup.** The first thing the worker does is reclaim or release orphaned tasks.

### Directory Structure

```
project-root/
  .ralph/
    tasks/
      pending/          # User creates tasks here
      in_progress/      # Worker moves tasks here during execution
      review/           # Worker moves completed tasks here
      done/             # User moves approved tasks here
      failed/           # Worker moves failed tasks here
    status.json         # Worker heartbeat (worker-owned, never user-edited)
    logs/
      YYYY-MM-DD.jsonl  # Structured execution logs (append-only)
    config.json         # System configuration (poll interval, timeouts, etc.)
  src/
    ...project code...
```

### Task File Format (Single File)

```markdown
---
id: "task-20260303-001"
title: "Add user authentication endpoint"
status: "pending"
priority: 100
type: "feature"
created_at: "2026-03-03T10:00:00Z"
updated_at: "2026-03-03T10:00:00Z"
assigned_to: null
depends_on: []
retry_count: 0
max_retries: 2
tags: ["backend", "auth"]
branch: null
needs_review: true
---

## Description

Add a POST /api/auth/login endpoint...

## Acceptance Criteria

- Endpoint returns 200 with JWT on valid credentials
- Endpoint returns 401 on invalid credentials

## Constraints

- Do not modify the User model
```

### State Machine

```
pending --> in_progress --> review --> done
                       \-> failed (retries exhausted)
                       \-> pending (retry with incremented count)

review --> done (user approves)
review --> pending (user rejects with feedback, appended to body)
```

Transitions are `git mv` between directories + frontmatter update in a SINGLE commit. Status in frontmatter MUST match directory name. Consistency check runs on every startup.

### Worker Loop (Corrected)

```bash
#!/usr/bin/env bash
set -euo pipefail

# PHASE 0: Crash recovery
recover_orphaned_tasks() {
  for file in .ralph/tasks/in_progress/*.md; do
    [ -f "$file" ] || continue
    assigned=$(grep '^assigned_to:' "$file" | awk '{print $2}' | tr -d '"')
    if [ "$assigned" = "$WORKER_ID" ]; then
      # This worker crashed while working on this task
      retry_count=$(grep '^retry_count:' "$file" | awk '{print $2}')
      max_retries=$(grep '^max_retries:' "$file" | awk '{print $2}')
      if [ "$retry_count" -lt "$max_retries" ]; then
        git mv "$file" ".ralph/tasks/pending/$(basename "$file")"
        # Update frontmatter: increment retry_count, clear assigned_to, set status
        update_frontmatter "$file" status=pending assigned_to=null retry_count=$((retry_count + 1))
        git add ".ralph/tasks/pending/$(basename "$file")"
        git commit -m "ralph($(task_id "$file")): recovered after crash, retry $((retry_count + 1))/$max_retries"
      else
        git mv "$file" ".ralph/tasks/failed/$(basename "$file")"
        update_frontmatter "$file" status=failed
        git add ".ralph/tasks/failed/$(basename "$file")"
        git commit -m "ralph($(task_id "$file")): permanently failed (crash, retries exhausted)"
      fi
    fi
  done
  git push origin main || { git pull --rebase origin main && git push origin main; }
}

# PHASE 1: Main loop
main() {
  git pull --rebase origin main
  recover_orphaned_tasks

  while true; do
    git pull --rebase origin main
    update_heartbeat

    task=$(find_next_eligible_task)
    if [ -z "$task" ]; then
      sleep "${POLL_INTERVAL:-30}"
      continue
    fi

    process_task "$task"
  done
}

find_next_eligible_task() {
  # List pending tasks, filter by dependency satisfaction, sort deterministically
  for file in $(ls .ralph/tasks/pending/ | sort); do
    filepath=".ralph/tasks/pending/$file"
    if dependencies_met "$filepath"; then
      echo "$filepath"
      return
    fi
  done
}

dependencies_met() {
  local file="$1"
  local deps=$(parse_depends_on "$file")
  for dep_id in $deps; do
    if ! ls .ralph/tasks/done/*"$dep_id"* >/dev/null 2>&1; then
      return 1  # Dependency not met
    fi
  done
  return 0
}

process_task() {
  local task_file="$1"
  local task_id=$(parse_id "$task_file")
  local task_type=$(parse_type "$task_file")
  local basename=$(basename "$task_file")

  # Claim: move to in_progress
  git mv "$task_file" ".ralph/tasks/in_progress/$basename"
  local active_file=".ralph/tasks/in_progress/$basename"
  update_frontmatter "$active_file" status=in_progress assigned_to="$WORKER_ID" updated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git add "$active_file"
  git commit -m "ralph($task_id): claimed by $WORKER_ID"

  if ! git push origin main; then
    # Push failed -- someone else changed the remote. Abort claim.
    git reset --hard origin/main
    return
  fi

  # Create task branch
  local branch="ralph/$task_id"
  git checkout -b "$branch"

  # Build prompt and execute
  local prompt=$(build_prompt "$active_file" "$task_type")
  local tools=$(get_tool_profile "$task_type")

  local exit_code=0
  timeout "${TASK_TIMEOUT:-1800}" claude -p "$prompt" \
    --output-format json \
    --max-turns "${MAX_TURNS:-50}" \
    --max-budget-usd "${MAX_BUDGET:-5.00}" \
    --model "${MODEL:-opus}" \
    --allowedTools $tools \
    --append-system-prompt-file ".claude/ralph-system.md" \
    --dangerously-skip-permissions \
    > ".ralph/logs/${task_id}.json" 2>&1 \
    || exit_code=$?

  # Post-execution verification
  local verified=false
  if [ $exit_code -eq 0 ]; then
    if run_verification "$task_type"; then
      verified=true
    fi
  fi

  # Commit work on the branch (only specific files, NOT git add -A)
  git add -u  # Only tracked files that changed
  git add .ralph/logs/${task_id}.json
  git commit -m "ralph($task_id): execution complete (exit=$exit_code, verified=$verified)" || true
  git push origin "$branch"

  # Switch back to main for status update
  git checkout main
  git pull --rebase origin main

  if [ "$verified" = true ]; then
    git mv ".ralph/tasks/in_progress/$basename" ".ralph/tasks/review/$basename"
    update_frontmatter ".ralph/tasks/review/$basename" status=review branch="$branch" updated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    git add ".ralph/tasks/review/$basename"
    git commit -m "ralph($task_id): completed, moved to review (branch: $branch)"
  else
    handle_failure "$active_file" "$task_id" "$exit_code"
  fi

  git push origin main || { git pull --rebase origin main && git push origin main; }
}
```

### Key Differences From Other Proposals

| Decision | My Proposal | Others | Why Mine |
|----------|-------------|--------|----------|
| Files per task | 1 (MD+frontmatter) | 2 (git-workflow: .json + .md) | No split-brain risk |
| Status tracking | Directory per status | Mixed (some frontmatter-only) | Visible in `ls`, atomic via `git mv` |
| Auto-accept | Never (v1) | Conditional (prompt-engineer) | Safety net first, optimize later |
| Crash recovery | Explicit startup phase | Hand-waved (infra-ops) | Orphaned tasks are a real problem |
| `git add` strategy | `git add -u` + specific files | `git add -A` (infra-ops) | Prevents accidental commits |
| Concurrent claims | Push-first-wins | File locking (test-architect) | File locking doesn't work across git clones |
| Session resume | Fresh session on retry | Resume session (prompt-engineer) | Container restart may lose session state |
| Template engine | Concrete choice needed | "envsubst or sed" (prompt-engineer) | Must handle multi-line, special chars |
| Test scope | Test what CAN happen | Test hypothetical conflicts (test-architect) | Don't test impossible scenarios |

### Build Order (Adopting test-architect's Confidence Ladder)

test-architect's build order is correct. I endorse it fully with one addition:

**Layer 0.5: Consistency Check**

Between "Task File Parsing" and "State Machine", add a consistency checker that validates:
- Every file in `pending/` has `status: pending` in frontmatter
- Every file in `in_progress/` has `status: in_progress` in frontmatter
- No dangling `depends_on` references
- No cycles in dependency graph
- Filenames match the `id` field

This is a pure function, trivially testable, and catches the #1 class of bugs in this system: state inconsistency.

### What I'd Borrow From Each Agent

| Agent | Borrow | Why |
|-------|--------|-----|
| **git-workflow** | Ownership boundary rules (Section 4) | Most important design insight. User never touches agent files. Agent never touches user files. |
| **git-workflow** | Commit convention: `ralph(<id>): <action>` | Makes `git log` a real-time dashboard |
| **git-workflow** | Task branches with no auto-merge | Clean isolation, review gate |
| **prompt-engineer** | Exit condition matrix (Section 4) | Most comprehensive treatment of failure modes |
| **prompt-engineer** | Per-task-type tool profiles | Principle of least privilege, correct |
| **prompt-engineer** | Ralph system prompt: "Do not ask questions" | Essential for headless operation |
| **prompt-engineer** | Verification step after every execution | Never trust the model's "I'm done" |
| **test-architect** | Confidence ladder (build order) | Inside-out testing is the right methodology |
| **test-architect** | Local bare repos for git testing | Makes the system testable without infrastructure |
| **test-architect** | Mock tiers (CLI stub -> behavior -> record/replay) | Practical progression |
| **infra-ops** | Hetzner CX22 + Docker restart policy | Right level of infrastructure simplicity |
| **infra-ops** | Minimal Dockerfile (node:20-slim) | Don't need the full devcontainer |
| **dx-client** | Claude Code skills as client interface | No separate CLI binary needed |
| **dx-client** | ntfy.sh for notifications | One curl command, push notifications |
| **dx-client** | The ideal workflow narrative (Section 7) | Best articulation of the user journey |

### What I'd Throw Away

| Agent | Reject | Why |
|-------|--------|-----|
| **git-workflow** | Two-file-per-task (.json + .md) | Split-brain risk. One file does it all. |
| **git-workflow** | JSON for status files | YAML frontmatter in Markdown is sufficient. JSON is harder to hand-edit. |
| **prompt-engineer** | Auto-accept rules | Not for v1. Build trust first. |
| **prompt-engineer** | Session resume on retry | Container restarts lose session state. Fresh session is more reliable. |
| **prompt-engineer** | YAML task files (task.yaml) | Use Markdown with YAML frontmatter, not pure YAML. Richer descriptions. |
| **test-architect** | File locking in Gate 2 | Doesn't work across git clones. Push-first-wins is the mechanism. |
| **test-architect** | Bun assumption without justification | Implementation language should be an explicit decision. |
| **infra-ops** | `git add -A` | Footgun. Use explicit file paths or `git add -u`. |
| **dx-client** | `/ralph-priority` modifying active tasks | Ownership violation. Only modify `pending/` tasks. |

---

## Part 4: Open Questions That Nobody Addressed

1. **What happens to the task branch when a user rejects and the task goes back to pending?** Does the branch get deleted? Does the next attempt start from that branch or from main? If from main, the previous work is lost. If from the branch, the previous (wrong) work contaminates the retry.

   **My answer:** Delete the branch. Start fresh from main. The rejection feedback in the task body gives Claude enough context. Carrying forward a broken branch causes more harm than good.

2. **How does the system handle a task that requires changes made by a pending-review task?** If task B depends on task A, and task A is in `review/`, task B's `depends_on` check fails (A is not in `done/`). But A's code changes ARE on a branch. Does the worker wait? Does it skip B?

   **My answer:** Strict: B waits until A is in `done/`. The user approves A, which merges the branch to main, moves A to `done/`. Then B becomes eligible. Yes, this means the user is a bottleneck. That's by design -- the review gate is intentional.

3. **What about partial commits?** Claude Code might make 10 commits on the task branch. Do these all get merged as-is? Squashed? Rebased?

   **My answer:** Squash merge when the user approves. One clean commit on main per task. The branch preserves the detailed history for archaeology. `git merge --squash ralph/task-xxx`

4. **Log rotation.** `.ralph/logs/` will grow forever. Who cleans it up?

   **My answer:** Date-based log files (`YYYY-MM-DD.jsonl`). Gitignore anything older than 30 days. Or don't check logs into git at all -- keep them as Docker container logs only. The task file itself should contain the final outcome; detailed logs are ephemeral.

5. **What if the user creates a task with a `depends_on` referencing a task that doesn't exist?**

   **My answer:** The worker's `find_next_eligible_task` should validate dependencies. If a dependency ID doesn't match any task in any directory, log a warning and treat the dependency as unsatisfied. The task sits in `pending/` forever until the user fixes it. A client-side skill (`/ralph-task`) should validate dependencies at creation time.

---

## Summary

The five brainstorms converge on the same fundamental architecture. The disagreements are in the details, and most of them have clear correct answers when viewed through a distributed systems lens:

- **One file per task** (not two)
- **Directories as state** (not just frontmatter)
- **No auto-accept** (not yet)
- **Crash recovery is explicit** (not assumed)
- **Push-first-wins for concurrency** (not file locks)
- **Ownership boundaries are the contract** (not just a suggestion)

The system is simple enough to build in a week, test locally without a VPS, and iterate on without fear. That's the point.
