# Ralph VPS Architecture Consensus

> Synthesized from 6 specialist brainstorms + cross-reviews (2026-03-03)

---

## Universal Agreement (All 6 Agents)

These points had zero dissent across all proposals:

1. **One file per task** — Markdown with YAML frontmatter. Not JSON+MD pairs, not flat YAML.
2. **`.ralph/` namespace** — All Ralph state lives under `.ralph/` in the project repo.
3. **Directory-per-status** — `pending/`, `in_progress/`, `review/`, `done/`, `failed/`. `git mv` IS the state transition.
4. **Single worker for V1** — No multi-worker until single-worker is proven.
5. **No auto-accept in V1** — Everything goes through human review.
6. **No `git add -A`** — Explicit file staging only. This was the most criticized mistake across proposals.
7. **Post-execution verification mandatory** — Tests + build must pass before marking complete.
8. **Git as sole state store** — No databases, no message queues, no external services.
9. **No heartbeat commits in git** — Status commits only on state transitions.
10. **Per-task branches for code changes** — `ralph/<task-id>`, merged by user after review.
11. **Build local-first** — Follow the confidence ladder. No VPS until everything works locally.
12. **Orchestrator handles all git** — Agent only edits files and runs tests. Never pushes.
13. **Ownership boundaries** — User writes to `pending/`. Agent writes to `in_progress/`, `review/`, `done/`, `failed/`.
14. **Crash recovery on startup** — Reclaim or release orphaned `in_progress` tasks.

## Resolved Disagreements

| Topic | Resolution | Winner | Losers |
|-------|-----------|--------|--------|
| Task file format | MD + YAML frontmatter | distributed-arch, dx-client | git-workflow (JSON+MD), prompt-engineer (flat YAML) |
| Status tracking | Directory = status | distributed-arch | git-workflow (frontmatter-only), dx-client (status.json) |
| Heartbeat in git | NO — file on disk only | test-architect, git-workflow | dx-client (status.json every 2min) |
| Auto-accept | Not in V1 | Everyone except prompt-engineer | prompt-engineer (conditional auto-accept) |
| Task files per task | 1 | Everyone except git-workflow | git-workflow (JSON+MD pair) |
| Session resume on retry | Fresh session | distributed-arch, infra-ops | prompt-engineer (--resume) |
| Cancel signals | Not in V1 — just `docker stop` | infra-ops, prompt-engineer | dx-client (signal files) |
| VPS provider | Hetzner CX22 (~EUR 4.5/mo) | Unanimous | — |

## Unresolved — The Big Debates

### Debate 1: Orchestrator Language

| Position | Advocates | Argument |
|----------|-----------|----------|
| **Bash** | infra-ops, prompt-engineer | Simpler, no build step, runs everywhere, test with BATS |
| **TypeScript/Bun** | dx-client, test-architect | Testable layers, type safety, one language for everything |
| **Neutral** | distributed-arch, git-workflow | Don't care, just pick one |

### Debate 2: Prompt Template Strategy

| Position | Advocates | Argument |
|----------|-----------|----------|
| **Task file IS the prompt** | infra-ops | No template engine, just `claude -p "$(cat task.md)"` |
| **1 flexible template** | dx-client | Start simple, specialize when data shows benefit |
| **6 templates (per task type)** | prompt-engineer | Different types need different behavioral instructions |

### Debate 3: Skills in V1 or V2

| Position | Advocates | Argument |
|----------|-----------|----------|
| **V1 (3-4 skills)** | dx-client, infra-ops | Critical UX — user shouldn't touch raw files |
| **V2 (defer)** | test-architect | Skills are untestable black boxes |

### Debate 4: State Vocabulary

| Proposed | By |
|----------|-----|
| pending, in_progress, review, done, failed | distributed-arch, infra-ops |
| pending, active, review, done, failed | dx-client |
| pending, claimed, running, review, done, failed | test-architect (6 states) |

---

## Three Proposed Architectures

### Architecture A: "Shell-Native Minimal"

**Philosophy:** The simplest thing that could possibly work. Ship fast, iterate later.

**Advocates:** infra-ops (primary), git-workflow

```
Orchestrator:  Bash (ralph-loop.sh, ~300 lines)
Testing:       BATS (Bash Automated Testing System)
Prompting:     Task file = prompt. No template engine.
               CLAUDE.md + ralph-system.md provide behavioral context.
Client:        3 Claude Code skills (/ralph-task, /ralph-status, /ralph-review)
Infrastructure: Docker (node:20-slim + git + jq) on Hetzner CX22
States:        pending, in_progress, review, done, failed (5 states)
```

**Directory structure:**
```
.ralph/
  tasks/
    pending/
    in_progress/
    review/
    done/
    failed/
  config.json
  ralph-system.md        # --append-system-prompt-file
.claude/
  skills/
    ralph-task/SKILL.md
    ralph-status/SKILL.md
    ralph-review/SKILL.md
```

**How it works:**
```bash
while true; do
  git fetch origin && git merge --ff-only origin/main
  task=$(ls .ralph/tasks/pending/ | sort | head -1)
  [[ -z "$task" ]] && sleep 30 && continue

  # Claim
  git mv .ralph/tasks/pending/$task .ralph/tasks/in_progress/$task
  git add .ralph/tasks/in_progress/$task
  git commit -m "ralph($id): claimed"
  git push origin main || { git reset --hard origin/main; continue; }

  # Execute on branch
  git checkout -b ralph/$id
  timeout 1800 claude -p "$(cat .ralph/tasks/in_progress/$task)" \
    --model opus --output-format json --max-turns 50 --max-budget-usd 5 \
    --append-system-prompt-file .ralph/ralph-system.md \
    --dangerously-skip-permissions

  # Verify + push + update status
  ...
done
```

**Task file = prompt.** The task Markdown body is directly fed to Claude. No template layer.
The system prompt (ralph-system.md) provides all behavioral guardrails.

**Strengths:**
- Smallest codebase (~300 lines bash + 3 skills)
- Fastest to MVP (buildable in a few days)
- No build step, no dependencies beyond bash/git/node
- Easiest to understand and debug
- BATS tests are straightforward

**Weaknesses:**
- Bash gets painful past ~500 lines (complex error handling, YAML parsing)
- No unit-testable layers — it's one script
- prompt-engineer's critique: "cat the task file at Claude is not a prompt strategy"
- Fragile YAML parsing with grep/sed (need Node.js helper for edge cases)
- Hard to add prompt specialization per task type later

**Build order:**
1. Task file format (hand-verify)
2. ralph-loop.sh skeleton (poll + claim + echo, no Claude)
3. Git sync (test with BATS + local bare repos)
4. Mock Claude (bash stub)
5. Docker container
6. 3 Skills
7. Real Claude locally
8. Real Claude in Docker
9. VPS deployment

**Estimated complexity:** ~500 lines bash, ~200 lines BATS tests, 3 skill files

---

### Architecture B: "Typed Orchestrator"

**Philosophy:** Invest in structure upfront. Every component is independently testable.

**Advocates:** dx-client (primary), test-architect, distributed-arch, prompt-engineer

```
Orchestrator:  TypeScript with Bun (~1500 lines)
Testing:       bun test (unit + integration + e2e)
Prompting:     Template-per-task-type with variable interpolation
               Required fields: type, acceptance_criteria
Client:        4 Claude Code skills (/ralph-task, /ralph-status, /ralph-review, /ralph-list)
Infrastructure: Docker (node:20-slim + bun + git) on Hetzner CX22
States:        pending, active, review, done, failed (5 states)
Agent:         .claude/agents/ralph-worker.md with permissionMode: bypassPermissions
```

**Directory structure:**
```
.ralph/
  tasks/
    pending/
    active/
    review/
    done/
    failed/
  templates/
    bugfix.md
    feature.md
    default.md
  config.json
  ralph-system.md
src/
  orchestrator/
    index.ts           # Entry point (thin loop)
    task-parser.ts     # Parse MD + YAML frontmatter
    state-machine.ts   # Valid transitions, guards
    task-queue.ts      # Scan, filter, sort, pick
    prompt-builder.ts  # Template interpolation
    git-ops.ts         # Pull, commit, push, branch
    executor.ts        # Claude CLI wrapper
    verifier.ts        # Run tests/build/lint
  tests/
    unit/
    integration/
    e2e/
.claude/
  agents/
    ralph-worker.md
  skills/
    ralph-task/SKILL.md
    ralph-status/SKILL.md
    ralph-review/SKILL.md
    ralph-list/SKILL.md
```

**How it works:**
```typescript
// src/orchestrator/index.ts (simplified)
while (true) {
  await gitOps.pullMain()
  const task = await taskQueue.pickNext()       // scan pending/, sort, filter deps
  if (!task) { await sleep(30_000); continue }

  await stateMachine.transition(task, 'active') // git mv + update frontmatter
  await gitOps.commitAndPush(`ralph(${task.id}): claimed`)

  const branch = await gitOps.createBranch(`ralph/${task.id}`)
  const prompt = await promptBuilder.build(task) // template + interpolation
  const tools = getToolProfile(task.type)

  const result = await executor.run(prompt, { tools, maxTurns: 50, budget: 5 })
  const verified = await verifier.run(task)      // tests + build + lint

  if (verified) {
    await gitOps.pushBranch(branch)
    await stateMachine.transition(task, 'review')
  } else if (task.retryCount < task.maxRetries) {
    await stateMachine.transition(task, 'pending') // retry
  } else {
    await stateMachine.transition(task, 'failed')
  }
}
```

**Task file with required fields for prompt construction:**
```markdown
---
id: task-001
title: Fix null check in auth
type: bugfix              # REQUIRED — selects template
priority: 100
acceptance_criteria:      # REQUIRED — injected into prompt
  - "authenticate() handles null email"
  - "All tests pass"
files:                    # OPTIONAL — scopes agent attention
  - src/auth.ts
  - tests/auth.test.ts
constraints:              # OPTIONAL — injected into prompt
  - "Do not modify User model"
---
## Description
The authenticate() function crashes when user.email is null.
```

**Prompt construction:**
```
Task file → parse frontmatter → select template by type → interpolate variables
→ inject acceptance criteria + constraints + file scope → final prompt
```

**Strengths:**
- Every component is unit testable (parser, state machine, queue, builder, executor)
- Type safety catches bugs at compile time
- Prompt templates allow per-type behavioral tuning
- Clean separation of concerns
- Easy to extend (new task types, new templates)
- bun test runs full suite in <4 minutes

**Weaknesses:**
- More upfront investment (~1500 lines vs ~300)
- Bun dependency in Docker image (minor)
- Template interpolation adds a layer of abstraction
- Slightly longer path to MVP
- Over-engineered if requirements stay simple forever

**Build order (confidence ladder):**
1. Task parser (TypeScript, unit tested)
2. State machine (TypeScript, unit tested)
3. Task queue (integration tested with temp dirs)
4. Prompt builder (unit tested, template snapshots)
5. Git operations (integration tested with local bare repos)
6. Agent executor with mock Claude (e2e tested locally)
7. Full orchestrator loop (e2e tested locally)
8. Docker container
9. 4 Skills
10. Real Claude locally → in Docker → on VPS

**Estimated complexity:** ~1500 lines TypeScript, ~800 lines tests, 4 skill files

---

### Architecture C: "Claude-as-Orchestrator"

**Philosophy:** Don't write an orchestrator — let Claude BE the orchestrator.

**Advocates:** None directly (emerging from prompt-engineer's Agent SDK research)

```
Orchestrator:  Claude Code itself (via --agent ralph-orchestrator)
Outer loop:    Thin bash wrapper (~50 lines)
Prompting:     The orchestrator agent reads tasks and decides how to prompt the worker
Client:        Claude Code skills (same as B)
Infrastructure: Docker on Hetzner CX22
States:        Same directory-per-status as A and B
```

**How it works:**
```bash
# The entire outer loop
while true; do
  git pull --ff-only origin main

  if ls .ralph/tasks/pending/*.md 1>/dev/null 2>&1; then
    claude --agent ralph-orchestrator \
      --max-turns 100 \
      --max-budget-usd 10 \
      --dangerously-skip-permissions \
      --output-format json \
      -p "Check .ralph/tasks/pending/ for tasks. Pick the highest priority one, execute it, verify the results, and update the task status."
  fi

  git add .ralph/tasks/
  git commit -m "ralph: orchestration cycle complete" || true
  git push origin main || true
  sleep 30
done
```

**The orchestrator agent (.claude/agents/ralph-orchestrator.md):**
```markdown
---
name: ralph-orchestrator
description: Orchestrates task execution from the Ralph queue
model: opus
permissionMode: bypassPermissions
---
You are the Ralph orchestrator. Your job:
1. Read .ralph/tasks/pending/ and pick the highest-priority task
2. Move it to .ralph/tasks/active/ (git mv)
3. Create a branch ralph/<task-id>
4. Read the task carefully and execute it
5. Run tests to verify your work
6. If tests pass, move task to .ralph/tasks/review/
7. If tests fail, either fix and retry or move to .ralph/tasks/failed/
8. Push the branch and commit status changes

Rules:
- Be surgical. Only change what the task requires.
- Always run tests after changes.
- Never force push. Never modify .ralph/config.json.
- Commit with format: ralph(<task-id>): <action>
```

**Strengths:**
- Smallest codebase by far (~50 lines bash + 2 agent definitions)
- Maximum flexibility — Claude decides how to approach each task
- No template engine, no state machine code, no parser code
- Claude handles edge cases you didn't think of
- Can adapt to unexpected situations (conflicting deps, unclear tasks)
- Easiest to maintain (it's mostly Markdown)

**Weaknesses:**
- LEAST deterministic — Claude may make different orchestration decisions each run
- Highest API cost (orchestrator burns tokens on decision-making, not just task execution)
- Hardest to test — you can't unit test an LLM's orchestration decisions
- Debugging is archaeology through conversation logs
- If the orchestrator agent makes a bad decision (wrong task, wrong branch), recovery is manual
- Double the context window usage (orchestrator + worker thinking)
- prompt-engineer warns: "LLM generating inputs for another LLM is the most dangerous pattern"

**Build order:**
1. Task file format (same as A/B)
2. ralph-orchestrator.md agent definition
3. Thin bash wrapper
4. Test locally with trivial task
5. Docker container
6. VPS deployment
7. Skills (same as B)

**Estimated complexity:** ~50 lines bash, ~200 lines agent/system Markdown, 4 skill files

---

## Comparison Matrix

| Dimension | A: Shell-Native | B: Typed Orchestrator | C: Claude-as-Orchestrator |
|-----------|----------------|----------------------|--------------------------|
| **Lines of code** | ~500 bash | ~1500 TypeScript | ~50 bash + agents |
| **Time to MVP** | Days | 1-2 weeks | Hours |
| **Testability** | Medium (BATS) | High (unit + integration + e2e) | Low (manual only) |
| **Determinism** | High | High | Low |
| **Prompt quality** | Low (raw task file) | High (templates) | Medium (agent decides) |
| **Maintainability** | Medium | High | Low (opaque decisions) |
| **API cost/task** | ~$0.50-2 | ~$0.50-2 | ~$1-5 (double reasoning) |
| **Extensibility** | Low | High | Medium |
| **Debugging** | Read bash logs | Read typed logs + tests | Read conversation transcripts |
| **Risk** | Bash spaghetti at scale | Over-engineering | Non-deterministic orchestration |
| **Best for** | Quick proof of concept | Production system | Experimentation |

## Agent Votes

| Agent | 1st Choice | 2nd Choice | Reasoning |
|-------|-----------|-----------|-----------|
| **infra-ops** | A | B | "Bash is the right level of simplicity for V1" |
| **distributed-arch** | B | A | "Testable layers matter for state consistency" |
| **git-workflow** | A | B | "Less code = fewer git operation bugs" |
| **dx-client** | B | C | "TypeScript is the right long-term bet" |
| **prompt-engineer** | B | A | "Templates are essential for prompt quality" |
| **test-architect** | B | A | "Can't ship what you can't test" |

**Consensus: Architecture B wins 4-2**, with Architecture A as the strong fallback.
Architecture C is interesting for experimentation but too risky for a production system.

## Recommended Hybrid: Start A, Evolve to B

Several agents noted that A and B aren't mutually exclusive:

1. **Start with Architecture A** — get the loop working in bash with raw task files
2. **Prove the concept** — run a few real tasks through the system
3. **Graduate to Architecture B** — rewrite in TypeScript once the design is validated
4. **Keep Architecture C as an experiment** — try it on a branch to see how it compares

This matches the confidence ladder: prove each layer works before adding abstraction.
The bash prototype IS the specification for the TypeScript implementation.
