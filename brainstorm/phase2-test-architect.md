# Phase 2: Cross-Review from the Testing & Verification Perspective

> **test-architect** reviewing all Phase 1 brainstorm documents.
> Question asked of every proposal: "Can I prove this works before shipping it?"

---

## 1. Document-by-Document Critique

### 1.1 infra-ops.md — Infrastructure & Docker

**What's good:**
- Clean separation of concerns: the container is stateless, git is the state store. This is inherently testable because you can spin up a fresh container and verify it reconverges.
- Docker `restart: unless-stopped` is the right choice. Simple, testable, observable.
- Minimal Dockerfile (Option B) is correct. The official devcontainer has too much ceremony for headless work.
- Health check via `pgrep` is the right starting point.

**What's untestable or hand-wavy:**

1. **The `ralph-loop.sh` script is pure pseudocode with no error handling.** The `find_next_task` and `mark_task_complete` functions are referenced but never defined. This is the most critical piece of the system and it's a TODO inside a TODO. You can't test what doesn't exist yet.

2. **`git add -A` in the loop script is a landmine.** This stages EVERYTHING, including temporary files, debug output, `.env` files that accidentally ended up in the workspace. Zero tests will catch this because nobody thinks to test "what if a `.env` file exists in the workspace during a task?" This needs to be `git add` with an explicit file list, and there needs to be a test for "unexpected files are NOT committed."

3. **No verification step after Claude Code execution.** The loop goes straight from `claude -p` to `git commit + push`. There's no test run, no build check, no lint. The agent could produce completely broken code and it would get pushed to the remote. prompt-engineer calls this out correctly, but infra-ops ignores it entirely.

4. **SSH key management is described but not testable.** "Mount as read-only volume" is one sentence. How do you verify the key has the right permissions? How do you test that git can actually authenticate? There needs to be a startup health check: "can I `git ls-remote origin`?" before the loop starts.

5. **Network restriction (iptables) is mentioned as "Option A" but no concrete rules are given.** You can't test "the container can only reach api.anthropic.com and github.com" without actual iptables rules to test against. This is a security-critical feature left as an exercise for the reader.

6. **The health check (`pgrep -f ralph-loop`) only tells you the process exists, not that it's functioning.** The script could be stuck in an infinite retry loop, or blocked on a git push that will never succeed, and `pgrep` would say "healthy." The heartbeat file approach from my Phase 1 doc is more reliable.

**Verdict:** Solid infrastructure thinking, but the actual runtime behavior (the loop script) is dangerously under-specified. The Docker/VPS choices are sensible and testable. The loop script is not.

---

### 1.2 distributed-arch.md — Task Queue & State Machine

**What's good:**
- Directory-per-status is brilliant for testability. `ls .tasks/pending/` is the simplest possible "query" and you can write assertions against it trivially.
- The state machine is well-defined with clear transitions. Every transition is testable as a pure function.
- Single worker recommendation for Phase 1 is correct. Multi-worker coordination over git is a nightmare and they correctly defer it.
- Deterministic pickup algorithm (priority ASC, created_at ASC, id ASC) is testable and predictable.
- Failure artifacts (appending failure logs to the task file) are a great audit trail.

**What's untestable or has hidden dependencies:**

1. **"Status = directory" redundancy is described but the consistency check is a bash script afterthought.** This should be a first-class invariant with a test suite, not a script you might run sometimes. If the frontmatter says `pending` but the file is in `done/`, the system is corrupt. This needs to be checked on every state transition, not as a periodic audit. **Proposed test:** After every `git mv`, parse the file and assert `status` matches the directory name.

2. **`git mv` as atomic state transition — but what if the process crashes between `git mv` and `git commit`?** The working tree is now in an inconsistent state. On restart, the file is in the wrong directory but uncommitted. The crash recovery section mentions `claimed_at` timeout-based recovery, but doesn't address the simpler case: "working tree is dirty on startup." **There needs to be a startup check:** "Is the working tree clean? If not, `git checkout -- .` to reset to last committed state."

3. **The `depends_on` cycle detection algorithm is described but there's no mention of when it runs.** A pre-commit hook? A validation at task creation time? If it only runs when the worker picks up a task, you've already committed a cycle to git and every other consumer of the repo sees broken data. **This must run at creation time with a test suite covering cycle scenarios.**

4. **The file naming convention (`100-task-20260303-001.md`) embeds priority in the filename.** What happens when priority changes? Do you rename the file? That changes the git history tracking (`git log --follow` handles renames, but it's fragile). The priority-in-filename is described as "an optimization" but it creates a coupling between filename and metadata that will cause bugs. **Test case that will fail:** "Change task priority, verify it's picked up in the correct order." If you forget to rename the file, the `ls | sort` order is wrong.

5. **No mention of how task file parsing errors are handled.** What if someone commits a malformed YAML frontmatter? Does the worker crash? Skip the task? Log an error? **There must be a test:** "Malformed task file in `pending/` does not crash the worker."

**Verdict:** Best-designed component across all documents. The state machine is clean, testable, and well-reasoned. The sharp edges are manageable but need explicit test coverage for the crash recovery and consistency invariants.

---

### 1.3 git-workflow.md — Git Workflow & Synchronization

**What's good:**
- Ownership boundaries (Rule 1) are the single most important design decision for testability. If the user and agent never edit the same files, you eliminate the hardest-to-test scenario (merge conflicts).
- File-per-task (Rule 5) is correct and testable.
- Commit conventions are machine-parseable, which means you can write tests that assert on git log output.
- The honest assessment of git's limitations as a state store is appreciated.

**What's untestable or problematic:**

1. **Task branches (Option A) are recommended, but the interaction between task branches and status updates on main is complex.** The workflow is: claim task on main -> create branch -> work on branch -> update status on main -> push both. This means the worker is juggling two branches during every task. **How do you test this?** You need a test that simulates the full branch dance: checkout main, update status, checkout branch, work, checkout main again, update status, push both. Every `git checkout` is a potential failure point. This is the most fragile part of the design and it has no test coverage proposed.

2. **"The agent never force-pushes" (Rule 4) is stated as a rule but has no enforcement mechanism.** Rules without enforcement are wishes, not rules. **This needs a git hook or a wrapper around `git push` that rejects `--force`.** And a test: "Attempt `git push --force` through the wrapper, verify it's rejected."

3. **The JSON-per-task + Markdown description approach (section 8) splits each task into two files: `001.json` (status) + `001.md` (description).** This doubles the number of files and creates a coupling: what if `001.json` exists but `001.md` doesn't? Or vice versa? **There needs to be a validation test:** "Every `.json` file has a corresponding `.md` file and vice versa." This is unnecessary complexity — distributed-arch's single-file approach (YAML frontmatter + markdown body) is simpler and avoids this pairing problem entirely.

4. **Polling with `git fetch --dry-run` is described but the "smart polling" (exponential backoff) has no specification.** What triggers the transition from 15s to 60s? What resets it? This is a state machine inside the polling loop that needs its own tests. Without a specification, every implementation will behave differently and be untestable.

5. **The "user rejects task" workflow writes to `.ralph/tasks/003.json` directly.** But this is the agent's file per the ownership boundaries (Rule 1). The user is now editing a file that the agent also edits. This violates the most important rule in the document. **The rejection signal should be a separate file** (e.g., `.ralph/feedback/003-rejection.md`) that the agent reads, not an edit to the status file.

6. **Section 10 "Complete Proposed Workflow" shows `jq` transformations on JSON files.** `jq '.status = "running" | .started = now'` — the `now` function doesn't exist in standard `jq`. This would silently produce `null`. **A test would have caught this immediately.** This is exactly the kind of bug that ships when you write pseudocode without running it.

**Verdict:** Good principles, but the implementation details have contradictions (ownership boundaries violated by the rejection flow) and bugs (jq syntax). The branch-juggling workflow is the riskiest part and needs the most testing. The two-file-per-task approach disagrees with distributed-arch's single-file approach — this needs to be resolved.

---

### 1.4 dx-client.md — Developer Experience & Client Tooling

**What's good:**
- Using Claude Code skills as the CLI is clever and avoids building a separate tool. Zero new dependencies for the user.
- The ideal workflow (section 7) is the most compelling vision across all documents. It makes the system feel real.
- Multi-layer status (git-based → skill → activity log → SSH) is well-ordered.
- "All skills start with `git pull` and end with `git push`" is a great principle.

**What's untestable or concerning:**

1. **Skills are inherently untestable.** A SKILL.md file is natural language instructions for Claude Code. You cannot unit test it. You cannot integration test it. You can only run it with real Claude Code (or a mock that might not behave the same). **This is the biggest testability gap in the entire system.** Every other component can be tested deterministically; the skills cannot.

2. **The `/ralph-backlog` skill "breaks a feature into 2-7 tasks with dependencies."** The output of this decomposition is non-deterministic (LLM generates it). How do you test that the decomposition is valid? That dependencies are acyclic? That task IDs are unique? **You need a post-generation validation step** that runs after the skill creates task files, checking all structural invariants. This validation IS testable, even if the generation isn't.

3. **`status.json` as the heartbeat mechanism means the node must push to git every 2-3 minutes.** That's 20-30 pushes per hour. Each push is a network operation that can fail. Over 24 hours, that's 480-720 git commits just for heartbeats. **This will bloat the git history.** Have you tested what `git clone` performance looks like after a month of 720 heartbeat commits per day? That's 21,600 commits/month of noise. The heartbeat should NOT be committed to git. Use a separate mechanism (a file on the VPS that's readable via SSH or a simple HTTP endpoint).

4. **Cancel signals (`tasks/signals/cancel-<task-id>`) assume the agent checks for signals between phases.** But Claude Code doesn't have "phases" that the orchestrator can intercept — once you run `claude -p`, it runs to completion (or until `--max-turns`/`--max-budget-usd`). **You cannot cancel a running Claude Code invocation mid-task via a git signal.** You'd have to `kill` the process. The cancel signal can only prevent the NEXT task from being picked up, not stop the current one.

5. **The directory names differ from distributed-arch.** dx-client uses `backlog/active/review/done/failed`. distributed-arch uses `pending/in_progress/review/done/failed`. git-workflow uses `.ralph/tasks/` with JSON status files. **Three different approaches across three documents.** This is exactly the kind of inconsistency that makes integration testing impossible because there's no agreed-upon interface. This MUST be resolved before any code is written.

6. **No mention of testing any of the skills.** Not even a "here's how you'd verify `/ralph-status` works." The skills are the entire user-facing surface area and they have zero test strategy.

**Verdict:** Best vision for user experience, but the testability story is the weakest of all documents. Skills are a black box. The heartbeat mechanism will create a git pollution problem. The cancel signal won't work as described.

---

### 1.5 prompt-engineer.md — Prompt Engineering & Agent Loop Design

**What's good:**
- The most thorough analysis of Claude Code CLI capabilities. This is essential reference material.
- Template-based prompt construction is the right approach. Templates are testable (interpolation is a pure function), even if the LLM output isn't.
- Exit condition matrix is comprehensive and well-categorized.
- Per-task-type tool profiles are an excellent security/testability boundary.
- Post-execution verification step is correctly identified as critical.
- The honesty about reproducibility: "LLMs are not deterministic. And that's okay."

**What's untestable or risky:**

1. **The task-to-prompt pipeline has 6 stages, but stages 3-5 reference tools/formats not yet decided.** Stage 3 says "envsubst, mustache, or even sed." This indecision means you can't write tests yet. Pick one and test it. (Recommendation: simple string replacement in TypeScript. No template engine dependency needed for `{{variable}}` substitution.)

2. **The verification step (`verify_task()`) runs `npm test`, `npm run build`, and `npm run lint`.** But what if the project doesn't use npm? What if it uses bun? Or python? **The verification commands need to come from the task definition or from CLAUDE.md**, not be hardcoded. And there needs to be a test: "Verification uses the correct commands for the project."

3. **The retry-with-session-continuation (`--resume $SESSION_ID`) is elegant but untestable with mocks.** A mock Claude Code won't have session state to resume. **This feature can only be tested with real Claude Code**, which makes it the last thing to implement, not an early feature. It should be explicitly deferred to after the basic loop works.

4. **The "auto-accept" matrix (section 5) has conditions like "diff < 50 lines" and "no API changes."** How do you determine "no API changes" programmatically? That's a semantic judgment, not a syntactic one. **Either define it precisely (e.g., "no changes to files in `src/api/`") or drop the condition.** Vague conditions produce untestable logic.

5. **YAML task definitions reference `type: "bugfix"` but the task types map to templates.** What if someone creates a task with `type: "migration"`? There's no template for it. **There needs to be validation:** "Task type must be one of [bugfix, feature, refactor, research, test, review]" with a test for unknown types.

6. **The orchestration script skeleton uses `yq` for YAML parsing.** That's an external dependency not mentioned anywhere in infra-ops's Dockerfile. **Will `yq` be in the container?** These cross-document dependency gaps are exactly what integration testing would catch — if we had integration tests that span documents.

**Verdict:** Most thorough technical analysis. The prompt construction pipeline is well-structured and testable at each stage. The sharp edges are mostly about undefined dependencies (which project commands to run, which template engine, where does `yq` come from) that would surface immediately in integration testing.

---

## 2. Cross-Cutting Issues (Things Nobody Addressed)

### 2.1 No Agreed-Upon Interface Contract

The five documents describe the same system but disagree on fundamental interfaces:

| Aspect | distributed-arch | git-workflow | dx-client | prompt-engineer |
|--------|-----------------|--------------|-----------|-----------------|
| Task format | Single `.md` with YAML frontmatter | `.json` + `.md` pair | Single `.md` with YAML frontmatter | `.yaml` file |
| Task directory | `.tasks/` | `.ralph/tasks/` | `tasks/` | `tasks/` |
| Status directories | `pending/in_progress/review/done/failed` | N/A (status in JSON) | `backlog/active/review/done/failed` | Status in YAML field |
| State names | pending, in_progress, review, done, failed | pending, running, done, failed, rejected | backlog, active, review, done, failed | pending, in_progress, passed, failed, retry |

**You cannot write integration tests when the interfaces are undefined.** Step zero before any code is written: agree on the task file format, directory structure, state names, and directory layout. One source of truth. Everything else flows from this.

### 2.2 No Error Propagation Strategy

What happens when `git push` fails? Every document says "retry" or "log it," but nobody defines:
- How many retries?
- What's the backoff?
- What state is the task in during retries?
- What if the retry also fails?
- Who gets notified?

This needs a test: "git push fails 3 times in a row → task is marked failed → user can see it on next pull." Without this test, the system will silently lose work.

### 2.3 No Startup / Shutdown Protocol

Nobody defines what happens when the container starts or stops:
- **Startup:** Is the working tree clean? Is git configured correctly? Can we reach the remote? Can we authenticate? Is there a stale `in_progress` task from a previous crash?
- **Shutdown (SIGTERM):** Do we finish the current task? Do we abandon it? Do we push partial progress?

These are testable scenarios that everyone skipped.

### 2.4 No Data Migration Strategy

What happens when we change the task file format? Add a new required field? Change state names? Every task file in the repo needs to be updated. Nobody mentions schema versioning or migration.

---

## 3. Proposed Architecture (Testing-Optimized)

Based on reading all five documents, here's the architecture I'd build, optimized for testability at every layer:

### 3.1 Single Source of Truth: Task File Format

One file per task. No JSON+MD pairs. No separate status directory tracking.

```markdown
---
id: "task-20260303-001"
title: "Add rate limiting to API"
status: "pending"         # pending | claimed | running | done | failed | review
priority: 100             # lower = higher priority
created: "2026-03-03T10:00:00Z"
updated: "2026-03-03T10:00:00Z"
assigned_to: null
depends_on: []
type: "feature"           # bugfix | feature | refactor | research | test
retry_count: 0
max_retries: 2
---

## Description
(markdown body — the actual task prompt for Claude Code)

## Acceptance Criteria
- [ ] Rate limiter implemented
- [ ] Tests pass
```

**Why single file:** It eliminates the pairing problem (JSON+MD) and the redundancy problem (status in file vs. directory name). The file IS the truth. Period.

### 3.2 Directory Structure

```
.ralph/
  tasks/
    pending/          # ready for pickup
    claimed/          # worker has claimed but not started execution
    running/          # Claude Code is executing
    review/           # completed, needs human review
    done/             # approved
    failed/           # permanently failed
  templates/          # prompt templates by task type
  config.json         # ralph configuration (poll interval, model, etc.)
  logs/               # execution logs (gitignored if large)
  heartbeat.json      # NOT committed to git. Read via SSH or API.
```

**Status = directory.** Moving a file IS the state transition. No redundant status field in frontmatter needed (but keep it for human readability; validate consistency as an invariant).

**Heartbeat is NOT in git.** It's a local file on the VPS, readable via `ssh user@vps cat .ralph/heartbeat.json`. This eliminates the git history pollution problem.

### 3.3 Testable Layers

```
Layer 0: Task parser           (pure function, unit testable)
Layer 1: State machine         (pure function, unit testable)
Layer 2: Task queue            (file I/O, testable with temp dirs)
Layer 3: Prompt builder        (pure function, unit testable)
Layer 4: Git operations        (integration testable with local bare repos)
Layer 5: Agent executor        (testable with mock Claude Code)
Layer 6: Orchestrator loop     (e2e testable locally)
Layer 7: Docker container      (testable on dev machine)
Layer 8: VPS deployment        (smoke testable)
```

Every layer has a test suite that proves it works before the next layer is built. No skipping.

### 3.4 Key Design Decisions (Testing-Driven)

1. **Single worker, single branch for status updates.** Task branches for code changes. Status updates happen on a dedicated `ralph/status` branch that only the worker writes to — never touches main. User creates tasks on main. No ownership boundary violations.

2. **Heartbeat is NOT git-committed.** Written to a local file. Accessible via `ralph-status` skill that SSHes in, or simply not checked until the user notices no progress. Git history stays clean.

3. **No skills in V1 for the critical path.** Skills are untestable black boxes. The V1 user interface is: "Create a markdown file in `.ralph/tasks/pending/`, commit, push." Skills are quality-of-life additions for V2 after the core loop is proven.

4. **Verification is mandatory.** The orchestrator MUST run `test` + `build` commands after every Claude Code execution. Commands come from `.ralph/config.json`, not hardcoded. Testable.

5. **Startup health check.** Before the loop starts: verify git auth, verify clean working tree, recover stale tasks. Testable.

6. **Explicit file staging.** Never `git add -A`. Always `git add` specific files. Testable: "unexpected files are not staged."

---

## 4. Agent Rankings (Testability Report Card)

### Rank 1: distributed-arch (A-)

**Best testability story.** The state machine is clean, deterministic, and unit-testable. Directory-per-status makes assertions trivial. Deterministic pickup algorithm is predictable and testable. Single-worker recommendation eliminates concurrency testing entirely. Only loses points for: crash recovery gaps, filename-priority coupling, and no malformed-input handling.

### Rank 2: prompt-engineer (B+)

**Strong testability for prompt construction.** The template pipeline is well-structured with testable stages. Exit conditions are enumerated and each can be tested. Tool profiles per task type are a testable security boundary. Loses points for: undecided template engine, hardcoded verification commands, and cross-document dependency gaps (`yq` not in Dockerfile).

### Rank 3: infra-ops (B)

**Good infrastructure testability, weak runtime testability.** Docker choices are sound and testable (does it build? does it start? does the health check pass?). VPS recommendations are practical. Loses significant points for: the loop script being pseudocode with no error handling, `git add -A`, no verification step, and SSH key testing gaps.

### Rank 4: git-workflow (B-)

**Good principles, implementation contradictions.** Ownership boundaries are the most important testability principle in the system. File-per-task is correct. Commit conventions are parseable. Loses points for: contradicting its own ownership rules in the rejection flow, broken `jq` syntax that would fail a test, two-file-per-task complexity, and undefined smart polling behavior.

### Rank 5: dx-client (C+)

**Best UX vision, worst testability.** The user workflow is compelling and makes the product real. But skills are untestable black boxes. The heartbeat-in-git approach will create performance problems. The cancel signal won't work as described. Three fundamental interface decisions (directory names, state names, task format) disagree with other documents. This document needs a testability pass more than any other.

---

## 5. The Verification Ladder (Revised, Incorporating All Documents)

### Step 0: Agree on Interfaces
- Finalize task file format (single file, YAML frontmatter + markdown)
- Finalize directory structure (`.ralph/tasks/{status}/`)
- Finalize state names (`pending`, `claimed`, `running`, `review`, `done`, `failed`)
- Finalize config format (`.ralph/config.json`)
- **Gate:** Interface document exists and all agents agree.

### Step 1: Task Parser + State Machine
- Parse task files into typed objects (from distributed-arch's format)
- Implement state transitions with guards
- **Gate:** 20+ unit tests pass covering valid/invalid parsing and all transitions.

### Step 2: Task Queue + Prompt Builder
- Directory scanner with priority sorting (from distributed-arch's pickup algorithm)
- Template interpolation for prompt construction (from prompt-engineer's pipeline)
- **Gate:** 15+ tests covering queue operations and prompt generation.

### Step 3: Git Operations
- Pull, commit, push with error handling
- Local bare repo fixtures for testing
- Conflict detection and recovery
- Working tree cleanup on startup
- **Gate:** Integration tests pass using local bare repos. No network required.

### Step 4: Agent Executor
- Mock Claude Code (bash script stub)
- Execute → capture output → parse result
- Post-execution verification (test + build commands from config)
- **Gate:** Executor tests pass with mock. Success, failure, and timeout paths covered.

### Step 5: Orchestrator Loop
- Full cycle: pull → scan → claim → execute → verify → commit → push
- Error handling: failed execution, failed push, empty queue
- Graceful shutdown (SIGTERM)
- Startup health check
- **Gate:** E2E test passes locally. Task goes pending → claimed → running → done. Result visible in "laptop" clone.

### Step 6: Docker Container
- Dockerfile builds, container starts, loop runs
- Volume mounts for git credentials
- Health check works
- Log output is structured JSON
- **Gate:** Same E2E test passes inside Docker.

### Step 7: Real Claude Code (Local)
- Swap mock for real Claude Code with trivial task
- Verify round-trip works
- **Gate:** Real task completes. Cost < $0.10.

### Step 8: Skills (V2, Optional)
- `/ralph-task`, `/ralph-status`, `/ralph-review` skills
- These are convenience layers, not critical path
- **Gate:** Manual verification only (skills are untestable).

### Step 9: VPS Deployment
- Provision, deploy, verify
- Resilience testing (reboot, crash, network interruption)
- **Gate:** Task round-trip works: laptop → git → VPS → git → laptop.

---

## 6. Final Recommendations

1. **Resolve the interface contract BEFORE writing any code.** The disagreements between documents are the #1 risk. Pick one format and stick to it.

2. **Don't commit heartbeats to git.** dx-client's approach will create 21,600+ noise commits per month. Use a file-on-disk readable via SSH.

3. **Don't rely on skills for V1.** They're untestable. The core loop must work with manual file creation. Skills are a V2 convenience layer.

4. **Never `git add -A`.** Explicit file staging with tests proving unexpected files are excluded.

5. **The orchestrator loop script is the single most important file in the system** and it's currently pseudocode across 3 different documents. It needs to be one real, tested implementation.

6. **Startup health checks are non-negotiable.** Verify git auth, clean working tree, and stale task recovery before entering the main loop.

7. **Post-execution verification is non-negotiable.** Never push unverified code. prompt-engineer got this right; infra-ops got this wrong.

8. **The test suite must run in under 4 minutes.** Unit (5s) + integration (30s) + e2e (60s) + Docker (120s). Fast tests enable fast iteration. If the suite is slow, developers will skip it.
