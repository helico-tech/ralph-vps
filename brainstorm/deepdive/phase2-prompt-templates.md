# Phase 2: Cross-Review from the Prompting Perspective

> **prompt-templates** | 2026-03-03 | Phase 2 cross-review of all deep-dive docs

---

## Part 1: Critique of Each Deep-Dive

### core-arch.md -- Hexagonal Architecture & Domain Design

**What they got right:**

- Pure core domain with zero I/O imports. This is exactly what the prompt builder needs to be: a pure function that takes a Task and a PromptTemplate and returns a string. No side effects, trivially testable. They understand this.
- The `buildPrompt()` function in `core/prompt-builder.ts` is pure string interpolation. Good.
- `PromptTemplate` type is minimal: `{ taskType: TaskType, templateBody: string }`. No over-abstraction.
- The orchestrator loop at line ~1058 correctly shows `buildPrompt(claimed, template)` followed by `getToolProfile(task.type, config)` -- the two outputs I need from the prompt layer.
- Template loading at startup (not per-task) is the right call. Templates don't change during a loop iteration.
- Tool profiles are a simple switch statement. No ceremony, no dependency injection for tool selection. Correct.

**Where prompt quality will suffer:**

1. **The `buildPrompt()` signature is too narrow.** Their version is `buildPrompt(task: Task, template: PromptTemplate): string`. My version in the Phase 1 deep-dive is `buildPrompt(task: TaskInput, config: ProjectConfig): PromptOutput`. The difference matters:
   - Their signature returns only a `string`. Mine returns `{ prompt, tools, maxTurns, maxBudget, timeoutSeconds, model }`. The prompt builder should co-locate ALL execution parameters because they're interdependent -- a research task needs different tools AND different turn limits AND a different budget. Separating these into different lookup points means they can drift out of sync.
   - Their signature doesn't receive the project config (test command, build command, lint command). So `{{test_command}}` in the template can't be interpolated. The template would have to hard-code `bun test`, which defeats the purpose of templates being project-agnostic.
   - **Fix:** Either expand `buildPrompt` to accept config, or keep it narrow but have the orchestrator call a wrapping function that combines prompt + execution params.

2. **The template interpolation uses Mustache-style `{{#list}}...{{/list}}` blocks.** My design uses pre-rendered arrays with simple `{{variable}}` replacement. The Mustache approach is more powerful but harder to test -- you need to verify that the regex handles nested blocks, empty arrays, and edge cases in the list syntax. Simple string replacement with pre-rendered variables has fewer failure modes.
   - **Fix:** Not a blocker. Both approaches work. But the test suite needs snapshot tests for every template with empty arrays, single items, and multiple items.

3. **`acceptanceCriteria` is optional (`string[] | undefined`) on the Task type.** In my design, `acceptance_criteria` is REQUIRED for the prompt builder to function. Without it, the agent has no definition of done. The core-arch Task type makes it optional because the parser doesn't enforce it.
   - **Fix:** Add a validation step between parsing and prompt building. The `isEligible()` function should reject tasks without acceptance_criteria. core-arch's parser should still accept optional fields (backward compatibility), but the orchestrator should reject tasks that don't meet entry criteria before reaching the prompt builder.

4. **No `ExecutionParams.systemPromptFile` is passed in the orchestrator loop.** Actually, looking at line ~1072 they DO pass `systemPromptFile: ".claude/ralph-system.md"`. Good. But the path is hardcoded. Should come from config.
   - **Fix:** Minor. Move to config: `config.systemPromptFile ?? ".ralph/ralph-system.md"`.

5. **The orchestrator only verifies when `stopReason === "end_turn"`.** Line ~1090: `if (result.stopReason === "end_turn")`. This means if Claude hits `max_turns`, verification is SKIPPED and the task goes straight to retry/fail. But a max_turns hit doesn't mean the code is broken -- Claude might have made valid changes before running out of turns. We should still verify. If tests pass despite hitting the turn limit, the task should go to review, not retry.
   - **Fix:** Run verification for `end_turn` AND `max_turns`. Only skip verification for `refusal`, `timeout`, and `error` (where Claude likely didn't produce anything useful).

**Conflict with my design:** The `buildPrompt` signature mismatch is real but resolvable. I propose a `buildExecutionPlan()` wrapper that calls their `buildPrompt()` for the prompt string and adds the execution parameters from config:

```typescript
function buildExecutionPlan(task: Task, template: PromptTemplate, config: RalphConfig): ExecutionPlan {
  const prompt = buildPrompt(task, template); // core-arch's pure function
  const tools = getToolProfile(task.type, config);
  return {
    prompt,
    tools,
    model: config.model,
    maxTurns: config.perType?.[task.type]?.maxTurns ?? config.maxTurns,
    budgetUsd: config.perType?.[task.type]?.budgetUsd ?? config.budgetUsd,
    timeoutMs: config.perType?.[task.type]?.timeoutMs ?? config.taskTimeoutMs,
    systemPromptFile: config.systemPromptFile,
  };
}
```

This preserves core-arch's pure `buildPrompt` while adding the execution context I need.

**Score: 8/10.** The architecture is clean and the prompt builder is correctly placed in the pure core. The gaps are in execution parameter co-location and entry criteria enforcement, both fixable.

---

### observability.md -- Metrics & Introspection

**What they got right:**

- Execution trace design is thorough. The `ExecutionTrace` interface (Section 2.1) captures everything I need for exit criteria tuning: `stopReason`, `numTurns`, `totalCostUsd`, `toolCalls`, `verification.testsPass`.
- Section 5 ("Entry/Exit Criteria Tuning") directly addresses my domain. The `tuningRecommendations()` function that analyzes trace history and suggests adjustments to `--max-turns` and `--max-budget-usd` is exactly what I envisioned in my Phase 1 deep-dive. They got the feedback loop right.
- The decision to use `stream-json` for rich tool tracking is important for prompt quality. If we can see WHICH tools the agent used and how often, we can detect patterns like "agent spent 20 turns searching with Grep because the `files` field was empty" -- which tells us the task needed better file scoping.
- Cost tracking with per-type averages. This feeds directly into per-type budget defaults.
- Anomaly detection. `toolCallCount > avg * 3` is a reasonable heuristic for "the prompt was probably unclear."

**Where prompt quality depends on observability getting it right:**

1. **The trace doesn't capture the prompt hash.** My Phase 1 design includes `prompt_hash: "sha256:abc..."` in the execution log. This is critical for prompt regression detection. If someone edits a template and tasks start failing, you need to correlate "the prompt changed" with "the failure rate spiked." Without a prompt hash, you're guessing.
   - **Fix:** Add `promptHash: string` to `ExecutionTrace`. Compute it in the prompt builder: `crypto.createHash('sha256').update(prompt).digest('hex')`.

2. **No capture of WHICH template was used.** The trace has `taskType` but not `templateVersion` or `templateHash`. If we change the bugfix template and performance degrades, we need the trace to show "this task used template version X."
   - **Fix:** Add `templateId: string` (e.g., `"bugfix.md@sha256:abc..."`) to the trace. Compute alongside prompt hash.

3. **The tuning recommendations don't account for template quality.** The `tuningRecommendations()` function assumes that turn limits and budgets are the only knobs. But if 40% of bugfix tasks fail verification, the problem might be the bugfix template, not the turn limit. The recommendations should also flag "high failure rate for type X -- consider reviewing the template."
   - **Fix:** Add a recommendation type: `template_review_needed`. Trigger when failure rate for a type exceeds 25%.

4. **Missing: verification failure output in the trace.** The trace has `verification.testsPass: boolean` but not the test output. When a task fails verification, I need to see WHY the tests failed to determine if the prompt was unclear vs. the task was too hard. The test failure output is the most important debugging signal for prompt quality.
   - **Fix:** Add `verification.output: string` (truncated to ~2000 chars) to the trace. They have `output: string` on `VerificationResult` in core-arch but it doesn't flow into the trace.

5. **The observability port (`emit(event: DomainEvent)`) is clean but the events don't include prompt metadata.** The `execution.started` event has `taskId` and `sessionId` but not the prompt hash, template used, or tool profile. If we later want to correlate "prompts of type X with tool profile Y produce better outcomes than profile Z," we need these in the event stream.
   - **Fix:** Expand `execution.started` event to include `{ promptHash, templateId, toolProfile }`.

**Does observability capture enough data to tune entry/exit criteria?**

Yes, with the additions above. The core data is there: turns used, cost, stop reason, verification pass/fail, per-type breakdown. What's missing is the prompt-side correlation: which template, which prompt hash, which tool profile. Without those, you can tune WHAT limits to set but not diagnose WHY tasks fail.

**Score: 7/10.** Strong on the execution and cost side. Weak on prompt-level diagnostics. The feedback loop from observability to prompt quality is one-directional (tune limits) when it should be bidirectional (tune limits AND tune templates).

---

### onboarding.md -- First Run Experience

**What they got right:**

- Project detection (Section 5) auto-detects test/build/lint commands from `package.json`, `Cargo.toml`, etc. This directly feeds into my template's `{{test_command}}`, `{{build_command}}`, `{{lint_command}}` variables. If the detected commands are wrong, every task prompt will have wrong verification instructions. Good that they make it editable in `config.json`.
- `ralph init project` creates `.ralph/templates/default.md`. This is where my templates land.
- The `ralph hello` first-task experience (Section 4) creates a task with `type: default` and `acceptance_criteria`. This proves the full prompt construction pipeline works end-to-end.
- The `config.json` generated by `ralph init project` includes `commands.test`, `commands.build`, `commands.lint` -- exactly the fields my prompt builder reads.

**Where prompt quality will suffer:**

1. **The `ralph hello` task uses `type: default`.** This means it goes through the default template, not a specialized one. That's fine for a hello-world task, but it doesn't test the template selection logic. The first REAL task the user creates will be the first time a specialized template is used. If there's a bug in template selection, the hello task won't catch it.
   - **Fix:** After `ralph hello`, suggest: "Now try creating a bugfix task to test the full template pipeline." Or make `ralph hello` create TWO tasks: one default, one typed.

2. **The `ralph init project` config uses `task_defaults.model: "claude-sonnet-4-20250514"`.** Sonnet as default model. For some task types (especially feature and refactor), Sonnet may produce lower quality results than Opus. The model choice directly affects prompt effectiveness -- a well-crafted prompt on a less capable model can still underperform a basic prompt on Opus.
   - **Fix:** Not a bug, just a configuration default. The user can change it. But the docs should mention that model selection affects task quality, not just cost.

3. **No template customization guidance in onboarding.** `ralph init project` creates the template files, but there's no guidance on WHEN or HOW to customize them. A new user might look at `default.md` and think "I should change this" when they shouldn't -- or never look at it and wonder why the agent isn't following their project's specific conventions.
   - **Fix:** Add a section to the quickstart: "Your templates live in `.ralph/templates/`. The default works for most tasks. Customize when you have project-specific workflow requirements (e.g., 'always run database migrations before tests')."

4. **The CLAUDE.md content added by `ralph init project` (Section 5, line ~508) conflicts with the system prompt.** Both say things like "Only modify files mentioned in the task's `files` field" and "Run the test command after every significant change." Having the same instruction in CLAUDE.md AND the system prompt AND the task template means triple-loading Claude's attention with redundant rules. Claude sees all three simultaneously, and redundancy doesn't help -- it wastes context tokens.
   - **Fix:** CLAUDE.md should contain project conventions (build commands, naming conventions, architecture overview). The system prompt (`ralph-system.md`) should contain Ralph-specific behavioral rules. The task template should contain task-specific workflow. Zero overlap. If `ralph init project` adds Ralph rules to CLAUDE.md, those rules should NOT duplicate what's in the system prompt.

**Score: 6/10.** Good scaffolding that correctly feeds into the prompt pipeline. The CLAUDE.md/system-prompt overlap is a real prompt quality issue. The rest is minor configuration concerns.

---

### client-interface.md -- Skills + CLI

**What they got right:**

- The `/ralph-task` skill (Section 2) explicitly structures task creation with `type`, `acceptance_criteria`, `files`, `constraints`. This ensures tasks created by the user have the fields my prompt builder requires. If the skill produces well-formed tasks, the prompt pipeline works.
- The skill says "If the description is too vague to create useful acceptance criteria, ask the user to clarify BEFORE creating the file." This is the single most important quality gate in the entire system. A vague task with weak acceptance criteria produces a weak prompt that produces weak code.
- The CLI's `ralph task create` mirrors the skill's structure. Both produce the same task format.
- The review workflow (Section 5) with reject -> feedback -> pending -> re-execute means rejected tasks get a second pass with context. The review feedback is appended to the task body, which my template's `{{description}}` variable will include. The agent sees the feedback.

**Where prompt quality will suffer:**

1. **The `/ralph-task` skill puts acceptance criteria in the Markdown body, not in the YAML frontmatter.** Look at the skill output format (Section 2, line ~230):

   ```markdown
   ---
   id: <task-id>
   title: "<title>"
   status: pending
   priority: <priority>
   type: <type>
   created: <ISO 8601>
   author: <git user.name>
   ---
   ## Acceptance Criteria
   - criterion 1
   ```

   The `acceptance_criteria` field is NOT in the frontmatter. It's in the Markdown body under a `## Acceptance Criteria` heading. My prompt builder reads `task.acceptanceCriteria` from parsed frontmatter. If acceptance criteria are in the body, the parser won't extract them, and the template's `{{acceptance_criteria}}` variable will be empty (or fallback to "No criteria specified").

   This is the **most critical contract mismatch** across all five documents. The skill produces tasks that the orchestrator's prompt builder can't properly consume.

   - **Fix:** The skill MUST put `acceptance_criteria` as a YAML frontmatter array, not as Markdown headings. The body should contain the description only. Acceptance criteria, files, and constraints all belong in frontmatter where the parser can extract them as structured data.

   Alternatively, the parser could extract acceptance criteria from the Markdown body by looking for `## Acceptance Criteria` headings. But that's fragile and couples the parser to a specific Markdown structure. Frontmatter is the right place for structured data.

2. **The skill doesn't include `files` in the frontmatter either.** It has a `## Files` heading in the Markdown body. Same problem.

3. **The `type` vocabulary differs.** The skill uses `'feature' | 'bugfix' | 'refactor' | 'test' | 'docs'`. My template system uses `'bugfix' | 'feature' | 'refactor' | 'research' | 'test' | 'chore'`. Note `docs` vs `research`, and missing `chore`. If the skill creates a `type: docs` task, my template selector won't find a `docs.md` template and will fall back to `default.md`.
   - **Fix:** Standardize the type enum across ALL components. One canonical list. My recommendation: `bugfix`, `feature`, `refactor`, `research`, `test`, `chore`. The skill should use this list, the templates should match this list, the config should reference this list.

4. **The skill creates tasks with `status: pending` in frontmatter.** But the task is being written to `.ralph/tasks/pending/` directory. Having status in BOTH the frontmatter and the directory is redundant and creates a consistency risk. core-arch's `checkConsistency()` function catches mismatches, but why create them in the first place?
   - **Fix:** Either the frontmatter status is canonical (and the directory is derived) or the directory is canonical (and frontmatter status is informational). The consensus says directory = status (`git mv` IS the state transition). So frontmatter `status` is informational/redundant. The skill should still include it for human readability, but the orchestrator should trust the directory, not the frontmatter.

5. **The skill's acceptance criteria quality depends on Claude Code's interpretation.** The skill says "be specific" but Claude Code (running the skill) might still produce vague criteria like "the feature works correctly." There's no programmatic validation of criteria quality.
   - **Fix:** Not fixable with technology. Document examples of good vs. bad criteria in the skill. Show: "BAD: Works correctly. GOOD: Returns 429 status code when rate limit exceeded."

**Does client-interface ensure required fields for prompt construction?**

Partially. The skill structures the output correctly (title, type, priority) but puts `acceptance_criteria` and `files` in the wrong location (body instead of frontmatter). The CLI adapter presumably calls the core `createTask()` which takes `TaskCreateOptions` with `acceptanceCriteria?: string[]` -- but note the `?` (optional). It should be required for task creation, with the CLI refusing to create a task without at least one acceptance criterion.

**Score: 5/10.** The skill is thoughtfully designed for the user experience but has a critical contract mismatch with the prompt builder. The acceptance_criteria-in-body vs acceptance_criteria-in-frontmatter issue will cause real bugs. The type vocabulary mismatch is a smaller but real problem.

---

### node-runtime.md -- Docker, Bare VPS, Beyond

**What they got right:**

- "Docker is an adapter, not the architecture." Zero Docker references in orchestrator code. This means the prompt builder doesn't care where it runs. Good.
- The runtime contract (Section 1) lists `claude CLI` as a requirement with `claude --version` as the health check. The prompt builder's output flows directly into `claude -p "$PROMPT"` invocation. The runtime just needs to have the CLI available.
- Crash recovery (Section 8) moves orphaned `active/` tasks back to `pending/` or `failed/`. This is important for prompt construction because a retried task should get a FRESH prompt, not a continuation. They correctly use `task.retryCount++` and move to pending, which means the orchestrator will re-run the full prompt building pipeline.
- Graceful shutdown (Section 7) kills Claude mid-execution if SIGTERM is received. The task goes back to pending for retry. The prompt for the retry is built fresh, which is correct -- we don't want to resume a half-finished session.

**Does crash recovery affect prompt construction for retries?**

Yes, and this is a design question that neither document fully addresses:

1. **Fresh prompt on retry vs. retry-aware prompt.** Currently, when a task is retried after crash recovery, it gets the exact same prompt as the first attempt. The agent has no knowledge that this is a retry. This means it might repeat the same mistake.

   For verification failures (not crashes), we should consider including failure context in the retry prompt. My system prompt says "If tests keep failing after 3 attempts, STOP." But the system prompt doesn't tell the agent WHAT failed on the previous attempt.

   - **Option A: Fresh prompt every time.** Simple. The agent starts clean. If the task is well-specified, a fresh attempt might succeed where the first didn't (LLM non-determinism working in our favor).
   - **Option B: Append failure context to the retry prompt.** Add a section like:

     ```markdown
     ## Previous Attempt (failed)
     This is retry #2. The previous attempt failed because:
     - Test verification failed: `TypeError: Cannot read property 'email' of null` in test-auth.test.ts:42
     - The agent's approach: [brief summary from previous execution]
     ```

   - **Recommendation for V1: Option A (fresh prompt).** It's simpler, and the LLM's non-determinism gives retries a reasonable chance of success. Option B requires parsing the previous execution's output and summarizing it, which adds complexity.

2. **Crash recovery doesn't distinguish between "Claude crashed" and "VPS rebooted mid-execution."** In both cases, the task goes back to pending. But the task branch (`ralph/<task-id>`) may have partial commits from the aborted execution. The retry will create a NEW branch? Or reuse the existing one?

   Looking at core-arch's orchestrator loop (line ~1054): `await git.createBranch(branchName)`. This will fail if the branch already exists from a previous attempt. The crash recovery code (line ~1108-1123 in node-runtime) cleans stale branches, but only for tasks NOT in active or pending. A retried task IS in pending, so its branch might survive.

   - **Fix:** Before creating the task branch, check if it exists and delete it. Or use `git checkout -B` (force create). The retry should start from a clean slate.

3. **The graceful shutdown code (node-runtime Section 7, line ~982-1010) kills Claude with SIGTERM, waits 10s, then SIGKILL.** If Claude has made valid code changes but not yet committed, those changes are lost. The task retries from scratch. This is fine for V1, but means that long-running tasks (feature, refactor) might lose significant work on shutdown.

   - **Mitigation (V2):** Before killing Claude, stage and commit any changes: `git add -u && git commit -m "ralph(task-id): partial work before shutdown"`. This preserves progress. But it complicates the retry prompt -- do we tell the agent about the partial commit?

**Score: 7/10.** Solid runtime design that correctly interacts with the prompt pipeline. The crash recovery -> retry flow is clean. The gap is in retry-aware prompting and stale branch handling, both of which are V2 concerns.

---

## Part 2: Agent Rankings (From Prompting Perspective)

**Who designed their component in a way that best serves prompt quality?**

### 1. core-arch (Score: 8/10)

Placed the prompt builder in the pure core where it belongs. The `buildPrompt()` function is testable, the template loading is simple, and the orchestrator loop correctly sequences: build prompt -> select tools -> execute -> verify. The `buildPrompt` signature is too narrow (missing config injection) but that's a 5-minute fix. They understand that the prompt builder is the heart of the system.

### 2. observability (Score: 7/10)

Designed the feedback loop that makes prompt quality improvable over time. Trace history -> tuning recommendations -> adjusted limits -> better outcomes. Missing prompt-level correlation (template hash, prompt hash) which limits the ability to answer "did this template change make things better or worse?" But the infrastructure is there to add it.

### 3. node-runtime (Score: 7/10)

Clean runtime that doesn't interfere with prompt construction. Crash recovery correctly triggers fresh prompt building on retry. The graceful shutdown interaction with Claude execution is well-thought-out. The gap is in retry-aware prompting, which is a V2 concern.

### 4. onboarding (Score: 6/10)

Creates the scaffolding that templates live in and auto-detects the commands that templates reference. But the CLAUDE.md overlap with the system prompt is a real prompt quality issue (redundant instructions waste context), and there's no template customization guidance.

### 5. client-interface (Score: 5/10)

The skill is well-designed for user experience but has the most critical contract mismatch: acceptance criteria in Markdown body instead of YAML frontmatter. This breaks the prompt builder's ability to extract structured data from tasks. If this isn't fixed, every task created via the skill will have empty `{{acceptance_criteria}}` in the prompt. The type vocabulary mismatch is a secondary but real issue.

---

## Part 3: Conflicts Found

### CRITICAL: acceptance_criteria Location

| Component | Where acceptance_criteria lives |
|-----------|-------------------------------|
| My prompt builder | `task.acceptanceCriteria` (parsed from YAML frontmatter) |
| core-arch's Task type | `acceptanceCriteria?: string[]` (optional, from frontmatter) |
| client-interface's skill | `## Acceptance Criteria` section in Markdown body |
| onboarding's hello task | `acceptance_criteria:` in YAML frontmatter |

client-interface's skill is the outlier. It must put acceptance_criteria in frontmatter.

### HIGH: Type Vocabulary

| Component | Types |
|-----------|-------|
| My templates | `bugfix`, `feature`, `refactor`, `research`, `test`, `chore` |
| core-arch's TaskType | `bugfix`, `feature`, `refactor`, `test`, `research`, `default` |
| client-interface's skill | `feature`, `bugfix`, `refactor`, `test`, `docs` |
| onboarding's hello task | `default` |

Discrepancies: `docs` vs `research`. Missing `chore` in core-arch and client-interface. `default` exists in core-arch and onboarding but not in my templates (I use `default.md` as fallback, not as a type).

**Proposed canonical list:** `bugfix`, `feature`, `refactor`, `research`, `test`, `chore`. With `default` as the template fallback, not a task type.

### MEDIUM: buildPrompt Signature

| Component | Signature |
|-----------|-----------|
| My prompt builder | `buildPrompt(task: TaskInput, config: ProjectConfig): PromptOutput` |
| core-arch's prompt builder | `buildPrompt(task: Task, template: PromptTemplate): string` |

Resolvable with a wrapper function. core-arch's pure version stays in core; my config-aware version wraps it in the orchestrator.

### MEDIUM: CLAUDE.md vs System Prompt Overlap

onboarding adds Ralph-specific rules to CLAUDE.md. I define those same rules in `ralph-system.md`. Both are loaded into every Claude session. The redundancy wastes context tokens and could cause confusion if they drift apart.

**Fix:** CLAUDE.md = project conventions only (build commands, naming, architecture). `ralph-system.md` = Ralph behavioral rules only (autonomy, commits, scope, stuck protocol). `ralph init project` should NOT add Ralph rules to CLAUDE.md.

### LOW: Verification Skip on max_turns

core-arch skips verification when `stopReason !== "end_turn"`. This is too aggressive -- `max_turns` hits should still trigger verification because the agent may have completed valid work before exhausting turns.

### LOW: Retry Prompt Freshness

No component addresses whether a retry prompt should include context from the failed attempt. All agree retries get a fresh prompt. This is fine for V1 but limits retry effectiveness.

---

## Part 4: Proposed Fixes

### Fix 1: Acceptance Criteria in Frontmatter (client-interface)

The `/ralph-task` skill output format must change from:

```markdown
---
id: task-001
title: "Fix auth bug"
type: bugfix
---
## Acceptance Criteria
- authenticate() handles null email
```

To:

```markdown
---
id: task-001
title: "Fix auth bug"
type: bugfix
acceptance_criteria:
  - "authenticate() handles null email"
files:
  - src/auth.ts
constraints:
  - "Do not modify User model"
---
## Description
The authenticate() function crashes when...
```

### Fix 2: Canonical Type Enum

All components must use:

```typescript
type TaskType = "bugfix" | "feature" | "refactor" | "research" | "test" | "chore";
```

`default` is not a type -- it's a template fallback.

### Fix 3: buildPrompt Wrapper

Keep core-arch's pure `buildPrompt(task, template): string` in core.
Add a wrapper in the orchestrator:

```typescript
function buildExecutionPlan(
  task: Task,
  template: PromptTemplate,
  config: RalphConfig
): ExecutionPlan {
  // Inject config values into template before core buildPrompt
  const enrichedTemplate = injectConfigValues(template, config);
  const prompt = buildPrompt(task, enrichedTemplate);
  const tools = getToolProfile(task.type, config);

  return {
    prompt,
    tools,
    model: config.perType?.[task.type]?.model ?? config.model,
    maxTurns: config.perType?.[task.type]?.maxTurns ?? config.maxTurns,
    budgetUsd: config.perType?.[task.type]?.budgetUsd ?? config.budgetUsd,
    timeoutMs: config.perType?.[task.type]?.timeoutMs ?? config.taskTimeoutMs,
    systemPromptFile: config.systemPromptFile ?? ".ralph/ralph-system.md",
  };
}
```

### Fix 4: Remove Ralph Rules from CLAUDE.md Init

`ralph init project` should append to CLAUDE.md:

```markdown
## Build & Test
- `bun test` -- run all tests
- `bun run build` -- build the project
- `bun run lint` -- run linter
```

NOT:

```markdown
## Ralph Task Execution
When executing Ralph tasks, follow these rules:
1. Read the task file completely...
```

Those rules belong in `ralph-system.md` only.

### Fix 5: Prompt Hash in Traces

Add to `ExecutionTrace`:

```typescript
interface ExecutionTrace {
  // ... existing fields ...
  promptHash: string;       // SHA-256 of the constructed prompt
  templateId: string;       // e.g., "bugfix" or "default"
}
```

### Fix 6: Verify on max_turns

Change core-arch's verification gate from:

```typescript
if (result.stopReason === "end_turn") {
  verification = await verifier.verify(...);
}
```

To:

```typescript
if (result.stopReason === "end_turn" || result.stopReason === "max_turns") {
  verification = await verifier.verify(...);
}
```

---

## Part 5: What V1 Must Get Right for Prompt Quality

The priority order for prompt-affecting decisions:

1. **Acceptance criteria in frontmatter.** Without this, every prompt is missing its most important section. Fix the client-interface skill first.
2. **Canonical type enum.** Without this, template selection silently falls back to default for mismatched types. Tasks get generic prompts when they should get specialized ones.
3. **Config values in templates.** Without `{{test_command}}` interpolation, the agent doesn't know how to verify its work. The `buildPrompt` wrapper must inject config values.
4. **No CLAUDE.md/system-prompt overlap.** Redundant instructions waste 500-1000 tokens per task. At scale, this adds up.
5. **Prompt hash in traces.** Without this, you can't correlate template changes with quality changes. Flying blind on prompt iteration.
6. **Verify on max_turns.** Without this, partially-completed tasks that actually pass tests are thrown away. Waste of tokens and time.

Everything else is optimization. These six are correctness.
