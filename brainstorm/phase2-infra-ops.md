# Phase 2: Infrastructure Critique & Architecture Synthesis

> **infra-ops** cross-review | 2026-03-03

---

## 1. Critique of Each Specialist's Proposal

### distributed-arch (Task Queue Design)

**What's good:**
- Markdown + YAML frontmatter is the right call. Human-readable, git-diffable, Claude Code native.
- Directory-per-status is smart. `ls .tasks/pending/` is faster than `grep -r` across hundreds of files.
- Single worker first, multi-worker later. Thank god someone said it.
- The state machine is clear and well-defined.

**What's naive or won't work on a VPS:**

1. **Priority encoding in filenames (`100-task-foo.md`) is fragile.** Renaming a file to change priority creates a new git object. If priority changes are frequent, your git history fills with file renames. Just parse the YAML; it's not that slow with `grep` + `head`.

2. **The `depends_on` resolution requires reading EVERY task file to check status.** For 10 tasks, fine. For 200 tasks in `done/`, you're parsing 200 markdown files on every poll cycle. On a 2-vCPU VPS, this is noticeable. Mitigation: only check tasks referenced in `depends_on`, not the whole directory. Or maintain a lightweight index file (sacrilege, I know, but practical).

3. **The `on_complete.create_tasks` template system is premature.** This is a task orchestration DSL. We're building a simple loop. Auto-creating follow-up tasks should be a feature of the prompt ("if you think a review is needed, create a task file in review/"), not a YAML-based template engine. The prompt-engineer's approach to this is better.

4. **Dual-tracking status in both directory AND frontmatter is a bug waiting to happen.** Yes, they acknowledge this and propose a validation script, but that's a bandaid. My preference: directory IS the status. Frontmatter has everything else. Don't duplicate. If you want to query status from frontmatter, generate it at read-time from the directory path.

5. **The heartbeat file approach for crash detection adds git commits for zero value.** Timestamp-based timeout on the `claimed_at` field is sufficient. Every heartbeat commit is noise in the git log.

**Verdict: 8/10.** Solid, practical, well-reasoned. The best of the five proposals. Minor over-engineering in a few places but nothing that would derail the project.

---

### git-workflow (Git Synchronization)

**What's good:**
- The ownership boundary rules are excellent: user owns task definitions, agent owns status + code. This single rule prevents 90% of git conflicts.
- File-per-task (not shared queue file) is the right call.
- The push strategy (push at milestones, not every commit) is pragmatic.
- Commit convention (`ralph(<task-id>): <action>`) is clean and greppable.
- Single repo recommendation is correct for v1.

**What's naive or won't work:**

1. **Separate `.json` status files + `.md` task files is unnecessary indirection.** distributed-arch puts status in the directory location. git-workflow creates a parallel file. Now you have `tasks/001.md` AND `tasks/001.json`, and they can disagree. Just use frontmatter in the `.md` file. One file per task, status encoded by directory. Don't fight the convention distributed-arch already established.

2. **The proposed workflow has the agent switching between branches AND updating main.** Look at this sequence: agent claims task on main, checks out task branch, does work, pushes branch, checks out main, updates status json, pushes main. That's two branch switches and two pushes PER TASK. On a VPS with a slow disk, each `git checkout` rewrites the working tree. This is slow and fragile -- what if the push to main fails after the branch push? You're in an inconsistent state.

   **Better approach:** Agent works entirely on the task branch. Status is encoded by which branch exists and its last commit message. The status.json lives on main and is updated ONCE via a lightweight commit (no checkout needed -- use `git update-ref` or push from a separate worktree if needed). Or even simpler: don't update main at all during execution. The user checks branch existence for status.

3. **`jq '.status = "running" | .started = now'` won't work.** `jq`'s `now` function returns a Unix timestamp, not ISO 8601. And piping to a temp file then `mv` is not atomic on all filesystems. These are the kinds of bugs that only show up on a VPS under load.

4. **The `git diff --name-only HEAD origin/main | grep ".ralph/tasks/"` approach for detecting new tasks is fragile.** If the agent has local uncommitted changes, this diff includes them. If multiple tasks were pushed in one commit, this works, but if the diff is large (code changes), you're scanning a lot of output just to find task files. Better: after `git pull`, just `ls .ralph/tasks/pending/` or equivalent. The filesystem is your query engine, not git diff.

5. **They recommend separate `.json` and `.md` files per task but then the example shows the user manually writing both with `cat > .ralph/tasks/003.json << 'EOF'`.** This is a terrible DX for a non-Linux user. Two files to create per task? With raw JSON? No. The dx-client skill approach is the right answer here.

**Verdict: 6/10.** Good principles, clunky execution. The ownership rules and commit conventions are keepers. The dual-file approach and branch-switching workflow need rework.

---

### dx-client (Developer Experience & Client Tooling)

**What's good:**
- The Claude Code skills approach (`/ralph-task`, `/ralph-status`, `/ralph-review`) is the standout idea across all proposals. This is the correct UX layer. The user should never manually create task files or run git commands.
- The full user workflow scenario (morning/afternoon/evening) is compelling and shows the system actually working end-to-end.
- `status.json` heartbeat pushed to git is the simplest monitoring that actually works.
- Pull-based monitoring first, push notifications later. Correct priority.
- `ntfy.sh` as the first notification upgrade is smart -- one curl command, done.

**What's unrealistic or needs infrastructure input:**

1. **The skill set is too large for v1.** They list 9 skills. For v1, you need THREE: `/ralph-task` (create), `/ralph-status` (check), `/ralph-review` (approve/reject). Everything else -- `/ralph-backlog`, `/ralph-list`, `/ralph-cancel`, `/ralph-priority`, `/ralph-pause`, `/ralph-resume` -- is v2 at earliest. Building 9 skills before the loop even works is classic scope creep.

2. **The cancel signal via git file (`tasks/signals/cancel-<task-id>`) is clever but operationally fragile.** The agent checks for signals "before each phase" -- but in headless mode with `claude -p`, there are no "phases." Claude runs, does its thing, exits. There's no interrupt mechanism. You'd need the orchestrator wrapper to check between Claude invocations (between retries, between tasks). Cancelling an in-progress Claude run requires killing the process, not writing a file.

3. **The `status.json` needs to be pushed to git every few minutes.** This means the agent is doing `git add status.json && git commit && git push` every 2-3 minutes even when idle. That's ~20-30 commits per hour of just heartbeat noise. On a VPS, each push is a network round-trip. On the user's end, `git pull` brings down all these heartbeat commits. This will make `git log` unusable.

   **Better approach:** Commit status only on state transitions (task started, task completed, task failed). For liveness checking, use a much longer interval (every 15-30 minutes) or don't commit heartbeats at all -- just rely on "when was the last real commit?" as the health signal.

4. **The skill definitions use `disable-model-invocation: true` but the skills themselves require Claude to analyze the codebase** (e.g., `/ralph-backlog` decomposes features into tasks by reading code). This flag means the skill just runs as a script, not as a Claude prompt. That contradicts the described behavior. This needs clarification: is it a skill prompt or a bash script? It can't be both.

5. **No mention of how the skills interact with the Docker container.** The skills run on the user's laptop. They modify files and push to git. The container picks up changes. But what about `/ralph-pause`? It writes a signal file. How does the container pick that up between tasks? The signal file approach requires the loop script to check for signal files before each iteration, which is fine, but it's not documented anywhere in the actual infrastructure design.

**Verdict: 7/10.** The skill-based UX is the single best idea in all five documents. But the scope is too large, some implementation details are hand-wavy, and the heartbeat commit spam is a real problem.

---

### prompt-engineer (Prompt & Agent Loop Design)

**What's good:**
- Comprehensive CLI flag reference. This is the most thorough documentation of Claude Code's headless capabilities.
- The per-task-type tool profiles (`tools_readonly`, `tools_test`, `tools_full`) are exactly right. Principle of least privilege.
- The exit condition matrix is thorough and practical. Budget, turns, timeout, refusal -- all covered.
- The verification step after Claude finishes (run tests, build, lint) is critical and well-defined.
- Session continuation for retries (`--resume $SESSION_ID`) is clever and avoids re-doing work.
- The "Ralph System Prompt" content is well-crafted, especially "Do not ask questions -- there is no one to answer."

**What's over-engineered or unrealistic:**

1. **The template system (Mustache-style `{{variable}}` interpolation) is unnecessary complexity for v1.** The task file IS the prompt. Literally `claude -p "$(cat task.md)"` works. Adding a template engine (even a simple one) means writing, testing, and maintaining interpolation logic. The task file should contain everything Claude needs, including the workflow instructions. No template layer.

   If you want consistent task structure, put it in the `/ralph-task` skill that CREATES the task file. The creation is where you enforce structure, not the execution.

2. **Six task types with six separate templates (bugfix, feature, refactor, research, test, review) is premature categorization.** In practice, most tasks are "do this thing." The difference between a "bugfix" and a "feature" is the description, not the template. A single, good system prompt that says "be surgical, run tests, commit your work" covers 90% of cases. Type-specific templates are a v3 concern.

3. **The auto-accept decision matrix (tests pass + task type is bugfix + diff < 50 lines = auto-accept) is playing with fire.** On an unattended VPS, auto-accepting ANYTHING without human review is risky. The whole point of the review step is that a human verifies the output. If you auto-accept, you're trusting the test suite is comprehensive enough to catch all issues. For a system that's brand new and unproven, that's a bad bet. Default to review for EVERYTHING in v1.

4. **The Python SDK V2 code examples are distracting.** This is a brainstorm for v1. Including async Python with `claude_agent_sdk` imports alongside the bash v1 design creates confusion about what we're actually building. Pick one and commit. (Bash for v1. Period.)

5. **`yq` dependency.** The orchestration script uses `yq` for YAML parsing, but this isn't in the Docker image. It's also not a standard tool. Use `grep` + `sed` for simple frontmatter parsing, or if you need real YAML parsing, use a small Node.js script since Node.js is already installed.

**Verdict: 7/10.** Excellent research on Claude Code capabilities. The tool profiles and exit conditions are directly usable. But the template system and task type taxonomy add complexity that isn't justified yet.

---

### test-architect (Testing & Verification Strategy)

**What's good:**
- The "confidence ladder" (build from pure logic outward to infrastructure) is the right testing philosophy.
- Local testing with bare git repos is genius. You can test the entire git workflow without a network. This should be the foundation of all integration tests.
- Mock Claude Code strategy is practical and well-tiered (CLI stub -> behavior mock -> record/replay -> real execution).
- The verification gates with checklists are thorough.
- The "golden path" end-to-end test scenario is exactly what you'd write first.
- CI pipeline under 4 minutes. Good target.

**What's unrealistic or infrastructure-blind:**

1. **Bun as the test runner / TypeScript for everything.** The orchestrator is a bash script. The task files are markdown. The git operations are shell commands. Why are we writing tests in TypeScript with Bun? The primary codebase is bash and git. Testing bash scripts with a TypeScript test framework means:
   - Installing Bun in the Docker image (more bloat)
   - Shelling out from TypeScript to run bash commands (awkward)
   - Two languages to reason about

   **Counter-proposal:** Use bash for testing bash. BATS (Bash Automated Testing System) is purpose-built for this. It's lightweight, runs anywhere bash runs, and tests what we're actually writing. If/when we move to a TypeScript orchestrator (v2+), then TypeScript tests make sense.

   Alternatively, if the team strongly wants TypeScript: write the orchestrator in TypeScript from the start. Don't write the orchestrator in bash and the tests in TypeScript -- that's a mismatch.

2. **The typed task objects and state machine tests assume a TypeScript implementation** that doesn't exist in any other proposal. distributed-arch's state machine is "git mv from pending/ to in_progress/." That's not a TypeScript function with type guards -- it's a file move. The tests should test the actual implementation, not a hypothetical typed version.

3. **Property-based testing for the state machine ("random sequence of valid transitions never produces invalid state")** is nice in theory but overkill for a state machine with 5 states and 7 transitions. A hand-written test for each transition is sufficient and more readable. Property-based testing is a luxury for v1.

4. **The test file structure (8 directories, 12+ test files) is infrastructure for a system that doesn't exist yet.** Writing test infrastructure before writing the actual code is backwards. Write the simplest possible loop first, then add tests for the parts that break. The confidence ladder is right in principle but the suggested structure assumes a mature codebase.

5. **"Atomic writes (write temp file, rename); fsync" for task file updates.** This is a good practice but irrelevant in our context. We're writing task files and immediately committing them to git. The atomicity boundary is the git commit, not the file write. If the process crashes between writing and committing, the file is in an undefined state, but `git checkout -- .` restores it. Don't add fsync complexity when git already provides our durability guarantee.

6. **Docker-in-Docker dismissal is correct, but the proposed alternative (mount local bare repo into container) has its own issues.** A bare repo mounted via Docker volume needs careful permission handling. The container runs as `ralph` (UID 1001), the host might use a different UID. Volume permission mismatches are one of the most common Docker headaches for non-Linux users.

**Verdict: 6/10.** Correct philosophy, wrong implementation language, and over-specified for the current stage. The local bare repo testing strategy is the keeper. The TypeScript/Bun assumption needs to be reconciled with what we're actually building.

---

## 2. Ranking: Most to Least Practical

| Rank | Specialist | Score | Why |
|------|-----------|-------|-----|
| 1 | **distributed-arch** | 8/10 | Most grounded. The task format, state machine, and directory-per-status design are directly implementable. Minor over-engineering but nothing blocking. |
| 2 | **dx-client** | 7/10 | The skills-as-UX insight is the single most valuable contribution. But scope is too large and some implementation details are hand-wavy. |
| 3 | **prompt-engineer** | 7/10 | Best research on Claude Code capabilities. Tool profiles and exit conditions are gold. Template system is over-engineered. |
| 4 | **test-architect** | 6/10 | Right philosophy, wrong language choice. The local bare repo testing and confidence ladder are excellent. The TypeScript assumption doesn't match the bash-first approach. |
| 5 | **git-workflow** | 6/10 | Good principles (ownership boundaries, commit conventions) but the dual-file approach and branch-switching workflow are clunky. Overlaps heavily with distributed-arch and sometimes contradicts it. |

---

## 3. Proposed High-Level Architecture (Synthesis)

### What I'd Take From Each

| From | Keep | Drop |
|------|------|------|
| **distributed-arch** | Directory-per-status, markdown+YAML tasks, single worker, deterministic pickup | Priority in filenames, dual status tracking, on_complete templates |
| **git-workflow** | Ownership boundaries, commit conventions, task branches, polling | Separate .json files, branch-switching on main, jq-based status updates |
| **dx-client** | Claude Code skills for UX, status.json, pull-based monitoring | 9 skills in v1, heartbeat commit spam, cancel signals |
| **prompt-engineer** | Tool profiles per task type, exit conditions, verification step, --append-system-prompt-file | Template engine, 6 task types, auto-accept, Python SDK examples |
| **test-architect** | Confidence ladder, local bare repo testing, mock Claude Code, verification gates | TypeScript/Bun for testing bash, property-based tests, over-specified test structure |

### Architecture Overview

```
User's Laptop                          Hetzner VPS (CX22, 4GB RAM)
┌─────────────────────┐                ┌────────────────────────────────┐
│ Claude Code          │                │  Docker Container (ralph)      │
│ (interactive)        │                │                                │
│                      │  git push/pull │  ralph-loop.sh                 │
│ /ralph-task "desc"   │ <============> │    1. git pull                 │
│ /ralph-status        │                │    2. ls .ralph/pending/       │
│ /ralph-review        │                │    3. claim (git mv + commit)  │
│                      │                │    4. branch + execute         │
│ 3 skills, that's it  │                │    5. verify (tests/build)     │
│                      │                │    6. push branch + update     │
└─────────────────────┘                │    7. sleep                    │
                                       │                                │
                                       │  restart: unless-stopped       │
                                       └────────────────────────────────┘
                                                    │
                                                    ▼
                                          api.anthropic.com
                                          github.com
```

### Directory Structure (In Project Repo)

```
project-root/
├── .ralph/
│   ├── pending/              # Tasks waiting for pickup
│   │   └── task-20260303-001.md
│   ├── in_progress/          # Currently executing
│   ├── review/               # Awaiting human review
│   ├── done/                 # Completed and approved
│   ├── failed/               # Permanently failed
│   ├── config.json           # Ralph configuration (poll interval, model, etc.)
│   └── status.json           # Node status (updated on state transitions ONLY)
├── .claude/
│   ├── skills/
│   │   ├── ralph-task/SKILL.md
│   │   ├── ralph-status/SKILL.md
│   │   └── ralph-review/SKILL.md
│   └── ralph-system.md       # System prompt for headless execution
├── src/                      # Project code
└── CLAUDE.md                 # Project conventions
```

### Task File (Single File, Not Two)

```markdown
---
id: task-20260303-001
title: Add rate limiting to API endpoints
priority: 100
created: 2026-03-03T10:00:00Z
author: avanwieringen
depends_on: []
max_retries: 2
retry_count: 0
tags: [backend, api]
---

## Description

Add rate limiting middleware to all API endpoints using a sliding window
algorithm with configurable limits per endpoint.

## Acceptance Criteria

- Rate limiter middleware implemented
- Configurable per-endpoint limits
- Returns 429 with Retry-After header
- All tests pass

## Context

Related files: src/api/routes.ts, src/middleware/
```

Status is NOT in the frontmatter. Status IS which directory the file is in. Period. No duplication.

### Orchestrator Loop (Bash, V1)

```bash
#!/usr/bin/env bash
set -euo pipefail

RALPH_DIR=".ralph"
POLL_INTERVAL="${POLL_INTERVAL:-30}"
MAX_TIMEOUT="${MAX_TIMEOUT:-1800}"
MODEL="${MODEL:-opus}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Clone or pull
if [ ! -d ".git" ]; then
  git clone "$TASK_REPO_URL" .
fi

while true; do
  git pull --rebase origin main || { log "ERROR: git pull failed"; sleep 60; continue; }

  # Find next task (sorted by priority prefix, then name)
  TASK=$(ls "$RALPH_DIR/pending/" 2>/dev/null | sort | head -1)

  if [ -z "$TASK" ]; then
    log "No pending tasks. Sleeping ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
    continue
  fi

  TASK_ID=$(grep '^id:' "$RALPH_DIR/pending/$TASK" | head -1 | sed 's/^id: *//' | tr -d '"')
  BRANCH="ralph/$TASK_ID"

  log "Claiming task: $TASK_ID"

  # Claim: move to in_progress, commit, push
  git mv "$RALPH_DIR/pending/$TASK" "$RALPH_DIR/in_progress/$TASK"
  git add -A
  git commit -m "ralph($TASK_ID): claimed"
  git push origin main || {
    log "Push failed (conflict?). Resetting and retrying..."
    git reset --hard origin/main
    continue
  }

  # Create task branch from main
  git checkout -b "$BRANCH" origin/main

  # Execute with Claude Code
  log "Executing task: $TASK_ID"
  TASK_CONTENT=$(cat "$RALPH_DIR/in_progress/$TASK")

  RESULT=0
  timeout "$MAX_TIMEOUT" claude -p "$TASK_CONTENT" \
    --model "$MODEL" \
    --output-format json \
    --max-turns 50 \
    --max-budget-usd 5.00 \
    --allowedTools "Read,Edit,Write,Glob,Grep,Bash(npm test *),Bash(npm run *),Bash(git add *),Bash(git commit *)" \
    --append-system-prompt-file ".claude/ralph-system.md" \
    --dangerously-skip-permissions \
    > "$RALPH_DIR/in_progress/${TASK%.md}.result.json" 2>&1 \
    || RESULT=$?

  # Push task branch (work in progress, regardless of outcome)
  git add -A
  git commit -m "ralph($TASK_ID): execution complete (exit=$RESULT)" || true
  git push origin "$BRANCH" || true

  # Switch back to main for status update
  git checkout main
  git pull --rebase origin main

  if [ "$RESULT" -eq 0 ]; then
    # Move to review
    git mv "$RALPH_DIR/in_progress/$TASK" "$RALPH_DIR/review/$TASK"
    git add -A
    git commit -m "ralph($TASK_ID): completed, awaiting review (branch: $BRANCH)"
  else
    # Check retries
    RETRY_COUNT=$(grep '^retry_count:' "$RALPH_DIR/in_progress/$TASK" | sed 's/[^0-9]//g')
    MAX_RETRIES=$(grep '^max_retries:' "$RALPH_DIR/in_progress/$TASK" | sed 's/[^0-9]//g')
    RETRY_COUNT=${RETRY_COUNT:-0}
    MAX_RETRIES=${MAX_RETRIES:-2}

    if [ "$RETRY_COUNT" -lt "$MAX_RETRIES" ]; then
      NEW_COUNT=$((RETRY_COUNT + 1))
      sed -i "s/^retry_count:.*/retry_count: $NEW_COUNT/" "$RALPH_DIR/in_progress/$TASK"
      git mv "$RALPH_DIR/in_progress/$TASK" "$RALPH_DIR/pending/$TASK"
      git add -A
      git commit -m "ralph($TASK_ID): failed (exit=$RESULT), retry $NEW_COUNT/$MAX_RETRIES"
    else
      git mv "$RALPH_DIR/in_progress/$TASK" "$RALPH_DIR/failed/$TASK"
      git add -A
      git commit -m "ralph($TASK_ID): permanently failed after $MAX_RETRIES retries"
    fi
  fi

  git push origin main || {
    log "WARN: Status push failed. Will sync on next iteration."
  }

  log "Task $TASK_ID processed. Continuing..."
done
```

### Key Differences From Individual Proposals

1. **No template engine.** The task file IS the prompt. CLAUDE.md and ralph-system.md provide context. That's enough.

2. **No dual status tracking.** Directory = status. Frontmatter has metadata only.

3. **No separate .json status files.** One .md file per task. Status is directory position.

4. **3 skills, not 9.** `/ralph-task`, `/ralph-status`, `/ralph-review`. Everything else is v2+.

5. **No auto-accept.** Everything goes to review/ in v1. The user approves and merges branches.

6. **Status commits only on transitions.** No heartbeat spam. Liveness = "when was the last commit?"

7. **Bash orchestrator, bash tests (BATS).** No TypeScript/Bun mismatch. Test what we ship.

8. **`--allowedTools` with specific tool profiles.** Not `--dangerously-skip-permissions` for tool approval + `--allowedTools` for the actual permissions. Wait -- actually, `--dangerously-skip-permissions` skips ALL permission prompts. If we use it, `--allowedTools` is redundant. Clarification needed: in the container, we likely want `--dangerously-skip-permissions` for simplicity (the container is the sandbox). The `--allowedTools` approach is for when running without full permission skip.

### Build Order (Adapted from test-architect's Ladder)

```
Step 1: Task file format                     (pure text, verify by hand)
Step 2: ralph-loop.sh skeleton               (poll + claim + echo, no Claude)
Step 3: Git sync (local bare repos)          (test with BATS)
Step 4: Mock Claude Code (bash stub)         (test full loop locally)
Step 5: Docker container                     (build, run, verify logs)
Step 6: 3 Claude Code skills                 (test on laptop)
Step 7: Real Claude Code (local, trivial)    (one real task, <$0.05)
Step 8: Real Claude Code in Docker (local)   (same task, containerized)
Step 9: VPS deployment                       (Hetzner, one-time setup)
Step 10: VPS end-to-end                      (laptop -> git -> VPS -> git -> laptop)
```

Each step has a "prove it" gate. No skipping.

---

## 4. Unresolved Cross-Cutting Concerns

### The `--dangerously-skip-permissions` vs `--allowedTools` Tension

Several proposals use both. They're actually different mechanisms:
- `--dangerously-skip-permissions` skips the "approve this action?" prompts entirely
- `--allowedTools` controls which tools Claude CAN use

In a sandboxed container, the pragmatic choice is `--dangerously-skip-permissions` (the container is the sandbox) combined with network-level restrictions. The `--allowedTools` approach gives finer control but doesn't prevent Claude from using tools not in the list -- it just causes prompts which block in headless mode.

**Resolution needed:** Test what actually happens when Claude tries to use a disallowed tool in `-p` mode. Does it error? Silently skip? Block? This determines whether `--allowedTools` is useful in headless mode or only `--dangerously-skip-permissions` works.

### Single Repo vs Task Repo vs Orchestrator Repo

- distributed-arch: `.tasks/` in the project repo
- git-workflow: `.ralph/` in the project repo
- dx-client: `tasks/` in the project repo (no dot prefix)
- My proposal: `.ralph/` in the project repo

We need to agree on ONE convention. My vote: `.ralph/` -- the dot prefix signals "infrastructure, not project code," and `ralph` is specific enough to avoid collisions.

### Language of the Orchestrator

- My proposal + git-workflow: Bash
- prompt-engineer: Bash v1, Python v2
- test-architect: TypeScript with Bun

**My strong opinion:** Bash for v1. It's the only language guaranteed to be on every Linux system, every Docker image, and understood by the Claude Code `--dangerously-skip-permissions` agent. If/when we need more sophistication, rewrite in TypeScript -- but don't build TypeScript test infrastructure for a bash script.

### Frontmatter Parsing in Bash

Multiple proposals assume we can easily parse YAML frontmatter in bash. In practice, this is messy. `grep '^key:' | sed 's/...'` works for simple cases but breaks on multiline values, quoted strings, and arrays.

**Pragmatic solution:** A tiny Node.js helper script that reads a task file and outputs specific fields. Node.js is already in the Docker image.

```bash
# Instead of fragile grep/sed:
TASK_ID=$(node -e "
  const fs = require('fs');
  const content = fs.readFileSync('$TASK_FILE', 'utf8');
  const match = content.match(/^id:\s*[\"']?(.+?)[\"']?\s*$/m);
  console.log(match ? match[1] : '');
")
```

This is boring, reliable, and uses what we already have.

---

## 5. What Everyone Missed

1. **Log rotation on the VPS.** Docker logs grow unbounded by default. Every proposal mentions logging but only I included the `max-size` / `max-file` Docker logging configuration. Without this, a VPS with 40GB disk fills up in weeks.

2. **Git garbage collection.** With hundreds of task files being moved between directories, and feature branches being created and deleted, the git repo grows. Nobody mentioned `git gc` or `.gitignore` patterns for large result files.

3. **What happens to the workspace between tasks.** If Claude Code creates temp files, downloads packages, or leaves build artifacts, the workspace grows over time. Nobody addressed workspace cleanup between tasks. A simple `git clean -fd` after each task (or starting from a fresh worktree) would prevent this.

4. **Time synchronization.** Timestamps in task files, log files, and git commits need consistent time. A VPS clock can drift. Nobody mentioned NTP. Most cloud VPS providers handle this, but it's worth verifying.

5. **The `git pull --rebase` can fail if local changes exist.** Several proposals have the agent doing `git pull --rebase` at the start of each iteration. If the previous iteration left uncommitted changes (crash mid-task), the rebase fails. The loop needs a `git reset --hard origin/main` safety valve when the pull fails, or a `git stash` before pulling.

6. **SSH key permissions.** Mounting `./ssh-keys:/home/ralph/.ssh:ro` requires the key file to have permissions `600`. Docker volume mounts on macOS/Windows don't preserve Unix permissions. This will cause `ssh` to reject the key. Solution: the entrypoint script needs to copy the key and `chmod 600` it, not use the mount directly.

---

## Summary

The five proposals collectively cover the problem well. The main risk is complexity creep -- everyone added their own layer of sophistication. The architecture I propose above takes the simplest viable piece from each specialist and drops everything that isn't needed for v1.

The non-negotiable pieces:
- Markdown + YAML frontmatter tasks in `.ralph/`
- Directory-per-status state machine
- Bash loop script in a minimal Docker container
- `claude -p` with `--dangerously-skip-permissions` in a sandboxed container
- 3 Claude Code skills on the user's laptop
- Local testing with bare git repos before any VPS
- Hetzner CX22 for deployment

Everything else is v2.
