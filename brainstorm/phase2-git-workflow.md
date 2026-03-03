# Phase 2: Cross-Review from Git Workflow Perspective

> Written by **git-workflow** | 2026-03-03
> Cross-reviewing: infra-ops, distributed-arch, dx-client, prompt-engineer, test-architect

---

## 1. Critique of Each Document

### 1.1 infra-ops.md -- Infrastructure & Docker

**What they got right:**
- "All state lives in git. The container is stateless/disposable." This is exactly correct and aligns perfectly with the git-as-state-store philosophy.
- Docker restart policy as the process management layer -- simple and correct.
- Minimal Dockerfile. No bloat.

**Where git will bite them:**

**Problem 1: The loop script uses `git pull --rebase` in a loop. This will silently rewrite local history.** If the agent has local commits (e.g., a status update) that haven't been pushed yet, a `git pull --rebase` will replay them on top of the remote's HEAD. This is usually fine, BUT: if the rebase produces a conflict, the script will hang or fail with no handling. The script shown has zero conflict handling.

```bash
# Their code (line ~275):
git pull --rebase
# What happens when this conflicts? The script dies with `set -euo pipefail`. Silently.
```

**Fix:** Use `git fetch origin && git rebase origin/main` with explicit conflict detection and recovery. Or better: `git pull --ff-only` which fails cleanly if fast-forward isn't possible.

**Problem 2: `git add -A` is dangerous.** The loop script does `git add -A && git commit -m "ralph: completed task ..."`. This stages EVERYTHING in the working directory, including any temp files, debug output, `.env` files Claude might have touched, etc. This is how secrets end up in git history.

**Fix:** Stage explicitly: `git add .ralph/tasks/ .ralph/status/` or use a whitelist of paths.

**Problem 3: SSH key mounting.** They mount `./ssh-keys:/home/ralph/.ssh:ro` which is correct, but there's no mention of `known_hosts`. The first `git push` will prompt "Are you sure you want to continue connecting (yes/no)?" and the headless script will hang. This is a classic gotcha.

**Fix:** Either pre-populate `known_hosts` with GitHub's host key or set `GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new"` in the environment.

**Problem 4: No mention of `.gitignore`.** The `.ralph/` directory will accumulate logs, temp files, Claude session data. Without a carefully maintained `.gitignore`, the repo will bloat fast.

**Overall:** Solid infrastructure thinking, but the git operations in the loop script are naive. They'll work for the happy path and fail catastrophically on the first conflict or unexpected file.

---

### 1.2 distributed-arch.md -- Distributed Systems & Task Queue

**What they got right:**
- File-per-task instead of shared queue file. This is the single most important decision for conflict avoidance. They nailed it.
- Directory-per-status with `git mv` as the state transition. Elegant and git-native.
- Deterministic pickup order. Critical for testability and debugging.
- Single worker first. YES. Thank you for not overdesigning.
- "Branch creation as atomic claim" for multi-worker scenarios. This is genuinely clever -- `git push origin task/<id>` will fail if the ref already exists.

**Where git will bite them:**

**Problem 1: `git mv` across directories IS a delete + create in git.** They say "A single commit with the `git mv` is atomic." This is true locally. But git doesn't track renames natively -- it infers them from content similarity. For small task files with similar content, git may misinterpret which file moved where when reviewing diffs. This is cosmetic, not functional, but it will confuse the user when reading `git log --follow`.

**Problem 2: Priority encoding in filenames creates rename noise.** Filenames like `100-task-20260303-001.md` embed priority. If priority changes, the file must be renamed. That's a `git mv` which pollutes history and breaks `git log --follow` tracking. Priority should live ONLY in frontmatter, not in the filename.

**Fix:** Use ID-only filenames: `task-20260303-001.md`. Sort by parsing frontmatter, not by filename.

**Problem 3: The directory-per-status approach creates a LOT of `git mv` operations.** Every state transition is a file move. A task goes through: pending -> in_progress -> review -> done. That's 3 renames in git history. Multiply by dozens of tasks and the git log becomes a sea of file moves. Compare to my Phase 1 proposal: status in a separate `.json` file, task definition stays put. Zero renames.

**Problem 4: Redundant status (directory + frontmatter) is a consistency timebomb.** They acknowledge this: "If they disagree, something went wrong and the system should halt." But HOW does the system halt? Who runs the validation script? When? If the answer is "the orchestrator checks on every poll," that's fine. If the answer is "someone runs it manually sometimes," that's a bug waiting to happen.

**Fix:** Pick one source of truth. I'd pick frontmatter (machine-parseable, no renames needed) and skip the directory-per-status entirely. Use a flat `.tasks/` directory and filter by `status` field. `ls` is slightly less convenient, but `grep -l 'status: "pending"' .tasks/*.md` is trivial.

**Problem 5: The `depends_on` resolution requires parsing ALL task files.** To check if task B's dependencies are met, you need to read and parse every task in `depends_on`, which means reading files from potentially different directories. This is O(n) per pickup attempt. Fine for 10 tasks, annoying for 100.

**Overall:** The strongest document from a git perspective. They clearly thought about atomicity, concurrency, and conflict avoidance. The directory-per-status approach is the main thing I'd push back on -- it's clever but creates unnecessary git noise. The rest is well-reasoned.

---

### 1.3 dx-client.md -- Developer Experience & Client Tooling

**What they got right:**
- Skills-based approach instead of a separate CLI. Smart -- the user already has Claude Code, don't add another tool.
- "All skills start with `git pull`" and "All skills end with `git push`." This is the right discipline.
- Cancel signal as a file (`tasks/signals/cancel-<id>`). Simple, git-native, elegant.
- The "Ideal User Workflow" section is excellent. It's the first document that tells a complete story from the user's perspective.

**Where git will bite them:**

**Problem 1: `status.json` as a shared state file is a merge conflict magnet.** They propose a single `status.json` at the repo root, updated by the node "after every significant action" and pushed to git. Meanwhile, the user is also pushing changes (new tasks, priority changes) to the same repo. Every push from the node that includes `status.json` is a potential conflict with ANY user push, because `status.json` changes every time.

This is exactly the "shared mutable file" antipattern I warned about in my Phase 1 document. Two writers, one file, zero coordination = guaranteed conflicts.

**Fix:** Don't put `status.json` in the git repo that the user also pushes to. Options:
- (a) The node writes status to a separate branch (e.g., `ralph/status`) that the user never pushes to. The user reads it with `git show ralph/status:status.json`.
- (b) Status lives per-task in the task file's frontmatter. No separate status file.
- (c) Status is a file the node commits to main, but the user NEVER touches it (strict ownership). This only works if the user never pushes changes at the same time the node pushes status.

I'd go with (b): status in frontmatter. It's already there. No extra file needed.

**Problem 2: `activity.log` is an append-only log committed to git.** This WILL cause merge conflicts. Two independent appends to the same file create a conflict in git (they're modifying the same region -- the end of the file). Even if the content doesn't overlap semantically, git sees two diffs touching adjacent lines and flags it.

**Fix:** Use date-based log files (`logs/2026-03-03.log`) that are only written by the node. The user never touches them. Conflicts are impossible because the user doesn't write to log files, and there's only one node.

Alternatively, don't commit logs to git at all. Keep them in the Docker container and access via `docker logs` or SSH. Logs are ephemeral by nature -- they don't belong in permanent git history.

**Problem 3: The review workflow involves merging branches.** `/ralph-review` skill merges the feature branch. But what if the user has local uncommitted changes? What if they're on a different branch? Merging in a skill is risky because it assumes a clean working state. Git merge can leave the user in a messy state (merge conflicts, unmerged paths) that Claude Code skills aren't equipped to resolve.

**Fix:** The review skill should check for clean working tree before merging. If not clean, tell the user to commit or stash first. OR: use `git merge --no-commit` to preview the merge, then let the user confirm.

**Problem 4: The pause/resume signal files.** Writing `tasks/signals/pause` and pushing it -- fine. But what if the push arrives while the node is mid-task? The node won't see the signal until it finishes the current task and polls again. This is a known limitation of polling, but the user might expect "pause" to mean "stop immediately." The skill should set expectations: "Pause requested. The node will stop after the current task completes."

**Overall:** Great user experience thinking. The skills approach is the right call. But the shared `status.json` and `activity.log` are git anti-patterns that will cause real merge conflicts in practice. These need to be rethought.

---

### 1.4 prompt-engineer.md -- Prompting & Agent Loop Design

**What they got right:**
- Template-based prompt construction. Clean separation of data (task YAML) from template (prompt structure).
- Explicit exit conditions with a verification step. "Never trust the model's 'I'm done'" -- correct.
- Per-task-type tool profiles with `--allowedTools`. Principle of least privilege.
- Session continuation for retries (`--resume`). Smart use of Claude Code's features.
- "Do NOT push. The orchestrator handles pushing." This is critical. The agent should NEVER push directly.

**Where git will bite them:**

**Problem 1: The orchestrator script does `git pull --rebase origin main` in the main loop.** Same problem as infra-ops. No conflict handling.

**Problem 2: The orchestrator creates a feature branch, marks the task as `in_progress` on main, then switches to the branch.** This is a race condition waiting to happen. Here's the sequence:

```
1. git pull --rebase origin main
2. yq -i '.status = "in_progress"' task.yaml    # modify on main
3. git commit -m "chore: start task-001"         # commit on main
4. git push                                       # push main
5. git checkout -b ralph/task-001                 # create branch
```

Between steps 4 and 5: if the push in step 4 fails (someone else pushed to main), the task is modified locally but not remotely. Now you have a dirty main branch, and creating the feature branch from it will carry the uncommitted state change into the wrong branch.

**Fix:** Claim the task by creating the branch first (branch creation as atomic claim, per distributed-arch's suggestion). Then update the task file on the branch, not on main. Status on main should only be updated AFTER the task is complete.

**Problem 3: `git add -A` in the commit step.** Same issue as infra-ops. The agent might create temp files, download dependencies, or touch files outside the task scope. Staging everything is dangerous.

**Problem 4: The script assumes `yq` is available.** This is a non-standard tool that needs to be installed in the Docker container. Minor, but it's an implicit dependency that infra-ops didn't include in their Dockerfile.

**Problem 5: The orchestrator script stores task files as `.yaml` while distributed-arch proposes `.md` with YAML frontmatter.** These two documents disagree on the task file format. This needs to be resolved.

**Overall:** Excellent prompt engineering thinking. The templates and tool profiles are well-designed. The git operations are the weakest part -- they've copied the same naive `git pull --rebase` / `git add -A` pattern that infra-ops uses, with the same problems.

---

### 1.5 test-architect.md -- Testing & Verification Strategy

**What they got right:**
- The "confidence ladder" is brilliant. Building from pure logic outward to infrastructure is exactly right.
- Local testing with bare repos. This is how you test git workflows without a remote. They understand this.
- Mock Claude Code as a replaceable binary. Simple and effective.
- The verification gates are thorough and practical.
- "If it doesn't work on your laptop, it won't work on a VPS." Amen.

**Where git will bite them:**

**Problem 1: The conflict path test is underspecified.** They describe "User modifies task while agent is working on it" but don't specify WHICH files conflict. The test needs to cover:
- (a) User creates a NEW task while agent pushes a status update (should NOT conflict)
- (b) User modifies the SAME task file the agent is updating (WILL conflict)
- (c) User pushes code changes while agent pushes to a different branch (should NOT conflict)

Scenario (a) is the common case and should work seamlessly. Scenario (b) is the pathological case that should be prevented by design (ownership boundaries). The test should verify that (a) works and that (b) is prevented or handled.

**Problem 2: They mention "file locking" for concurrent claims.** Git doesn't have file locking. `git lfs lock` exists but it's not relevant here. The concurrent claim test should use the "push and fail" pattern (first push wins) or the "branch creation as claim" pattern, not file locking.

**Problem 3: The e2e test expects `state: claimed` as an intermediate state.** This adds a state that distributed-arch doesn't have (they have `in_progress`). The test architect and the distributed systems architect need to agree on the state names. These inconsistencies will waste time during implementation.

**Problem 4: "Atomic writes (write temp file, rename); fsync" -- this is filesystem atomicity, not git atomicity.** The real atomicity boundary is the git commit. Writing a temp file and renaming it protects against a crash between write and commit, but in practice, git commit is the operation that matters. The distinction is worth noting in the tests.

**Problem 5: No test for the `known_hosts` issue.** Their Docker integration tests don't mention SSH configuration. The container needs to be able to `git push` via SSH, which means `known_hosts` must be set up. This should be a specific test: "container can push to a remote via SSH without interactive prompts."

**Overall:** The strongest testing strategy I've seen. The confidence ladder is the right framework. Minor issues with terminology alignment and a few underspecified test scenarios, but the overall approach is excellent.

---

## 2. Git Nightmare Rankings

Ranking from "best git citizen" to "most likely to create a merge conflict apocalypse":

### 1st Place: distributed-arch (Best)

They deeply understand git's concurrency model. File-per-task, directory-per-status, deterministic ordering, branch-as-claim -- all correct. Minor issues with filename-embedded priority and directory-per-status verbosity, but these are aesthetic, not correctness problems. **Score: 9/10.**

### 2nd Place: test-architect (Strong)

They understand that git workflows need to be tested with real git operations (bare repos, push/pull). The confidence ladder ensures git issues are caught early. Slight terminology misalignment with other documents, but solid git instincts. **Score: 8/10.**

### 3rd Place: dx-client (Mixed)

The skills workflow is user-friendly and git-native. BUT: `status.json` and `activity.log` as shared files on main are genuine conflict risks that will surface in production. The review/merge workflow needs guard rails. **Score: 6/10.**

### 4th Place: prompt-engineer (Concerning)

Good prompt engineering, but the orchestrator script's git operations are a copy-paste of common patterns without understanding the failure modes. `git pull --rebase` without conflict handling, `git add -A` without a whitelist, task status updated on main before branching -- these will cause real issues. **Score: 5/10.**

### 5th Place: infra-ops (Needs Work)

The infrastructure is solid (Docker, Hetzner, restart policies), but the git operations in the loop script are dangerously naive. No conflict handling, `git add -A`, no `known_hosts`, no `.gitignore` strategy. The script will work on day 1 and break on day 3 when the first unexpected file appears. **Score: 4/10.**

---

## 3. Proposed High-Level Architecture (Synthesized)

Taking the best ideas from everyone and fixing the git problems:

### 3.1 Repository Structure

Single repo (infra-ops and my Phase 1 agree). `.ralph/` directory for task management.

```
project-root/
  .ralph/
    tasks/                        # Task definitions (Markdown + YAML frontmatter)
      task-20260303-001.md        # Flat directory. No subdirectories per status.
      task-20260303-002.md
    config.json                   # Ralph configuration (poll interval, model, etc.)
    templates/                    # Prompt templates by task type (from prompt-engineer)
      bugfix.md
      feature.md
      refactor.md
    ralph-system.md               # Agent system prompt (from prompt-engineer)
  .gitignore                      # Excludes .ralph/logs/, .ralph/tmp/, .env
  src/
    ...project code...
```

### 3.2 Key Design Decisions (with rationale)

**Decision 1: Flat task directory with status in frontmatter (INSTEAD OF directory-per-status)**

Distributed-arch's directory-per-status is elegant but creates too much `git mv` noise. A flat directory with status in frontmatter is simpler:
- No file renames ever. Fewer confusing diffs.
- Status queries: `grep -l 'status: pending' .ralph/tasks/*.md` (trivial)
- `git log --follow` works perfectly (file never moves)
- One source of truth (frontmatter), not two (frontmatter + directory)

**Decision 2: Task branches for code changes. Status updates on main.**

Combining my Phase 1 proposal with prompt-engineer's branching:
- Agent creates `ralph/<task-id>` branch for code changes
- Agent updates task frontmatter on main (status: pending -> in_progress -> done/failed)
- Status updates on main only touch `.ralph/tasks/<id>.md` -- files the user never edits
- User creates new task files on main -- files the agent never edits
- Code changes are isolated on branches until merge

**Decision 3: No `status.json`, no `activity.log` committed to git**

Contra dx-client:
- Status lives in task frontmatter. One place, not two.
- Activity logging goes to Docker container logs (`docker logs ralph`), not git. Logs are ephemeral and don't belong in permanent history.
- Node health is tracked by the freshness of the last status-update commit: `git log -1 --format=%ci --grep="ralph("`.

**Decision 4: Explicit `git add` with path whitelist, never `git add -A`**

```bash
# Good:
git add .ralph/tasks/task-20260303-001.md
git commit -m "ralph(task-20260303-001): pickup"

# BAD:
git add -A
git commit -m "ralph: stuff"
```

**Decision 5: `git pull --ff-only` instead of `git pull --rebase`**

If fast-forward isn't possible, something unexpected happened. Fail cleanly and let the orchestrator handle it, rather than silently rebasing.

```bash
git fetch origin
git merge --ff-only origin/main || {
  echo "Cannot fast-forward. Possible conflict."
  # Handle: retry, skip, or alert
}
```

**Decision 6: Polling with `git fetch --dry-run` optimization**

From my Phase 1 proposal. Don't scan tasks if nothing changed:

```bash
# Check if remote has new commits
LOCAL=$(git rev-parse HEAD)
git fetch origin
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  sleep "$POLL_INTERVAL"
  continue
fi
git merge --ff-only origin/main
# Now scan for tasks
```

**Decision 7: Claim by branch creation (from distributed-arch)**

Creating the branch is the atomic claim. No need to modify the task file first:

```bash
# Claim: create and push the branch
git checkout -b ralph/task-20260303-001 origin/main
git push origin ralph/task-20260303-001
# If push fails, branch already exists (someone else claimed). Pick next task.
```

After successful branch push, update task status on main:

```bash
git checkout main
# Update frontmatter: status -> in_progress, assigned_to -> ralph-1
git add .ralph/tasks/task-20260303-001.md
git commit -m "ralph(task-20260303-001): pickup - Claimed by ralph-1"
git push origin main
```

**Decision 8: Task file format: Markdown + YAML frontmatter (from distributed-arch + dx-client)**

Both agree on this and they're right. Resolves the disagreement with prompt-engineer's `.yaml` format:

```markdown
---
id: task-20260303-001
title: Fix auth null check
status: pending
type: bugfix
priority: 100
created_at: "2026-03-03T10:00:00Z"
author: avanwieringen
depends_on: []
max_retries: 2
retry_count: 0
---

## Description
The authenticate() function crashes when user.email is None.

## Acceptance Criteria
- authenticate() returns AuthError when user.email is None
- All existing tests pass
- New test covers the null email case
```

### 3.3 Complete Task Lifecycle

```
USER (laptop)                     GIT REMOTE                     NODE (VPS)

1. Creates task-001.md
   status: pending
   git push ───────────────────> origin/main updated

                                                      2. git fetch (poll)
                                                         Detects new commit
                                                         git merge --ff-only
                                                         Finds task-001 pending

                                                      3. git checkout -b ralph/task-001
                                                         git push origin ralph/task-001
                                                         (branch = claim)

                                                      4. git checkout main
                                                         Update task-001.md:
                                                           status: in_progress
                                                           assigned_to: ralph-1
                                                           started_at: ...
                                                         git push origin main

                                                      5. git checkout ralph/task-001
                                                         claude -p "$PROMPT" ...
                                                         (agent works on code)
                                                         Periodic: git push origin ralph/task-001

                                                      6. Tests pass? Yes.
                                                         git checkout main
                                                         Update task-001.md:
                                                           status: review
                                                           completed_at: ...
                                                           branch: ralph/task-001
                                                         git push origin main

7. git pull
   Sees task-001 in review
   /ralph-review
   git diff main...ralph/task-001

8. Approves:
   git merge ralph/task-001
   Update task-001.md:
     status: done
   git push ───────────────────> origin/main updated

   OR Rejects:
   Appends review feedback
   Update task-001.md:
     status: pending
     retry_count += 1
   git push ───────────────────> origin/main updated

                                                      9. Back to step 2.
```

### 3.4 Infrastructure (from infra-ops, with git fixes)

- **VPS:** Hetzner CX22 (4GB RAM, ~EUR 4.5/mo) -- agreed
- **Container:** Minimal Dockerfile with Node 20, git, jq, `openssh-client` -- agreed, but add `known_hosts` setup:
  ```dockerfile
  RUN mkdir -p /home/ralph/.ssh && ssh-keyscan github.com >> /home/ralph/.ssh/known_hosts
  ```
- **Process management:** Docker restart: unless-stopped + bash loop -- agreed
- **Networking:** Outbound HTTPS only (Anthropic API + GitHub) -- agreed

### 3.5 Testing Strategy (from test-architect, with alignment fixes)

The confidence ladder is the right approach. Adjustments:
- Use consistent state names across all documents: `pending`, `in_progress`, `review`, `done`, `failed`
- Replace "file locking" in tests with "branch push as claim" pattern
- Add explicit test for SSH `known_hosts` in Docker integration tests
- Add test for `git add -A` prevention (verify that only whitelisted paths are staged)

### 3.6 Client Skills (from dx-client, with fixes)

Keep the skills-based approach. Remove `status.json` and `activity.log` from git. Replace with:
- `/ralph-status` reads task files + git log: `git log --oneline --grep="ralph(" -10`
- Health check: "last ralph commit was X minutes ago" (derived from git log, not a separate file)
- Activity timeline: derived from commit messages (this is why the commit convention matters)

---

## 4. Unresolved Disagreements That Need Resolution

| Topic | distributed-arch says | dx-client says | prompt-engineer says | My recommendation |
|-------|----------------------|----------------|---------------------|-------------------|
| Task file format | `.md` with YAML frontmatter | `.md` with YAML frontmatter | `.yaml` files | `.md` with YAML frontmatter |
| Status tracking | Directory per status | Directory per status + `status.json` | Frontmatter field | Frontmatter field only |
| Task directory name | `.tasks/` | `tasks/` | `tasks/` | `.ralph/tasks/` (hidden, namespaced) |
| State names | pending, in_progress, review, done, failed | backlog, active, review, done, failed | pending, in_progress, completed, failed | pending, in_progress, review, done, failed |
| Activity logging | Not addressed | `activity.log` in git | `ralph-log.jsonl` in git | Docker logs only, NOT in git |
| Node status | Not addressed | `status.json` in git | Not addressed | Derived from git log + task frontmatter |
| Orchestrator language | Not specified | N/A (client-side) | Bash (V1), Python (V2) | Bash (V1), TypeScript/Bun (V2) per test-architect |

---

## 5. Summary: What I'd Change from Each Document

| Document | Keep | Change |
|----------|------|--------|
| **infra-ops** | Docker strategy, Hetzner, restart policies | Fix loop script git operations; add `known_hosts`; add `.gitignore`; replace `git add -A` |
| **distributed-arch** | File-per-task, deterministic pickup, branch-as-claim, single worker first | Drop directory-per-status; drop priority in filename; pick single source of truth for status |
| **dx-client** | Skills-based UX, cancel signals, pause/resume, ideal workflow narrative | Remove `status.json` from git; remove `activity.log` from git; add clean-tree check before merge |
| **prompt-engineer** | Templates, tool profiles, exit conditions, verification step, system prompt design | Fix orchestrator git operations; align on `.md` task format; separate claiming from status update |
| **test-architect** | Confidence ladder, local bare repos, mock strategies, verification gates | Align state names; replace file locking with branch-as-claim; add SSH/known_hosts test |
