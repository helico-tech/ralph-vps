# Phase 2: Cross-Review & Architecture Synthesis
## From the Prompting & Agent Loop Perspective

> **prompt-engineer** | 2026-03-03 | Phase 2 cross-review

---

## Part 1: Critique of Each Proposal

### infra-ops.md -- Infrastructure & Docker

**What they got right:**
- Minimal Dockerfile (Option B) is correct. The devcontainer is bloated for headless use.
- `--dangerously-skip-permissions` inside Docker + network restrictions is the right pattern.
- Docker restart policy + bash loop is the right simplicity level for V1.
- "All state lives in git" -- absolute non-negotiable, and they nailed it.
- Cost analysis is practical and grounded.

**Where the agent will bite them:**

1. **The loop script is a prompt disaster.** Look at their `ralph-loop.sh` (line ~290): `claude -p "$(cat $TASK)"`. They're feeding the raw task file as the prompt. This is the single biggest mistake in the entire proposal. A Markdown task file is NOT a prompt. It has YAML frontmatter that's not instructions, it has metadata fields the model doesn't need, and it completely lacks the behavioral guardrails (role, workflow, constraints) that prevent the agent from going off the rails. Claude will read the raw task file and make creative interpretations of `status: "pending"` and `retry_count: 0` as part of the task instructions. That frontmatter will pollute the model's attention.

2. **No verification step.** Their loop goes: execute -> mark complete -> commit -> push. Where's the test run? Where's the build check? They just... trust that Claude did the right thing? The agent will produce code that looks right in the response but fails basic compilation. Without a post-execution verification gate, broken code gets committed and pushed automatically.

3. **`--dangerously-skip-permissions` without `--allowedTools`.** They recommend the nuclear option (`--dangerously-skip-permissions`) but never mention `--allowedTools` as the scalpel. The whole point of `--allowedTools` is to give the agent exactly the tools it needs and nothing more. `--dangerously-skip-permissions` removes ALL guardrails. Inside Docker this is "okay" for security, but from a prompt engineering perspective it's terrible -- the agent can `rm -rf`, `git push --force`, or install random npm packages and the orchestrator won't even know until the damage is done.

4. **No `--max-turns` or `--max-budget-usd`.** Their script runs Claude with no turn limit or budget cap. A poorly-specified task will burn tokens until the API rate limit hits. This is especially dangerous with API key billing.

5. **No `--output-format json`.** They capture raw text output. Without structured JSON, there's no programmatic way to determine if the run succeeded, what the session ID was (for retries), or what the stop reason was. They can't distinguish between a clean exit and a refusal.

**Severity: HIGH.** The infrastructure is solid. The agent execution is dangerously naive. They've built a beautiful Docker house and then let the agent run around with scissors inside it.

**What I'd change:**
- Replace `$(cat $TASK)` with a proper prompt construction pipeline
- Add `--allowedTools` with per-task-type profiles instead of `--dangerously-skip-permissions`
- Add `--output-format json` and parse the result
- Add `--max-turns 50` and `--max-budget-usd 5.00` as safety nets
- Add post-execution verification (tests, build) before marking complete
- Add the `timeout` command wrapper around Claude invocations

---

### distributed-arch.md -- Distributed Systems & Task Queue

**What they got right:**
- Markdown + YAML frontmatter is the correct task format. It's human-readable, git-friendly, and Claude can read it natively. Good call.
- Directory-per-status (`pending/`, `in_progress/`, `done/`, `failed/`) with `git mv` as the state transition is elegant. Atomic in git, visible in diffs, trivially queryable.
- The state machine is well-defined with clear transition rules.
- Deterministic pickup algorithm (priority ASC, created_at ASC, id ASC) is correct.
- Single worker for Phase 1 is the right call. They explicitly say "don't even think about multi-worker." Good discipline.
- Failure artifacts with attempt logs appended to the task file -- great for debugging.

**Where the agent will bite them:**

1. **The task format has no `type` field.** This is a critical omission from a prompting perspective. Without a `type` (bugfix, feature, refactor, research, test, review), the orchestrator can't select the right prompt template. Their task file has `title`, `description`, `tags` -- but tags are freeform and unreliable for template selection. The agent will get a generic prompt for every task, which means it'll treat a refactoring the same as a feature implementation. Different task types need radically different behavioral instructions.

2. **The Markdown body IS the prompt -- but it shouldn't be the WHOLE prompt.** Their design assumes the worker reads the `.md` body and hands it to Claude. But the body is a task description, not a complete prompt. It's missing: role instructions, workflow steps, constraints, commit message format, tool usage guidance, and "what to do when stuck" fallbacks. The model needs those guardrails. Without them, Claude will free-associate a solution and probably forget to run tests, commit with a random message, or wander off into unrequested refactoring.

3. **No acceptance criteria as a first-class field.** Their frontmatter has `id`, `title`, `status`, `priority`, `depends_on`, `group`, `tags` -- but no `acceptance_criteria`. Acceptance criteria are the single most important field for agent execution. They're what turns a vague task description into a verifiable goal. Without them, "add user authentication endpoint" becomes an open-ended creative exercise, and the agent will produce something that technically works but doesn't match what the user wanted.

4. **`on_complete` task chaining is premature.** Their Pattern 3 (on_complete with template references) is a feature that should not exist in V1. It adds a templating system inside the task format, which means the orchestrator needs to resolve templates at task creation time. This is complexity that buys nothing until the basic loop is proven.

5. **The worker pseudocode feeds raw task content to Claude.** Line ~689: `result=$(claude -p "Execute this task: $(cat .tasks/in_progress/$task)")`. Same problem as infra-ops. Prefixing with "Execute this task:" and dumping the raw file is not a prompt. It's a prayer.

**Severity: MEDIUM.** The distributed systems design is excellent. The task format is 80% right but missing two critical fields (`type` and `acceptance_criteria`). The gap between "task file" and "agent prompt" is not addressed at all -- they assume that's someone else's problem. It is. It's mine.

**What I'd change:**
- Add `type` as a required frontmatter field (enum: bugfix, feature, refactor, research, test, review)
- Add `acceptance_criteria` as a required frontmatter field (array of strings)
- Add `files` as an optional field (scope the agent's attention)
- Add `constraints` as an optional field
- Remove `on_complete` from V1
- Document that the Markdown body is task context, NOT the complete prompt -- the orchestrator builds the full prompt by combining the task with a template

---

### git-workflow.md -- Git Workflow & Synchronization

**What they got right:**
- Single repo (project + tasks) is the right call. Two repos is unnecessary complexity.
- Task branches (`ralph/<task-id>-<slug>`) with no auto-merge is correct. The review gate matters.
- Ownership boundaries (user owns task definitions, agent owns status + code) is a critical insight. This prevents almost all merge conflicts by design.
- Append-only patterns for shared state -- excellent conflict avoidance.
- Commit conventions (`ralph(<task-id>): <action> - <description>`) make git log a usable dashboard.
- Push at key milestones (pickup + periodic + completion) is the right balance.
- "Agent never force-pushes" -- yes, obviously, but it's good they made it explicit.

**Where the agent will bite them:**

1. **The commit convention expects the AGENT to follow it, but there's no enforcement.** Line ~246: they define `ralph(001): pickup`, `ralph(001): complete`, etc. But how does the agent know to use this format? If the prompt doesn't explicitly say "use this exact commit format," Claude will use its own convention (probably conventional commits like `fix: blah`). The orchestrator could enforce this by committing on behalf of the agent (the agent edits files, the orchestrator stages and commits), but that's not what they describe. They need to decide: does the agent commit, or does the orchestrator?

2. **The separation between `.ralph/tasks/` (descriptions) and `.ralph/status/` (JSON state) is unnecessary.** They propose `001.json` for machine state + `001.md` for human description. But distributed-arch already has the YAML frontmatter approach, which puts both in one file. Two files per task means two files to keep in sync, two files to move on state transitions, and double the git operations. The frontmatter approach is strictly better.

3. **Missing: how does the prompt get the commit convention into the agent?** Their open question (line ~628) literally asks: "The agent needs clear instructions about commit conventions and branch workflow. How do we inject these into the Claude Code prompt?" Great question! The answer is `--append-system-prompt-file` with a Ralph-specific system prompt that includes the git workflow rules. They identified the gap but didn't propose a solution.

4. **`.ralph/` vs `.tasks/` naming inconsistency.** git-workflow uses `.ralph/`, distributed-arch uses `.tasks/`, dx-client uses `tasks/`. We need to pick ONE name and stick with it. (I vote `.ralph/` because it's project-specific namespace and won't collide with anything.)

5. **The `claude --task` invocation (line ~560) doesn't exist.** They write `claude --task "$(cat .ralph/tasks/${TASK_ID}.md)"`. There is no `--task` flag. The correct invocation is `claude -p`. This is a minor error but symptomatic of not verifying against the actual CLI reference.

**Severity: LOW-MEDIUM.** The git workflow design is the most mature of the five proposals. The gaps are real but smaller -- mostly about how to bridge the git conventions with the agent prompt, which is squarely in my territory.

**What I'd change:**
- Orchestrator handles ALL git operations (agent only edits files and runs tests)
- System prompt explicitly includes commit convention rules
- Merge `.json` status file into YAML frontmatter (one file per task)
- Standardize on `.ralph/` directory name

---

### dx-client.md -- Developer Experience & Client Tooling

**What they got right:**
- `/ralph-task` as a Claude Code skill is the correct UX. The user shouldn't leave their terminal.
- The ideal user workflow section (morning -> afternoon -> evening) is the best explanation of the system's value proposition in any of the proposals. It makes the async feedback loop concrete.
- Review workflow with approve/reject/feedback cycle is well-designed.
- `status.json` heartbeat + activity log for git-based introspection is clean.
- "No web dashboard in V1" is the right call.
- Skills as the entire client tooling layer (no separate CLI binary) -- correct. Don't add another tool.
- `disable-model-invocation: true` on all skills -- correct. User-initiated only.

**Where the agent will bite them:**

1. **The `/ralph-backlog` skill asks Claude to decompose a feature into tasks.** This is the most dangerous operation in the entire system. Task decomposition is where most LLM projects go wrong. The decomposition depends entirely on the quality of the prompt, and the skill prompt (line ~530) is vague: "Analyze the feature description... Break into 2-7 discrete tasks." What makes a task "discrete"? What makes it "independently testable"? Claude will produce tasks that are either too granular (10 tasks for something that should be 3) or too broad (1 task that's actually 5 tasks duct-taped together). And every downstream task inherits the decomposition quality.

    This needs a much more structured prompt. The skill should produce tasks with `type`, `acceptance_criteria`, `files`, and `constraints` -- not just a title and description. And the user should always confirm before committing, which they do mention (step 6), but the skill needs to present the decomposition in a way that makes it easy to reject individual tasks.

2. **Cancel signals via git are clever but fragile.** Writing `tasks/signals/cancel-<task-id>` and expecting the node to check before each phase -- this only works if the node pulls frequently during execution. But Claude Code runs as a single `-p` invocation. The node can't check for signals mid-execution. It can only check between tasks. So cancellation of an in-progress task is actually impossible without killing the Claude process. They should be honest about this: cancellation = kill the current process + mark task as cancelled.

3. **No mention of what happens when the skill-generated task format doesn't match what the node expects.** The `/ralph-task` skill generates task files. The node reads task files. If the skill produces a frontmatter field the node doesn't understand, or omits a required field, the node crashes or silently misbehaves. There's no contract between the skill output and the node input. They need a shared schema.

4. **The pause/resume mechanism (signal files) adds complexity for minimal value in V1.** If you want to pause the node, just SSH in and `docker stop ralph`. If you want to resume, `docker start ralph`. Signal files are cute but they're another thing that can get out of sync.

**Severity: MEDIUM.** The DX design is thoughtful and user-centric, but it underestimates the difficulty of task decomposition and doesn't address the contract between skill output and node input.

**What I'd change:**
- `/ralph-backlog` skill needs a much more structured decomposition prompt with explicit output format requirements
- Define a shared task schema (YAML frontmatter fields, required vs optional) used by both skills and the node
- Drop cancel signals in V1; cancellation = docker restart
- Drop pause/resume in V1

---

### test-architect.md -- Testing & Verification Strategy

**What they got right:**
- The "confidence ladder" build order is the single best contribution across all five proposals. Layer 0 (parsing) through Layer 7 (VPS deployment), each independently testable before the next begins. This is how you build a system that works.
- Mock Claude Code via a configurable binary path (`CLAUDE_CODE_BIN=./test/mock-claude-code.sh`) is the right approach. Test everything without burning API tokens.
- Local bare repo testing (no network needed) is a critical insight. The entire git sync layer can be tested offline.
- Verification gates with explicit checklists -- this is the "prove it works at each step" that the user asked for.
- Bun as the test runner -- fast, TypeScript-native, minimal.
- The test file structure (Appendix A) is well-organized.
- "If you can't test it, you can't trust it" -- yes.

**Where the agent will bite them:**

1. **Prompt builder tests are listed but not designed.** They mention `prompt-builder.test.ts` in the test structure and say "Task with context files -> prompt includes file contents" but don't address the harder question: how do you test that a prompt produces good agent behavior? A prompt can be syntactically correct (includes the right variables, has the right structure) but semantically terrible (the instructions are ambiguous, the constraints conflict). Prompt testing needs examples of good/bad prompts and expected outcomes, not just "fields are present."

2. **The mock Claude Code is too simple for meaningful testing.** Their bash mock (line ~226) just writes "Task completed successfully" to a file. Their TypeScript mock (line ~233) does file creation based on task content. But real Claude Code does dozens of things: reads files, runs tests, makes multiple edits, commits. A mock that just creates one file doesn't test the orchestrator's ability to handle realistic agent output -- specifically, the case where Claude edits 5 files, runs tests, 2 fail, it fixes them, runs again, all pass, then commits. The orchestrator's verification logic never gets exercised with a trivial mock.

    They need behavior-based mocks that simulate realistic multi-step agent sessions: reading files, editing them, running commands that produce output. The mock should be able to simulate test failures so the retry logic is exercised.

3. **No testing of the prompt itself.** The most fragile component in the system is the prompt -- it's the contract between the human's intent and the agent's behavior. But there's no prompt regression testing. When someone changes a template, how do we know the new version still produces the right behavior? Snapshot tests on the constructed prompts (hash the final prompt for a given task) would catch accidental changes. Semantic tests (run the prompt through Claude with a trivial task and verify the output structure) would catch behavioral regressions.

4. **Record/replay is the right idea, wrong priority.** They list it as Strategy 3, after the bash mock and behavior mock. But record/replay is actually the most valuable testing strategy for an LLM-based system. Record a real Claude session, replay it deterministically. This is the only way to get realistic test coverage without burning API tokens on every test run. It should be the first thing built after the basic mock, not the third.

5. **No testing of the CLAUDE.md / system prompt interaction.** The system prompt and CLAUDE.md are both injected into every agent run. If they conflict ("CLAUDE.md says use Jest, system prompt says use Bun"), the agent's behavior becomes unpredictable. There should be a validation test that checks for contradictions between the project config and the Ralph system prompt.

**Severity: LOW.** The testing strategy is the strongest proposal. The gaps are in the "how to test the LLM-specific parts" -- which is admittedly the hardest thing to test. Their testing of everything except the prompt layer is excellent.

**What I'd change:**
- Add prompt snapshot tests (hash of constructed prompt per task type)
- Add semantic smoke tests (run a trivial task through real Claude to verify output structure)
- Make behavior-based mocks the primary mock strategy, not the bash stub
- Add record/replay as a V1 feature, not a V2 afterthought
- Add CLAUDE.md + system prompt consistency validation

---

## Part 2: Agent Rankings

**Who understood agent behavior best?** Ranked from best to worst:

### 1. test-architect (Score: 8/10)

Understood that you can't trust the agent and built verification around it. The confidence ladder implicitly acknowledges that the agent is the least predictable component and should be tested last, after all surrounding logic is proven. The mock Claude Code approach shows they understand the agent is a black box that needs to be isolated for testing. Didn't address prompt quality directly, but designed a framework where prompt regressions could be caught.

### 2. distributed-arch (Score: 6/10)

Designed a solid task format that's close to what the agent needs, but didn't bridge the gap between "task file" and "agent prompt." The state machine and failure handling show awareness that the agent can fail in multiple ways. The retry logic (with `retry_count` and `max_retries`) acknowledges that agent runs are probabilistic. But they never considered WHAT the agent sees when it receives a task -- just the state management around it.

### 3. dx-client (Score: 6/10)

Designed the human-facing side well, but the `/ralph-backlog` skill (letting Claude decompose features into tasks) is the most dangerous feature proposed. They're essentially using an uncontrolled LLM to generate inputs for a controlled LLM. The quality of every downstream agent run depends on the quality of the decomposition. They show awareness of the feedback loop (reject -> feedback -> retry) which implies they understand the agent can fail. But they didn't think about what makes a task good for the agent vs. bad for the agent.

### 4. git-workflow (Score: 5/10)

Strong git design, but they explicitly punted the prompt question: "How do we inject [commit conventions] into the Claude Code prompt?" (line 628). They acknowledged the gap but left it empty. The commit convention design is good but assumes the agent will follow it, which it won't unless the prompt explicitly instructs it. The ownership boundaries are the best conflict-avoidance design across all proposals, but they're purely about git, not about agent behavior.

### 5. infra-ops (Score: 3/10)

Built great infrastructure and then ran the agent with essentially no guardrails. `--dangerously-skip-permissions`, no tool restrictions, no turn limits, no budget caps, no verification, raw task file as prompt. This is the team member who's going to be most surprised when Claude does something unexpected -- because they built zero defense against it. The infrastructure is genuinely good, but the agent execution strategy is "cat the file and hope for the best."

---

## Part 3: Proposed Architecture (Synthesis)

### Core Design Principles

1. **The prompt is the product.** Everything else (Docker, git, task format) is infrastructure that serves the prompt. A perfect infrastructure running a bad prompt produces garbage. A scrappy bash script running a great prompt produces value.

2. **Never trust the agent.** Always verify. Post-execution checks are non-negotiable. The agent's claim of "done" means nothing until tests pass and the build succeeds.

3. **The orchestrator is the adult in the room.** The agent edits files and runs tests. The orchestrator handles EVERYTHING ELSE: git operations, state transitions, verification, retry decisions, pushing. The agent is a powerful but unreliable tool; the orchestrator is the reliable wrapper.

4. **One file per task, everything in frontmatter.** No separate .json and .md files. No two-repo split. One Markdown file with YAML frontmatter per task. Simple.

5. **The gap between task and prompt is explicit.** A task file is NOT a prompt. The orchestrator builds a prompt FROM a task file using a template. This separation is maintained in the code, the tests, and the documentation.

### Directory Structure

```
project-root/
  .ralph/
    config.yaml              # Ralph configuration (poll interval, model, budgets)
    system-prompt.md          # Ralph agent behavioral rules (--append-system-prompt-file)
    templates/                # Prompt templates by task type
      bugfix.md
      feature.md
      refactor.md
      research.md
      test.md
      review.md
    tasks/
      pending/                # Tasks waiting to be picked up
      in_progress/            # Currently being worked on
      review/                 # Completed, awaiting human approval
      done/                   # Approved and merged
      failed/                 # Permanently failed
    logs/
      executions.jsonl        # Structured execution log (append-only)
      activity.log            # Human-readable activity log
    status.json               # Node heartbeat + current state
  .claude/
    CLAUDE.md                 # Project conventions (auto-loaded by Claude Code)
    skills/
      ralph-task/SKILL.md     # /ralph-task skill
      ralph-status/SKILL.md   # /ralph-status skill
      ralph-review/SKILL.md   # /ralph-review skill
      ralph-list/SKILL.md     # /ralph-list skill
  src/                        # Project source code
  tests/                      # Project tests
```

### Task File Format (Unified)

```markdown
---
id: "task-20260303-001"
type: "bugfix"                     # REQUIRED: bugfix|feature|refactor|research|test|review
title: "Fix null check in auth"    # REQUIRED
status: "pending"                  # REQUIRED (matches directory)
priority: 100                      # REQUIRED: lower = higher priority
created_at: "2026-03-03T10:00:00Z"
updated_at: "2026-03-03T10:00:00Z"
acceptance_criteria:               # REQUIRED: testable assertions
  - "authenticate() returns AuthError when user.email is None"
  - "All existing tests pass"
  - "New test covers null email case"
files:                             # OPTIONAL: scope the agent's attention
  - "src/auth.py"
  - "tests/test_auth.py"
constraints:                       # OPTIONAL: what NOT to do
  - "Do not modify the User model"
depends_on: []                     # OPTIONAL
retry_count: 0
max_retries: 2
tags: ["backend", "auth"]
---

## Description

The `authenticate()` function in `src/auth.py` crashes when
`user.email` is None. Add a null check before the email validation.

## Context

The auth module was recently refactored (PR #42). The null check
was accidentally removed during the refactor.
```

### The Orchestrator Loop (V1, Bash)

```
┌─────────────────────────────────────────────────────────────┐
│                    Ralph Orchestrator                         │
│                                                              │
│  1. git pull --rebase origin main                           │
│  2. Scan .ralph/tasks/pending/ for eligible tasks           │
│  3. Pick highest-priority eligible task                      │
│  4. Validate task frontmatter (required fields, valid type)  │
│  5. git mv task to in_progress/                             │
│  6. Update frontmatter (status, claimed_at)                 │
│  7. git commit + push (claim visible to user)               │
│  8. git checkout -b ralph/<task-id>                          │
│  9. Build prompt: task + template + system-prompt            │
│ 10. Execute: timeout $T claude -p "$PROMPT"                 │
│       --output-format json                                   │
│       --max-turns $N                                         │
│       --max-budget-usd $B                                    │
│       --model $M                                             │
│       --allowedTools $TOOLS                                  │
│       --append-system-prompt-file .ralph/system-prompt.md    │
│ 11. Parse JSON result (session_id, stop_reason, result)      │
│ 12. Run verification: test suite + build + lint              │
│ 13. Decide outcome:                                          │
│     - Tests pass + auto-accept criteria met -> done          │
│     - Tests pass + needs review -> review/                   │
│     - Tests fail + retries left -> resume with error context │
│     - Tests fail + no retries -> failed/                     │
│     - Budget/turns exceeded -> failed/                       │
│ 14. git commit results on feature branch                    │
│ 15. git push origin ralph/<task-id>                         │
│ 16. git checkout main                                       │
│ 17. git mv task to outcome directory (done/review/failed/)   │
│ 18. Update frontmatter with results + execution metadata     │
│ 19. Append to .ralph/logs/executions.jsonl                  │
│ 20. git commit + push to main                               │
│ 21. Update .ralph/status.json                               │
│ 22. Sleep $POLL_INTERVAL, go to 1                            │
└─────────────────────────────────────────────────────────────┘
```

### Prompt Construction Pipeline

```
                      ┌─────────────┐
                      │  Task File  │
                      │  (.md+yaml) │
                      └──────┬──────┘
                             │ parse frontmatter
                             v
                      ┌─────────────┐
                      │  Validate   │
                      │  (schema)   │
                      └──────┬──────┘
                             │ extract: type, fields, body
                             v
              ┌──────────────────────────────┐
              │  Select Template by Type      │
              │  .ralph/templates/{type}.md   │
              └──────────────┬───────────────┘
                             │ interpolate variables
                             v
              ┌──────────────────────────────┐
              │  Constructed Prompt           │
              │  (role + description +        │
              │   criteria + constraints +    │
              │   workflow + commit format)   │
              └──────────────┬───────────────┘
                             │
                  ┌──────────┼──────────┐
                  v          v          v
           system-prompt  CLAUDE.md   --allowedTools
           (--append)     (auto)      (per type)
```

### What the Agent Sees (Example: Bugfix)

After prompt construction, the agent receives:

```
# Task: Fix null check in auth [task-20260303-001]

## Role
You are a senior developer fixing a bug. Be surgical -- change only
what's necessary.

## Bug Description
The `authenticate()` function in `src/auth.py` crashes when
`user.email` is None. Add a null check before the email validation.

## Context
The auth module was recently refactored (PR #42). The null check
was accidentally removed during the refactor.

## Files to Investigate
- src/auth.py
- tests/test_auth.py

## Acceptance Criteria
- [ ] authenticate() returns AuthError when user.email is None
- [ ] All existing tests pass
- [ ] New test covers null email case

## Constraints
- Only modify files listed above unless absolutely necessary
- Do not refactor unrelated code
- Do not change function signatures unless required by the fix
- Do not modify the User model

## Workflow
1. Read the relevant files to understand the current code
2. Identify the root cause of the bug
3. Implement the minimal fix
4. Run tests: `bun test`
5. If tests fail, fix and re-run
6. Add a test that would have caught this bug
7. Run full test suite to ensure no regressions
8. Commit: `git add -A && git commit -m "fix: Fix null check in auth [task-20260303-001]"`
```

Plus the system prompt (via `--append-system-prompt-file`) with Ralph's behavioral rules. Plus CLAUDE.md auto-loaded by Claude Code. Plus the tool restrictions via `--allowedTools`.

This is a complete, self-contained prompt that tells the agent exactly what to do, how to verify, and when to stop. Compare this to the other proposals that just `cat` the task file.

### Key Architecture Decisions

| Decision | Choice | From | Rationale |
|----------|--------|------|-----------|
| Directory structure | `.ralph/` in project root | git-workflow | Single repo, clean namespace |
| Task format | Markdown + YAML frontmatter | distributed-arch | Human-readable, git-friendly |
| Required task fields | id, type, title, status, priority, acceptance_criteria | prompt-engineer | `type` and `acceptance_criteria` are essential for prompt construction |
| State tracking | Directory-per-status | distributed-arch | `git mv` = atomic state transition |
| Branching | Per-task branches, no auto-merge | git-workflow | Isolation + review gate |
| Agent execution | `--allowedTools` per type, NOT `--dangerously-skip-permissions` | prompt-engineer | Principle of least privilege, even inside Docker |
| Prompt construction | Template per task type, interpolated from task fields | prompt-engineer | Separates behavioral instructions from task data |
| System prompt | `--append-system-prompt-file` (keep Claude Code defaults) | prompt-engineer | Don't replace the defaults, augment them |
| Verification | Post-execution test + build + lint | prompt-engineer + test-architect | Never trust "I'm done" |
| Git operations | Orchestrator handles ALL git | git-workflow + prompt-engineer | Agent shouldn't touch git beyond committing changes |
| Introspection | status.json + activity log + git log | dx-client | Git-based, no extra infra |
| Client tools | Claude Code skills (`/ralph-*`) | dx-client | No separate CLI binary |
| Testing | Confidence ladder with mock Claude | test-architect | Each layer proven before the next |
| Infrastructure | Docker on Hetzner, restart policy | infra-ops | Simple, cheap, sufficient |
| Task decomposition | User-confirmed, structured output required | dx-client + prompt-engineer | Decomposition quality = downstream quality |

### What V1 Includes (and What It Doesn't)

**V1 (MVP):**
- Single Docker container on Hetzner
- Single worker, sequential task processing
- Task files with required fields (type, acceptance_criteria)
- Prompt templates for 6 task types
- `--allowedTools` per task type
- Post-execution verification (test + build)
- Directory-per-status state machine
- Per-task branches, no auto-merge
- `/ralph-task`, `/ralph-status`, `/ralph-review`, `/ralph-list` skills
- Structured execution logging (JSONL)
- Confidence ladder testing with mock Claude

**NOT V1:**
- Multiple workers / parallel execution
- Task decomposition (`/ralph-backlog`) -- too dangerous without more guardrails
- Cancel signals, pause/resume
- `on_complete` task chaining
- Notifications (ntfy.sh, webhooks)
- Agent SDK (Python/TypeScript) -- CLI is sufficient
- Web dashboard
- Auto-accept (everything goes through review in V1)

### The One Thing Everyone Missed

Nobody addressed what happens when the agent's context window fills up. Claude Code does context compaction (it summarizes older messages to make room for new ones). On long-running tasks with many file reads and tool calls, the agent can lose track of earlier context -- including the task description and acceptance criteria.

**Mitigation:** Keep tasks small (< 30 minutes of agent time). Use `--max-turns 50` as a hard cap. If a task is too large, the user should decompose it manually rather than letting the agent thrash. The system prompt should include a "when you're stuck, stop and document" instruction so the agent doesn't burn through its context window retrying the same failed approach.

This is a fundamental limitation of the current architecture. The agent has a finite attention span, and we need to design tasks that fit within it.

---

## Part 4: Implementation Priority

Based on the cross-review, the build order should be:

1. **Task schema + parser** (from distributed-arch + test-architect Layer 0)
2. **Prompt templates + construction pipeline** (from prompt-engineer)
3. **State machine + directory operations** (from distributed-arch + test-architect Layer 1-2)
4. **Git sync** (from git-workflow + test-architect Layer 3)
5. **Agent executor with `--allowedTools`** (from prompt-engineer + test-architect Layer 4)
6. **Orchestrator loop** (from prompt-engineer + test-architect Layer 5)
7. **Client skills** (from dx-client)
8. **Docker + deployment** (from infra-ops + test-architect Layer 6-7)

Each step has tests before the next begins. The confidence ladder from test-architect is the backbone. The prompt pipeline from prompt-engineer is the heart. The git workflow from git-workflow is the nervous system. The infrastructure from infra-ops is the skeleton. The client tools from dx-client are the skin.
