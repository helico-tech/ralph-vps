# Phase 2: Cross-Review from Developer Experience Perspective

> **dx-client** | Critique, synthesis, and architecture proposal

---

## 1. Document-by-Document Critique

### infra-ops.md -- Infrastructure & Docker

**What's good:**
- The VPS comparison matrix is genuinely useful. Honest about the Hetzner vs DigitalOcean tradeoff.
- The Dockerfile is lean and correct. No Kubernetes nonsense.
- Recognizing that `--dangerously-skip-permissions` demands a sandboxed container -- critical insight.
- Docker restart policy instead of systemd-inside-Docker -- correct call.
- Cost estimates are realistic and helpful for a user deciding whether to invest.

**Where the UX is going to suck:**

1. **The deployment flow is still 6 SSH-heavy steps.** "SSH in, clone repo, configure .env, docker compose up." For a user who's "not very knowledgeable about Linux," this is a wall. They'll get stuck on SSH key setup, `.env` file creation, or Docker permissions. We need a `./setup-vps.sh <ip-address>` one-liner that SSHes in and does everything.

2. **No mention of how the user recovers from a broken state.** Container won't start? `.env` has a typo? Docker needs a restart? The doc covers happy path infrastructure but doesn't address "I SSH'd in and nothing works, now what?" We need a troubleshooting section or, better, a `ralph doctor` diagnostic command.

3. **The introspection model is `ssh <vps> docker logs -f ralph-loop`.** That's fine for a developer who lives in terminals, but it's a context switch from the user's laptop workflow. The user was just in Claude Code doing `/ralph-status`. Now you're asking them to SSH into a VPS and read Docker logs? That's a jarring break in flow.

4. **The `ralph-loop.sh` script uses `git add -A`.** This will commit EVERYTHING, including temporary files, `.claude/` state, node_modules detritus -- whatever garbage the agent leaves behind. Needs explicit staging or a tight `.gitignore`.

5. **API key vs subscription recommendation is good but buries the lead.** The user's first question will be "how much will this cost me?" That should be front and center, not in section 8.

**Score: 7/10** -- Solid infrastructure thinking but optimized for infra engineers, not end users.

---

### distributed-arch.md -- Distributed Systems & Task Queue

**What's good:**
- The directory-per-status design is the right call. `ls .tasks/pending/` beats parsing YAML every time.
- Priority encoding in filenames (`100-task-foo.md`) is clever and practical.
- Starting with a single worker and explicitly deferring multi-worker complexity -- exactly right.
- The commit convention (`task(<id>): <action>`) makes `git log` actually useful.
- Double-write prevention (directory + frontmatter) with a consistency checker -- defense in depth without over-engineering.
- The "branch creation as atomic claim" pattern for future multi-worker is elegant.

**Where the UX is going to suck:**

1. **The task format has 11 fields in the frontmatter.** Eleven. Including `retry_count`, `max_retries`, `assigned_to`, `group`, and `tags`. A user creating a task doesn't want to think about retry semantics. Most of these should be system-managed with sensible defaults, not user-specified. When the user runs `/ralph-task "add rate limiting"`, they should specify: title, description, maybe priority. That's it. The system fills in the rest.

2. **The `depends_on` + cycle detection + DAG scheduling section is overkill for Phase 1.** The doc says "linear dependencies only for Phase 1" but then spends 60 lines on cycle detection algorithms and graphviz output. This is a classic distributed systems engineer trap: designing for the general case when the immediate need is sequential tasks. The user doesn't need a DAG -- they need "do A then B."

3. **Task grouping via `group` field + separate group metadata files adds cognitive overhead.** The user has to think about epics before they've even gotten one task through the system. Groups should emerge from batched task creation (`/ralph-backlog`), not be a top-level concept the user manages.

4. **The auto-generated follow-up task patterns (review tasks, failure investigation tasks, chained tasks with templates) are premature.** The `on_complete.create_tasks` with mustache templates? That's a workflow engine, not a task queue. v1 needs exactly one auto-creation: "task done, needs review" -> move to review directory. Everything else is scope creep.

5. **The naming convention `100-task-20260303-001.md` is noisy.** Three different ordinals (priority prefix, date, sequence number). The user will never type this by hand. If the skill generates it, fine -- but then optimize for readability, not sort order. `task-001-add-rate-limiting.md` is better for humans. Sorting can happen in code.

**Score: 8/10** -- Best technical design in the batch, but the engineer showed through. Needs a UX pass to hide the machinery from the user.

---

### git-workflow.md -- Git Workflow & Synchronization

**What's good:**
- The single-repo recommendation is correct and well-argued. "The complexity of managing two repos buys us almost nothing at this stage" -- exactly.
- Task branches give isolation without complexity. Good call on no auto-merge.
- The 5 rules of conflict avoidance are solid and practical. Ownership boundaries, append-only patterns, never force-push.
- Commit convention is useful and git-grep-friendly.
- Rejecting the single `queue.json` file -- correct, with the right reasoning (merge conflicts on every operation).

**Where the UX is going to suck:**

1. **The `.ralph/` directory with separate `.json` + `.md` file pairs per task is a paper cut that will bleed.** `001.json` for metadata + `001.md` for description = 2 files per task, always in sync, easy to get out of sync. The distributed-arch proposal (YAML frontmatter in one Markdown file) is simpler and just as machine-parseable. Two files per task doubles the cognitive load: "do I look at the JSON or the Markdown?"

2. **The manual workflow in Section 10 is horrifying from a UX perspective.** The user is expected to:
   - Write a task markdown file by hand
   - Write a separate JSON metadata file by hand
   - `git add` both files
   - Commit with the correct message format
   - Push

   That's 5 steps involving manual file creation and precise commit messaging. One `/ralph-task "Refactor database connection pooling"` should replace ALL of that. The doc designs the git plumbing but forgets that the user shouldn't have to see the plumbing.

3. **Review is also manual git commands.** `git diff main...origin/ralph/003`, then `git merge origin/ralph/003`, then update JSON status, then commit and push. That's 4+ steps where `/ralph-review` (approve or reject with one command) should suffice.

4. **The "JSON per task" recommendation at the end contradicts the single-file approach from earlier sections.** The doc can't decide between `.ralph/tasks/001.md` (with status in directories) and `.ralph/tasks/001.json + 001.md` (with status in JSON). This needs to be resolved.

5. **Polling with smart backoff is correct, but the implementation hint (`git fetch --dry-run`) doesn't actually exist as described.** `git fetch --dry-run` doesn't tell you if there are new commits -- it just shows what WOULD be fetched. The actual check is `git rev-parse @{u}` before and after fetch.

**Score: 6/10** -- Good git fundamentals, but the user workflow sections read like they were written for git power users, not for someone who wants to type one command and go to lunch.

---

### prompt-engineer.md -- Prompt Engineering & Agent Loop Design

**What's good:**
- The CLI flag reference table is comprehensive and correct. This is genuinely useful documentation.
- The task-to-prompt pipeline (validate -> template select -> interpolate -> inject context -> build CLI args -> execute) is well-structured.
- Exit condition matrix is thorough. Distinguishing `failed:budget` from `failed:tests` from `failed:refusal` is important for the feedback loop.
- The verification step is the single most important design decision in this entire system. "Never trust the model's 'I'm done'" -- correct.
- Per-task-type tool profiles (readonly for research, full for bugfix) -- smart security posture.
- The `--append-system-prompt-file` approach preserves Claude Code's defaults while adding Ralph rules -- correct.

**Where the UX is going to suck:**

1. **The task YAML format is different from distributed-arch's format.** This doc uses a flat YAML file with `type`, `files`, `acceptance_criteria`, `constraints`, `context_refs`. The distributed-arch doc uses Markdown with YAML frontmatter with `status`, `priority`, `assigned_to`, `depends_on`, `group`, `tags`. The git-workflow doc uses JSON + Markdown pairs. Three different formats across three documents. The user gets one format, and it needs to be decided NOW, not at implementation time.

2. **The template system (Mustache-style `{{variable}}` interpolation) adds a build step the user doesn't see but will debug when it breaks.** Template interpolation failures are notoriously hard to diagnose. "Why did my task fail?" -> "Because the template had `{{test_command}}` but your task YAML didn't define `test_command`." This needs sensible defaults and clear error messages.

3. **Six different prompt templates (bugfix, feature, refactor, research, test, review) is a lot of surface area for v1.** Do we really need a separate template for "research" tasks vs "test" tasks in the first version? Start with ONE flexible template. Add specializations when we have evidence they improve outcomes.

4. **The auto-accept matrix (bugfix + tests pass + diff < 50 lines = auto-accept) is risky for v1.** Trust needs to be earned. In v1, EVERYTHING should go through review. Auto-accept is a v3 feature after the user has built confidence in the system.

5. **The SDK upgrade path (Python code examples for v2) distracts from the v1 design.** 30% of this document is about a future Python SDK integration. Focus on what ships first.

**Score: 8/10** -- Excellent technical depth on the agent execution side. The prompt templates are solid. Loses points for format disagreements and premature v2 planning.

---

### test-architect.md -- Testing & Verification Strategy

**What's good:**
- The confidence ladder is the most useful artifact any agent produced. Build order matters, and this gets it right.
- "The entire system can be tested locally before a VPS is ever provisioned" -- this should be in bold on the project's front page.
- Local bare repos for git integration testing -- this is the kind of insight that saves days of debugging.
- The verification gates are practical and specific. Not "write tests" but "10+ test cases covering edge cases for the parser."
- Mock strategies are layered sensibly: CLI stub first, behavior-based mock second, record/replay third, real execution last.
- Bun test runner recommendation -- lightweight, correct choice for this project.
- The golden path / failure path / conflict path test scenarios are concrete and actionable.

**Where the UX is going to suck:**

1. **This document is entirely focused on developer UX (building Ralph), not user UX (using Ralph).** That's appropriate for its domain, but it doesn't address: how does the user verify their task was picked up? How does the user test that their task file is valid before pushing? We need a `/ralph-validate` skill that checks a task file locally before committing.

2. **The "state machine" terminology (claimed, running) conflicts with other documents' terminology (in_progress, active).** State names MUST be unified across all documents. Every agent picked their own names. We need one vocabulary.

3. **The TypeScript implementation assumption may conflict with the bash-first approach from infra-ops and prompt-engineer.** infra-ops has `ralph-loop.sh` in bash. prompt-engineer has a bash orchestration script. test-architect has everything in TypeScript with `bun test`. Which is it? If it's TypeScript, the bash scripts are prototypes. If it's bash, the TypeScript test structure doesn't fit. This needs to be resolved.

4. **The CI/CD pipeline (GitHub Actions) adds complexity that's unnecessary for a single-user system.** Run tests locally with `bun test`. Push to git. Deploy manually with `docker compose up`. CI/CD is a v2 concern.

**Score: 9/10** -- Best overall document. Actionable, testable, and correctly ordered. The only reason it's not a 10 is that it assumes implementation decisions that haven't been made yet.

---

## 2. Agent Rankings

### Who Kept the User in Mind?

| Rank | Agent | User Focus | Technical Quality | Notes |
|------|-------|-----------|-------------------|-------|
| 1 | **test-architect** | 7/10 | 9/10 | Best overall document. The confidence ladder is user-facing even though it's developer-facing. Actionable, verifiable, no hand-waving. |
| 2 | **distributed-arch** | 6/10 | 9/10 | Strongest technical design, but designed for the system, not the user. The user never sees priority-prefixed filenames or cycle detection. |
| 3 | **prompt-engineer** | 7/10 | 8/10 | Good separation of system prompt vs task prompt. The template system serves the user indirectly. Loses points for format fragmentation. |
| 4 | **infra-ops** | 5/10 | 8/10 | Solid infrastructure decisions, but the setup flow assumes Linux competence. "SSH in and configure" is not a user-friendly deployment. |
| 5 | **git-workflow** | 4/10 | 7/10 | The manual task creation workflow in Section 10 is the biggest UX failure across all documents. Expects the user to hand-craft JSON and Markdown pairs and type precise git commands. |

### Who Designed for Machines Instead of Humans?

**git-workflow** designed for git power users. The entire Section 10 workflow reads like a git tutorial, not a product. The user should NEVER have to write a JSON metadata file by hand.

**distributed-arch** designed for a distributed system. The 11-field frontmatter, DAG dependencies, and auto-generated follow-up task templates are engineer candy. The user wants to say "do this thing" and check back later.

The others struck a reasonable balance, with **test-architect** being the most disciplined about what actually matters at each stage.

---

## 3. Unified Architecture Proposal

### The Three-Sentence Pitch

Ralph is a git-based remote agent runner. You create tasks with Claude Code skills on your laptop, the VPS picks them up and does the work, you review results with Claude Code skills on your laptop. Everything flows through git. No databases, no dashboards, no extra services.

### Core Principles

1. **The user never touches plumbing.** No hand-editing YAML frontmatter, no manual `git mv` between status directories, no JSON metadata files. Skills abstract everything.
2. **One file per task. One format. Period.** Markdown with YAML frontmatter. Not JSON+Markdown pairs. Not flat YAML. One format, everywhere, always.
3. **States are directories.** Moving a file IS the state transition. But the user doesn't do the moving -- skills and the agent do.
4. **Everything testable locally.** Follow the confidence ladder. Build layer by layer. No VPS until everything works on the laptop.
5. **Start with less.** One template, not six. One worker, not many. Review everything, auto-accept nothing. Earn trust, then automate it away.

### Task File Format (THE One Format)

```markdown
---
id: task-001
title: Add rate limiting to the API
status: pending
priority: normal
created: 2026-03-03T10:30:00Z
author: avanwieringen
type: feature
---

## Description

Add rate limiting middleware to all API endpoints.
Use a sliding window algorithm with configurable limits per endpoint.

## Acceptance Criteria

- Rate limiter middleware implemented
- Configurable per-endpoint limits
- Returns 429 with Retry-After header
- Tests pass
```

**That's it.** 6 user-relevant fields in the frontmatter. The system adds more fields as needed (`assigned_to`, `started_at`, `completed_at`, `branch`, `retry_count`) -- but the user never writes those.

Fields that should NOT be in the user-created task:
- `retry_count` / `max_retries` (system-managed, configurable globally)
- `assigned_to` (system-managed)
- `depends_on` (Phase 2 -- and even then, the `/ralph-backlog` skill sets these, not the user)
- `group` / `tags` (Phase 2, if ever)

### Directory Structure

```
project-root/
  .ralph/
    config.json              # Ralph configuration (poll interval, defaults, etc.)
    tasks/
      pending/               # Ready for pickup
        task-001.md
        task-002.md
      active/                # Being worked on
        task-003.md
      review/                # Done, needs human review
        task-004.md
      done/                  # Approved and merged
        task-005.md
      failed/                # Needs attention
        task-006.md
    status.json              # Node heartbeat + current state
    logs/
      2026-03-03.jsonl       # Structured activity log (one JSON line per event)
  .claude/
    skills/
      ralph-task/SKILL.md
      ralph-status/SKILL.md
      ralph-review/SKILL.md
      ralph-list/SKILL.md
      ralph-backlog/SKILL.md
    agents/
      ralph-worker.md        # Custom agent definition for the VPS worker
    ralph-system.md          # Appended to system prompt for all Ralph tasks
  src/
    ...project code...
```

**Why `.ralph/` instead of `tasks/` at root?** Namespace isolation. The project's own directories are untouched. `.ralph/` is Ralph's domain, clearly separated.

**Why `.ralph/` but `distributed-arch` used `.tasks/`?** Because `.ralph/` also holds config and logs, not just tasks. Single namespace for the whole system.

### Branching Strategy

**One branch per task.** The agent:
1. Fetches main, creates `ralph/<task-id>` from main's HEAD
2. Does all work on that branch
3. Pushes the branch
4. Updates task status on main (moves file to `review/`)
5. The user reviews the branch diff and merges (via `/ralph-review`)

**Why not linear commits on a single branch?** Isolation. A failed task doesn't contaminate the next one. Branches are the review unit.

**What about dependent tasks?** Phase 2. For now, each task branches from main independently.

### The Loop (VPS Side)

Written in TypeScript (Bun), following the confidence ladder:

```
while (true) {
  git pull main
  task = pickNextPendingTask()    // ls .ralph/tasks/pending/, sort by priority
  if (!task) { sleep(30); continue }

  claimTask(task)                 // mv to active/, update frontmatter, commit+push
  branch = createBranch(task)     // ralph/<task-id> from main

  result = executeTask(task)      // claude -p with --agent ralph-worker
  verify = runVerification()      // tests, build, lint

  if (verify.passed) {
    pushBranch(branch)
    moveToReview(task)            // mv to review/, commit+push to main
  } else if (canRetry(task)) {
    moveToPending(task)           // mv back to pending/, increment retry, commit+push
  } else {
    moveToFailed(task)            // mv to failed/, commit+push
  }

  updateHeartbeat()               // write status.json, commit+push
}
```

**Why TypeScript, not bash?** Because the test-architect is right -- we need testable layers. Task parsing, state machine, prompt construction are all unit-testable in TypeScript. A bash script that does all of this is a 300-line unmaintainable monster.

**Why Bun?** Fast, built-in test runner, TypeScript native. No webpack, no transpilation ceremony.

### The Agent (VPS Side)

Use `--agent ralph-worker` with a custom agent definition:

```markdown
# .claude/agents/ralph-worker.md
---
name: ralph-worker
description: Autonomous task executor for the Ralph system
tools: Read, Edit, Write, Glob, Grep, Bash
model: opus
permissionMode: bypassPermissions
---

You are Ralph, an autonomous coding agent executing a task from a queue.

## Rules
1. Only work on the task described in the prompt. Do not explore beyond scope.
2. Always run tests after making changes.
3. Be surgical. Minimal changes. No drive-by refactoring.
4. If you are unsure, document the uncertainty rather than guessing.
5. Do NOT ask questions -- there is no human present.
6. Do NOT push to git. The orchestrator handles pushing.
7. Do NOT modify anything in .ralph/ -- the orchestrator manages task state.

## Commit Convention
Use conventional commits: fix:, feat:, refactor:, test:, docs:
Include the task ID: "fix: null check in auth [task-001]"
```

**Why `--agent` instead of raw `--system-prompt`?** Because agents are first-class in Claude Code now, support tool restrictions, model selection, and can be version-controlled. The `--agent` flag applies all config cleanly.

### Skills (Laptop Side)

**v1 ships with 4 skills**, not 9:

| Skill | Purpose | Complexity |
|---|---|---|
| `/ralph-task` | Create a single task | Low -- write a file, commit, push |
| `/ralph-status` | Check node status + queue | Low -- git pull, read status.json + directory listings |
| `/ralph-review` | Review completed tasks | Medium -- show diff, ask approve/reject, merge or move back |
| `/ralph-list` | List all tasks | Low -- read directories, format output |

**Deferred to Phase 2:** `/ralph-backlog` (feature decomposition), `/ralph-cancel`, `/ralph-priority`, `/ralph-pause`, `/ralph-resume`. These are nice-to-haves that add surface area without solving the core loop.

### State Vocabulary (Unified)

Every document used different names. Here's the ONE vocabulary:

| State | Directory | Meaning |
|---|---|---|
| `pending` | `pending/` | Ready to be picked up |
| `active` | `active/` | Being worked on by the node |
| `review` | `review/` | Done, waiting for human approval |
| `done` | `done/` | Approved and merged |
| `failed` | `failed/` | Failed, needs human attention |

NOT "claimed", NOT "running", NOT "in_progress", NOT "backlog", NOT "queued". Five states, five directories, five words. Consistent everywhere.

### Implementation Language

**TypeScript with Bun.** Not bash scripts. Not Python SDK. Not a mix.

- **Orchestrator loop**: TypeScript
- **Task parser**: TypeScript (unit testable)
- **State machine**: TypeScript (unit testable)
- **Git operations**: TypeScript shelling out to git (integration testable)
- **Skills**: Markdown (Claude Code native)
- **Agent definition**: Markdown (Claude Code native)
- **Docker entrypoint**: Thin bash wrapper that calls `bun run start`

### What I'd Change From Each Proposal

| From | Change | Why |
|---|---|---|
| **infra-ops** | Add a `setup-vps.sh` one-liner script | The 6-step SSH manual setup will lose users |
| **infra-ops** | Replace `ralph-loop.sh` with TypeScript orchestrator | Testability. Bash is fine for 20 lines, not 200. |
| **distributed-arch** | Cut frontmatter to 6 user fields, system manages the rest | Users shouldn't think about retry semantics |
| **distributed-arch** | Drop DAG deps, groups, auto-generated follow-up tasks from v1 | Scope creep. The basic loop isn't working yet. |
| **distributed-arch** | Drop priority-in-filename convention | Human-readable names > sort-friendly names |
| **git-workflow** | Kill the JSON+Markdown pair format. One file per task. | Two files per task is a sync nightmare |
| **git-workflow** | Replace all manual git workflows with skills | The user should never type `git diff main...origin/ralph/003` |
| **git-workflow** | Use `.ralph/` not `.ralph/tasks/` + `.ralph/status/` + `.ralph/logs/` as separate sibling directories | Status is in status.json and task frontmatter. Logs are in logs/. Tasks hold everything else. |
| **prompt-engineer** | Start with ONE prompt template, not six | Add specialization when data shows it helps |
| **prompt-engineer** | Remove auto-accept logic from v1 | Trust must be earned. Review everything first. |
| **prompt-engineer** | Resolve the format disagreement -- use the distributed-arch format | One format. Everywhere. Always. |
| **test-architect** | Adopt the confidence ladder as the implementation roadmap | This IS the build plan, not just the test plan |
| **test-architect** | Resolve the TypeScript vs bash tension in favor of TypeScript | The whole codebase should be one language |

---

## 4. Implementation Phases (Revised)

### Phase 1: The Testable Core (No VPS, No Claude Code)
Following the confidence ladder:
1. Task file parser (TypeScript, unit tested)
2. State machine (TypeScript, unit tested)
3. Task queue (scan directories, filter, sort -- integration tested with temp dirs)
4. Git sync (commit, push, pull -- integration tested with local bare repos)
5. Orchestrator loop with mock executor (e2e tested locally)

**Gate: `bun test && bun test:integration && bun test:e2e` all pass.**

### Phase 2: Real Agent Execution (Still Local)
6. Prompt construction from task files
7. Agent definition (`ralph-worker.md`)
8. Real Claude Code execution with trivial tasks
9. Verification step (tests, build, lint)

**Gate: Create a task locally, run the loop, see the task go pending -> active -> review with actual code changes.**

### Phase 3: Docker & VPS
10. Dockerfile + docker-compose.yml
11. `setup-vps.sh` script
12. Deploy to VPS, run against real git remote

**Gate: Push a task from laptop, see it completed on VPS, pull results.**

### Phase 4: Client Skills
13. `/ralph-task` skill
14. `/ralph-status` skill
15. `/ralph-list` skill
16. `/ralph-review` skill

**Gate: Full workflow via skills only. User never types raw git commands for Ralph operations.**

---

## 5. Open Questions That Must Be Resolved Before Implementation

1. **`.ralph/` vs `tasks/` at project root** -- I'm proposing `.ralph/` for namespace isolation. Others used `tasks/` or `.tasks/`. We need ONE answer.

2. **TypeScript vs bash for the orchestrator** -- I'm proposing TypeScript. infra-ops and prompt-engineer proposed bash. The test-architect assumed TypeScript. We need ONE answer.

3. **How does the node authenticate to git?** SSH deploy key seems right, but the exact provisioning flow needs to be spelled out for a non-Linux user.

4. **Do we use `--dangerously-skip-permissions` or `--agent` with `permissionMode: bypassPermissions`?** They achieve similar things but through different mechanisms. The `--agent` approach is cleaner because it's configured in a version-controlled file.

5. **What's the minimum viable CLAUDE.md for the project?** The agent needs to know how to run tests and what patterns to follow. This is project-specific and must be written by the user. We should provide a template.
