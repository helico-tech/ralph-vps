# Prompt Engineering & Agent Loop Design -- Brainstorm

> Phase 1 research by **prompt-engineer** | 2026-03-03

---

## Table of Contents

1. [Ralph Loop Mechanics (Claude Code CLI Capabilities)](#1-ralph-loop-mechanics)
2. [Deterministic Prompt Construction](#2-deterministic-prompt-construction)
3. [Task-to-Prompt Pipeline](#3-task-to-prompt-pipeline)
4. [Exit Conditions](#4-exit-conditions)
5. [Feedback Loop Design](#5-feedback-loop-design)
6. [Agent Autonomy Boundaries](#6-agent-autonomy-boundaries)
7. [Prompt Templates by Task Type](#7-prompt-templates-by-task-type)
8. [Context Management](#8-context-management)
9. [Reproducibility](#9-reproducibility)
10. [Loop Orchestration](#10-loop-orchestration)

---

## 1. Ralph Loop Mechanics

### Claude Code CLI: Headless / Non-Interactive Mode

The `-p` (or `--print`) flag is the entry point to headless mode. It sends a single prompt to Claude Code, prints the response to stdout, and exits. No interactive session, no waiting for user input.

```bash
claude -p "Find and fix the bug in auth.py" --allowedTools "Read,Edit,Bash"
```

### Key CLI Flags for Automation

| Flag | Purpose | Example |
|------|---------|---------|
| `-p` / `--print` | Non-interactive mode; send prompt, get response, exit | `claude -p "query"` |
| `--output-format` | Control output: `text`, `json`, `stream-json` | `--output-format json` |
| `--json-schema` | Enforce structured JSON output matching a schema | `--json-schema '{"type":"object",...}'` |
| `--allowedTools` | Pre-approve tools (no permission prompts) | `--allowedTools "Bash,Read,Edit"` |
| `--disallowedTools` | Remove tools from the model's context entirely | `--disallowedTools "WebSearch"` |
| `--tools` | Restrict which built-in tools are available (allowlist) | `--tools "Bash,Edit,Read"` |
| `--max-turns` | Limit agentic turns; exits with error when hit | `--max-turns 50` |
| `--max-budget-usd` | Dollar cap on API calls; stops when exceeded | `--max-budget-usd 5.00` |
| `--model` | Select model (alias `sonnet`/`opus` or full name) | `--model opus` |
| `--fallback-model` | Auto-fallback on overload (print mode only) | `--fallback-model sonnet` |
| `--system-prompt` | Replace the ENTIRE default system prompt | `--system-prompt "You are..."` |
| `--append-system-prompt` | Add instructions, keep default Claude Code behavior | `--append-system-prompt "Always use TS"` |
| `--system-prompt-file` | Load replacement system prompt from file | `--system-prompt-file ./prompt.txt` |
| `--append-system-prompt-file` | Append instructions from file, keep defaults | `--append-system-prompt-file ./rules.txt` |
| `--continue` / `-c` | Continue the most recent conversation | `claude -c -p "now fix tests"` |
| `--resume` / `-r` | Resume a specific session by ID or name | `claude -r "$SESSION_ID" -p "continue"` |
| `--session-id` | Use a specific UUID for the session | `--session-id "550e8400-..."` |
| `--no-session-persistence` | Do not save sessions to disk | `--no-session-persistence` |
| `--dangerously-skip-permissions` | Skip ALL permission prompts (YOLO mode) | Use with extreme caution |
| `--permission-mode` | Set permission mode (`plan`, `acceptEdits`, etc.) | `--permission-mode plan` |
| `--verbose` | Full turn-by-turn output; useful for debugging | `--verbose` |
| `--mcp-config` | Load MCP servers from JSON file | `--mcp-config ./mcp.json` |
| `--add-dir` | Add additional working directories | `--add-dir ../shared-lib` |
| `--worktree` / `-w` | Run in isolated git worktree | `claude -w feature-auth` |
| `--agents` | Define custom subagents inline via JSON | See subagent section |
| `--include-partial-messages` | Stream partial events (with `stream-json`) | For real-time monitoring |

### Output Formats

**`text`** (default): Plain text response. Good for simple pipe-to-file.

**`json`**: Structured JSON with `result`, `session_id`, metadata. Parse with `jq`.

```bash
claude -p "Summarize this project" --output-format json | jq -r '.result'
```

**`stream-json`**: Newline-delimited JSON events for real-time streaming.

```bash
claude -p "Write tests" --output-format stream-json --verbose --include-partial-messages | \
  jq -rj 'select(.type == "stream_event" and .event.delta.type? == "text_delta") | .event.delta.text'
```

### Claude Agent SDK (Programmatic Alternative)

The Claude Agent SDK (formerly Claude Code SDK) provides the same capabilities as a Python/TypeScript library. This is the **stronger option for production orchestration**.

```python
import asyncio
from claude_agent_sdk import query, ClaudeAgentOptions

async def run_task(prompt: str) -> str:
    result = None
    async for message in query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Edit", "Bash", "Glob", "Grep"],
            max_turns=50,
            max_budget_usd=5.0,
        ),
    ):
        if hasattr(message, "result"):
            result = message.result
    return result
```

Key SDK features:
- **Hooks** (PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd) for programmatic interception
- **Subagents** for delegating subtasks
- **Session persistence** for multi-turn workflows
- **Structured outputs** with JSON Schema validation
- **MCP server** integration for external tool access

### Recommendation for Ralph

**Use the CLI (`claude -p`) for V1, plan for SDK migration.** The CLI is simpler, shell-scriptable, and sufficient for a task queue runner. The SDK is the path for V2 when we need hooks, structured output validation, and programmatic control.

---

## 2. Deterministic Prompt Construction

### The Problem

LLMs are inherently non-deterministic. We cannot make identical outputs, but we CAN make identical *intent* -- the same task description should produce functionally equivalent results across runs.

### Principles for Deterministic Prompts

1. **Be maximally specific**: Vague prompts produce varied results. "Fix the bug" is bad. "Fix the null pointer exception in `auth.py:42` where `user.email` is accessed before null check" is good.
2. **Constrain the output shape**: Tell the model exactly what files to touch, what patterns to follow, what NOT to do.
3. **Provide acceptance criteria as assertions**: "The function should return X when given Y" gives the model a concrete target.
4. **Anchor to existing code**: Reference specific files, functions, line numbers. Don't leave the model guessing about scope.
5. **Separate instructions from context**: System prompt = how to behave. User prompt = what to do. Don't conflate them.

### Template Variable System

A task definition should contain structured fields that get interpolated into a prompt template:

```yaml
# task.yaml
id: "task-001"
type: "bugfix"                          # Selects the prompt template
title: "Fix null check in auth module"
description: |
  The `authenticate()` function in `src/auth.py` crashes when
  `user.email` is None. Add a null check before the email validation.
files:
  - src/auth.py
  - tests/test_auth.py
acceptance_criteria:
  - "authenticate() returns AuthError when user.email is None"
  - "All existing tests in test_auth.py still pass"
  - "A new test covers the null email case"
constraints:
  - "Do not modify the User model"
  - "Do not change the function signature"
context_refs:
  - "CLAUDE.md"                         # Always included
  - "docs/auth-architecture.md"         # Optional extra context
```

### Template Interpolation

```
You are working on task {{id}}: {{title}}.

## Task Description
{{description}}

## Files in Scope
{{#files}}
- {{.}}
{{/files}}

## Acceptance Criteria
{{#acceptance_criteria}}
- [ ] {{.}}
{{/acceptance_criteria}}

## Constraints
{{#constraints}}
- {{.}}
{{/constraints}}

## Instructions
1. Read the files in scope
2. Understand the current behavior
3. Implement the fix
4. Run the existing tests: `npm test` (or project-specific command)
5. Add new tests for the acceptance criteria
6. Verify all tests pass
7. Commit your changes with message: "fix: {{title}} [{{id}}]"
```

### Why This Works

- The template is the **constant**; the task YAML is the **variable**
- Same task type always gets the same prompt structure
- Acceptance criteria become the model's "definition of done"
- Constraints prevent scope creep
- File scoping focuses attention

---

## 3. Task-to-Prompt Pipeline

### Pipeline Stages

```
task.yaml -> validate -> select template -> interpolate -> inject context -> construct CLI args -> execute
```

### Stage 1: Validate Task

Parse and validate the task YAML/JSON. Reject malformed tasks before they hit the model.

```bash
# Pseudocode
validate_task() {
  # Required fields: id, type, title, description
  # Optional: files, acceptance_criteria, constraints, context_refs
  # type must be one of: bugfix, feature, refactor, research, test, review
}
```

### Stage 2: Select Template

Each task type maps to a prompt template file:

```
templates/
  bugfix.md
  feature.md
  refactor.md
  research.md
  test.md
  review.md
```

### Stage 3: Interpolate Variables

Replace `{{variable}}` placeholders with values from the task definition. Use a simple templating approach (envsubst, mustache, or even sed -- keep it boring).

### Stage 4: Inject Context

Prepend or append project context:
- **Always**: CLAUDE.md content (if exists)
- **If specified**: Additional context_refs from the task
- **Auto-detected**: Test commands, build commands, git branch info

### Stage 5: Construct CLI Arguments

Map task properties to CLI flags:

```bash
build_cli_args() {
  local args="claude -p"
  args+=" --output-format json"
  args+=" --max-turns ${MAX_TURNS:-50}"
  args+=" --max-budget-usd ${MAX_BUDGET:-5.00}"
  args+=" --model ${MODEL:-opus}"
  args+=" --allowedTools '${ALLOWED_TOOLS}'"

  # Use append-system-prompt-file for project rules
  if [ -f ".claude/ralph-system.md" ]; then
    args+=" --append-system-prompt-file .claude/ralph-system.md"
  fi

  echo "$args"
}
```

### Stage 6: Execute

Run the constructed command, capture output, parse JSON result.

```bash
RESULT=$(echo "$PROMPT" | claude -p \
  --output-format json \
  --max-turns 50 \
  --max-budget-usd 5.00 \
  --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
  2>/dev/null)

SESSION_ID=$(echo "$RESULT" | jq -r '.session_id')
OUTPUT=$(echo "$RESULT" | jq -r '.result')
```

---

## 4. Exit Conditions

### When Should the Ralph Loop Stop Working on a Task?

Multiple exit conditions, checked in priority order:

| Condition | How Detected | Action |
|-----------|-------------|--------|
| **Budget exceeded** | `--max-budget-usd` flag; SDK `error_max_budget_usd` | Mark task as `failed:budget` |
| **Turn limit reached** | `--max-turns` flag; SDK `error_max_turns` | Mark task as `failed:turns` |
| **Refusal** | `stop_reason === "refusal"` in JSON output | Mark task as `failed:refusal`, log reason |
| **Token limit** | `stop_reason === "max_tokens"` | May retry with `--continue`; else `failed:tokens` |
| **Tests pass** | Post-execution test run exits 0 | Mark task as `completed:verified` |
| **Tests fail** | Post-execution test run exits non-zero | Mark task as `failed:tests` |
| **Clean exit** | `stop_reason === "end_turn"`, result looks complete | Mark task as `completed:unverified` |
| **Execution error** | SDK `error_during_execution` | Mark task as `failed:error`, log details |
| **Timeout** | Outer loop wall-clock timer | Kill process, mark `failed:timeout` |

### The Verification Step (Critical)

After Claude finishes, the orchestrator should ALWAYS run a verification step:

```bash
# Post-execution verification
verify_task() {
  local task_type="$1"

  # 1. Did the expected files change?
  git diff --name-only | check_against_expected_files

  # 2. Do tests pass?
  npm test 2>&1
  local test_exit=$?

  # 3. Does it build?
  npm run build 2>&1
  local build_exit=$?

  # 4. Linting clean?
  npm run lint 2>&1
  local lint_exit=$?

  if [ $test_exit -eq 0 ] && [ $build_exit -eq 0 ]; then
    echo "verified"
  else
    echo "failed"
  fi
}
```

### Timeout Strategy

Set a wall-clock timeout on the outer orchestrator, NOT just `--max-turns`:

```bash
timeout 600 claude -p "$PROMPT" --max-turns 50 --max-budget-usd 5.00 ...
```

This provides a hard 10-minute cap (adjustable per task type). The `--max-turns` and `--max-budget-usd` are soft limits that let Claude finish gracefully; the `timeout` command is the hard kill.

### Retry Logic

Not all failures are terminal. A simple retry matrix:

| Failure Type | Retry? | Strategy |
|-------------|--------|----------|
| `failed:budget` | No | Task needs scoping reduction |
| `failed:turns` | Maybe | Increase turns, or split task |
| `failed:refusal` | No | Task needs prompt rewrite |
| `failed:tests` | Yes (1x) | Resume session, give test output as context |
| `failed:timeout` | No | Task needs scoping reduction |
| `failed:error` | Yes (1x) | Fresh attempt |
| `completed:unverified` | N/A | Send to review queue |

### Session Continuation for Retries

On test failure, resume the same session with error context:

```bash
claude -p "The tests failed with the following output:\n$TEST_OUTPUT\n\nPlease fix the issues." \
  --resume "$SESSION_ID" \
  --output-format json
```

---

## 5. Feedback Loop Design

### Post-Task Flow

```
Task Completes
    |
    v
Run Verification (tests, build, lint)
    |
    +-- PASS --> Auto-accept? --> YES --> Commit & push
    |                        \-> NO  --> Create review task
    |
    +-- FAIL --> Retry eligible? --> YES --> Resume with error context
                                \-> NO  --> Create fix task / alert user
```

### When to Auto-Accept vs. Review

| Condition | Decision |
|-----------|----------|
| Tests pass + task type is `bugfix` + diff < 50 lines | Auto-accept |
| Tests pass + task type is `test` (adding tests only) | Auto-accept |
| Tests pass + task type is `refactor` + no API changes | Auto-accept |
| Tests pass + task type is `feature` | Create review task |
| Tests pass + diff > 100 lines | Create review task |
| Tests pass + new files created | Create review task |
| Any test failure | Create fix task (if retries exhausted) |
| Any build failure | Create fix task + alert |

### Review Task Auto-Generation

When a review task is needed, auto-generate it from the completed task:

```yaml
id: "review-task-001"
type: "review"
title: "Review: Fix null check in auth module"
description: |
  Task task-001 completed. Please review the changes.
parent_task: "task-001"
diff_summary: |
  Modified: src/auth.py (+12 -3)
  Modified: tests/test_auth.py (+28 -0)
review_checklist:
  - "Changes are minimal and focused"
  - "No unrelated modifications"
  - "Test coverage is adequate"
  - "No security concerns"
  - "Code style matches project conventions"
session_id: "abc-123"  # For resuming if needed
```

### Human-in-the-Loop Integration

For the user on their laptop, the review feedback loop:

1. **Pull** latest task queue state
2. **See** completed tasks pending review with diffs
3. **Approve**, **reject** (with notes), or **request changes**
4. Rejected tasks auto-generate a new task with the rejection feedback

```yaml
# Rejection becomes a new task
id: "task-001-revision"
type: "bugfix"
title: "Revision: Fix null check in auth module"
description: |
  Previous attempt (task-001) was rejected for the following reasons:
  - "The null check should use early return pattern, not nested if"
  - "Missing edge case: empty string email"
parent_task: "task-001"
rejection_feedback: |
  Use early return pattern. Also handle empty string, not just None.
```

---

## 6. Agent Autonomy Boundaries

### Unsupervised Operations (Auto-Approve)

These are safe for the agent to do without human intervention:

| Operation | Tool/Flag | Rationale |
|-----------|-----------|-----------|
| Read any file | `Read`, `Glob`, `Grep` | Non-destructive |
| Run tests | `Bash(npm test *)`, `Bash(pytest *)` | Non-destructive, bounded |
| Run linter | `Bash(npm run lint *)` | Non-destructive |
| Run type checker | `Bash(npx tsc *)` | Non-destructive |
| Edit files in scope | `Edit`, `Write` | Needed for the task |
| Git operations (status, diff, log) | `Bash(git status *)`, etc. | Non-destructive |
| Git commit (to feature branch) | `Bash(git commit *)` | Reversible, on branch |

### Supervised Operations (Require Review or Guard Rails)

| Operation | Risk | Mitigation |
|-----------|------|-----------|
| `git push` | Pushes to remote | Only after verification passes |
| `npm install` | Changes dependencies | Only if task explicitly requires it; pin versions |
| `rm` / file deletion | Data loss | Only files created in this task session |
| Network requests | Side effects | Block `WebFetch`/`WebSearch` unless task type is `research` |
| Database operations | Data mutation | Block entirely in V1 |

### Forbidden Operations

| Operation | Why |
|-----------|-----|
| `git push --force` | Can destroy remote history |
| `git checkout main` | Should never touch main directly |
| `rm -rf` | Just no |
| `curl` to external APIs with credentials | Credential exposure |
| Modifying CI/CD configs | Blast radius too large |
| Modifying `.env` or secrets | Security |

### Implementing Boundaries with `--allowedTools`

The `--allowedTools` flag uses permission rule syntax with prefix matching:

```bash
claude -p "$PROMPT" \
  --allowedTools \
    "Read" \
    "Edit" \
    "Write" \
    "Glob" \
    "Grep" \
    "Bash(npm test *)" \
    "Bash(npm run lint *)" \
    "Bash(npm run build *)" \
    "Bash(npx tsc *)" \
    "Bash(git status *)" \
    "Bash(git diff *)" \
    "Bash(git log *)" \
    "Bash(git add *)" \
    "Bash(git commit *)"
```

Note: The space before `*` matters. `Bash(git diff *)` allows `git diff --staged` but NOT `git diff-index`.

### Per-Task-Type Tool Profiles

```bash
# tool-profiles.sh
tools_readonly="Read Glob Grep"
tools_test="$tools_readonly Bash(npm test *) Bash(npx jest *) Bash(pytest *)"
tools_edit="$tools_readonly Edit Write"
tools_full="$tools_edit Bash(npm test *) Bash(npm run lint *) Bash(npm run build *) Bash(git add *) Bash(git commit *)"

case "$TASK_TYPE" in
  research)  TOOLS="$tools_readonly Bash(npm run *)" ;;
  review)    TOOLS="$tools_readonly" ;;
  test)      TOOLS="$tools_full" ;;
  bugfix)    TOOLS="$tools_full" ;;
  feature)   TOOLS="$tools_full" ;;
  refactor)  TOOLS="$tools_full" ;;
esac
```

---

## 7. Prompt Templates by Task Type

### Bugfix Template

```markdown
# Task: {{title}} [{{id}}]

## Role
You are a senior developer fixing a bug. Be surgical -- change only what's necessary.

## Bug Description
{{description}}

## Files to Investigate
{{#files}}
- {{.}}
{{/files}}

## Acceptance Criteria
{{#acceptance_criteria}}
- [ ] {{.}}
{{/acceptance_criteria}}

## Constraints
- Only modify files listed in "Files to Investigate" unless absolutely necessary
- Do not refactor unrelated code
- Do not change function signatures unless required by the fix
{{#constraints}}
- {{.}}
{{/constraints}}

## Workflow
1. Read the relevant files to understand the current code
2. Identify the root cause of the bug
3. Implement the minimal fix
4. Run tests: `{{test_command}}`
5. If tests fail, fix and re-run
6. Add a test that would have caught this bug
7. Run full test suite to ensure no regressions
8. Commit: `git add -A && git commit -m "fix: {{title}} [{{id}}]"`
```

### Feature Template

```markdown
# Task: {{title}} [{{id}}]

## Role
You are a senior developer implementing a new feature. Follow existing
patterns and conventions in the codebase.

## Feature Description
{{description}}

## Files to Modify or Create
{{#files}}
- {{.}}
{{/files}}

## Acceptance Criteria
{{#acceptance_criteria}}
- [ ] {{.}}
{{/acceptance_criteria}}

## Constraints
- Follow existing code patterns and conventions
- Add appropriate error handling
- Include tests for all new functionality
{{#constraints}}
- {{.}}
{{/constraints}}

## Workflow
1. Read CLAUDE.md and relevant existing code to understand patterns
2. Plan the implementation (think before you code)
3. Implement the feature incrementally
4. Write tests alongside the implementation
5. Run tests: `{{test_command}}`
6. Run linter: `{{lint_command}}`
7. Ensure the build succeeds: `{{build_command}}`
8. Commit: `git add -A && git commit -m "feat: {{title}} [{{id}}]"`
```

### Refactor Template

```markdown
# Task: {{title}} [{{id}}]

## Role
You are a senior developer performing a focused refactoring. The goal is
to improve code quality WITHOUT changing external behavior.

## Refactoring Description
{{description}}

## Files in Scope
{{#files}}
- {{.}}
{{/files}}

## Acceptance Criteria
- All existing tests pass without modification
{{#acceptance_criteria}}
- {{.}}
{{/acceptance_criteria}}

## Constraints
- Do NOT change any public API or external behavior
- Do NOT add new features
- Do NOT fix unrelated bugs
{{#constraints}}
- {{.}}
{{/constraints}}

## Workflow
1. Run tests FIRST to establish baseline: `{{test_command}}`
2. Read the files in scope
3. Perform the refactoring incrementally
4. Run tests after each significant change
5. Ensure all tests pass
6. Commit: `git add -A && git commit -m "refactor: {{title}} [{{id}}]"`
```

### Research Template

```markdown
# Task: {{title}} [{{id}}]

## Role
You are a senior developer researching a technical question. Your output
is a written analysis, NOT code changes.

## Research Question
{{description}}

## Files to Reference
{{#files}}
- {{.}}
{{/files}}

## Deliverables
{{#acceptance_criteria}}
- {{.}}
{{/acceptance_criteria}}

## Constraints
- Do NOT modify any source code
- Write your findings to `docs/research/{{id}}.md`
- Include code examples if relevant, but as documentation, not implementations
{{#constraints}}
- {{.}}
{{/constraints}}

## Workflow
1. Read the relevant source code
2. Analyze the question
3. Write your findings to `docs/research/{{id}}.md`
4. Commit: `git add -A && git commit -m "docs: {{title}} [{{id}}]"`
```

### Test Template

```markdown
# Task: {{title}} [{{id}}]

## Role
You are a senior developer writing tests. Write thorough, readable
tests that serve as documentation.

## What to Test
{{description}}

## Files to Test
{{#files}}
- {{.}}
{{/files}}

## Acceptance Criteria
{{#acceptance_criteria}}
- [ ] {{.}}
{{/acceptance_criteria}}

## Constraints
- Do NOT modify source code, only test files
- Follow the existing test patterns in the project
- Test both happy paths and edge cases
{{#constraints}}
- {{.}}
{{/constraints}}

## Workflow
1. Read the source files to understand the code
2. Read existing tests to understand patterns
3. Write new tests
4. Run tests: `{{test_command}}`
5. Ensure 100% of new tests pass
6. Commit: `git add -A && git commit -m "test: {{title}} [{{id}}]"`
```

### Review Template

```markdown
# Task: {{title}} [{{id}}]

## Role
You are a senior code reviewer. Analyze the changes from the parent
task and provide a structured review.

## Context
Parent task: {{parent_task}}
{{description}}

## Diff Summary
{{diff_summary}}

## Review Checklist
{{#review_checklist}}
- [ ] {{.}}
{{/review_checklist}}

## Constraints
- Do NOT modify any code
- Write your review to `reviews/{{parent_task}}.md`
- Use a structured format: Summary, Issues, Suggestions, Verdict
- Verdict must be one of: APPROVE, REQUEST_CHANGES, REJECT

## Workflow
1. Read the changed files
2. Understand the intent of the parent task
3. Evaluate against the review checklist
4. Write structured review to `reviews/{{parent_task}}.md`
5. Commit: `git add -A && git commit -m "review: {{title}} [{{id}}]"`
```

---

## 8. Context Management

### The Context Problem

Claude Code needs enough context to work effectively, but too much context wastes tokens, increases cost, and can cause the model to lose focus.

### Context Layers (Priority Order)

1. **System Prompt** (always present): Ralph's operational instructions via `--append-system-prompt-file`
2. **CLAUDE.md** (auto-loaded): Project conventions, build commands, architecture overview
3. **Task Prompt** (per-task): The interpolated task template
4. **File Content** (on-demand): Claude reads files as needed via `Read` tool

### CLAUDE.md Strategy for Ralph

The project CLAUDE.md should contain the **minimum viable context** that every task needs:

```markdown
# Project: MyApp

## Build & Test
- `npm test` -- run all tests
- `npm run test:unit` -- unit tests only
- `npm run lint` -- ESLint
- `npm run build` -- TypeScript compilation

## Architecture
- Express.js API in `src/`
- Tests in `tests/` mirroring `src/` structure
- Database: PostgreSQL via Prisma ORM
- Auth: JWT tokens, middleware in `src/middleware/auth.ts`

## Conventions
- TypeScript strict mode
- Functional components with hooks (React)
- Error handling: throw typed errors, catch at boundary
- Naming: camelCase for variables, PascalCase for types/classes

## Do NOT
- Modify .env or any config with secrets
- Push to main directly
- Skip tests
```

Keep CLAUDE.md under 150 lines. For deeper context, use `.claude/skills/` with SKILL.md files that load on demand.

### Ralph-Specific System Prompt

A separate file (`.claude/ralph-system.md`) loaded via `--append-system-prompt-file`:

```markdown
# Ralph Agent Instructions

You are Ralph, an autonomous coding agent working on tasks from a queue.

## Rules
1. Only work on the task described in the prompt. Do not explore beyond scope.
2. Always run tests after making changes.
3. Always commit your work with the specified commit message format.
4. If you are unsure about something, document the uncertainty rather than guessing.
5. Do not ask questions -- there is no one to answer. If unclear, make the best decision and document your reasoning.
6. Be surgical. Minimal changes. No drive-by refactoring.

## Git Workflow
- You are on a feature branch. Commit freely.
- Use conventional commit messages: fix:, feat:, refactor:, test:, docs:
- Do NOT push. The orchestrator handles pushing.

## When You're Stuck
- If tests keep failing after 2 attempts, stop and document what you tried
- If you don't understand the codebase well enough, stop and document what's unclear
- Better to stop early than to make incorrect changes
```

### Skill Files for Domain Context

For complex projects, create `.claude/skills/` with domain-specific context that loads on demand:

```
.claude/skills/
  database.md      # Prisma schema, migration patterns
  auth.md          # JWT flow, session management
  api-patterns.md  # REST conventions, error formats
  testing.md       # Test utilities, fixtures, mocking patterns
```

Claude Code automatically loads relevant skills based on the task context.

---

## 9. Reproducibility

### The Honest Truth

LLMs are not deterministic. Two runs of the same task will produce different code. **And that's okay.** The goal is **functional equivalence**, not textual identity.

### What We CAN Reproduce

1. **Intent**: Same prompt = same goal
2. **Verification**: Same tests = same pass/fail
3. **Scope**: Same file restrictions = same blast radius
4. **Quality**: Same linting/type-checking = same minimum bar

### What We CANNOT Reproduce

1. Variable names (sometimes)
2. Code style (minor variations)
3. Comment wording
4. Implementation approach (sometimes chooses a different algorithm)
5. Number of turns/tokens used

### Strategies for Maximizing Consistency

**Pin the model**: Always specify `--model` explicitly. Model updates change behavior.

```bash
claude -p "$PROMPT" --model claude-opus-4-6  # Pin exact model ID
```

**Specify concrete patterns**: Instead of "add error handling", say "add a try/catch that catches `DatabaseError` and returns a 500 response with `{ error: 'Internal server error' }`".

**Use acceptance criteria as tests**: The ultimate reproducibility check. If the tests pass, the task is "reproduced" regardless of implementation differences.

**Seed the approach**: For tasks where approach matters, include the approach in the prompt:

```yaml
description: |
  Implement rate limiting using a sliding window counter stored in Redis.
  Use the `ioredis` package (already installed).
  Pattern: middleware function that checks/increments counter per IP.
```

**Lock the file scope**: Explicitly list which files should change. Claude will drift if you don't.

**Version everything**: Task definitions, templates, system prompts -- all in git. When behavior changes, you can diff the inputs.

### Reproducibility Logging

Log enough to diagnose differences:

```json
{
  "task_id": "task-001",
  "run_id": "run-abc123",
  "timestamp": "2026-03-03T10:00:00Z",
  "model": "claude-opus-4-6",
  "prompt_hash": "sha256:abc...",
  "session_id": "sess-xyz",
  "turns_used": 12,
  "tokens_input": 45000,
  "tokens_output": 8000,
  "cost_usd": 1.23,
  "stop_reason": "end_turn",
  "verification": {
    "tests": "pass",
    "build": "pass",
    "lint": "pass"
  },
  "files_changed": ["src/auth.py", "tests/test_auth.py"],
  "diff_stats": "+28 -3"
}
```

---

## 10. Loop Orchestration

### The Outer Loop

This is the "Ralph runner" -- the script/service that picks tasks, runs Claude, and handles results.

```
┌─────────────────────────────────────────────────────┐
│                   Ralph Runner                       │
│                                                      │
│  1. Pull latest from git                            │
│  2. Find next task (status: pending, priority order) │
│  3. Validate task definition                        │
│  4. Create feature branch (or worktree)             │
│  5. Select prompt template by task type             │
│  6. Interpolate task variables into template        │
│  7. Build CLI arguments (tools, limits, model)      │
│  8. Execute: claude -p "$PROMPT" $ARGS              │
│  9. Parse result (JSON output)                      │
│ 10. Run verification (tests, build, lint)           │
│ 11. Determine outcome (pass/fail/retry)             │
│ 12. Update task status                              │
│ 13. If pass: commit & push branch                   │
│ 14. If needs review: create review task             │
│ 15. If fail + retryable: retry (once)               │
│ 16. If fail + terminal: mark failed, alert          │
│ 17. Go to step 1                                    │
└─────────────────────────────────────────────────────┘
```

### State Machine

```
         ┌─────────┐
         │ pending  │
         └────┬─────┘
              │ (picked up by runner)
              v
       ┌──────────────┐
       │  in_progress  │
       └──────┬───────┘
              │
    ┌─────────┼──────────┐
    v         v          v
┌────────┐ ┌────────┐ ┌──────────┐
│ passed │ │ failed │ │  retry   │
│(verify)│ │        │ │(1x max)  │
└───┬────┘ └───┬────┘ └────┬─────┘
    │          │            │
    v          v            └──> back to in_progress
┌────────┐ ┌──────────┐
│accepted│ │needs_fix │
│(auto/  │ │(new task)│
│review) │ └──────────┘
└────────┘
```

### Orchestration Script Skeleton (Bash, V1)

```bash
#!/usr/bin/env bash
set -euo pipefail

TASKS_DIR="tasks"
TEMPLATES_DIR="templates"
RALPH_SYSTEM=".claude/ralph-system.md"
MAX_TURNS=50
MAX_BUDGET=5.00
MODEL="opus"

main() {
  while true; do
    # Pull latest
    git pull --rebase origin main

    # Find next pending task
    local task_file=$(find_next_task)
    if [ -z "$task_file" ]; then
      echo "No pending tasks. Sleeping 60s..."
      sleep 60
      continue
    fi

    # Process the task
    process_task "$task_file"
  done
}

find_next_task() {
  # Find the highest-priority pending task
  find "$TASKS_DIR" -name "*.yaml" -exec grep -l "status: pending" {} \; \
    | head -1
}

process_task() {
  local task_file="$1"
  local task_id=$(yq '.id' "$task_file")
  local task_type=$(yq '.type' "$task_file")

  echo "Processing task: $task_id ($task_type)"

  # Mark as in_progress
  yq -i '.status = "in_progress"' "$task_file"
  git add "$task_file" && git commit -m "chore: start $task_id"
  git push

  # Create feature branch
  local branch="ralph/$task_id"
  git checkout -b "$branch"

  # Build prompt
  local prompt=$(build_prompt "$task_file" "$task_type")
  local tools=$(get_tools_for_type "$task_type")

  # Execute Claude
  local result
  result=$(echo "$prompt" | timeout 600 claude -p \
    --output-format json \
    --max-turns "$MAX_TURNS" \
    --max-budget-usd "$MAX_BUDGET" \
    --model "$MODEL" \
    --allowedTools $tools \
    --append-system-prompt-file "$RALPH_SYSTEM" \
    2>/dev/null) || true

  # Parse result
  local session_id=$(echo "$result" | jq -r '.session_id // empty')
  local output=$(echo "$result" | jq -r '.result // empty')

  # Verify
  local verification=$(verify_task "$task_type")

  # Handle outcome
  handle_outcome "$task_file" "$task_id" "$verification" "$session_id"

  # Return to main
  git checkout main
}

handle_outcome() {
  local task_file="$1" task_id="$2" verification="$3" session_id="$4"

  case "$verification" in
    "verified")
      yq -i '.status = "completed"' "$task_file"
      git push origin "ralph/$task_id"
      echo "Task $task_id completed and pushed."
      ;;
    "failed")
      yq -i '.status = "failed"' "$task_file"
      echo "Task $task_id failed verification."
      ;;
  esac
}
```

### Orchestration with Agent SDK (V2, Python)

```python
import asyncio
import yaml
import json
from pathlib import Path
from claude_agent_sdk import query, ClaudeAgentOptions

async def process_task(task_path: Path) -> dict:
    task = yaml.safe_load(task_path.read_text())

    prompt = build_prompt(task)
    tools = get_tools_for_type(task["type"])

    session_id = None
    result = None

    async for message in query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            allowed_tools=tools,
            max_turns=50,
            max_budget_usd=5.0,
            model="opus",
            append_system_prompt=RALPH_SYSTEM_PROMPT,
        ),
    ):
        if hasattr(message, "session_id"):
            session_id = message.session_id
        if hasattr(message, "result"):
            result = message.result
        if hasattr(message, "subtype"):
            if message.subtype.startswith("error_"):
                return {"status": "failed", "reason": message.subtype}

    # Post-verification
    verification = await run_verification(task["type"])

    return {
        "status": "completed" if verification.passed else "failed",
        "session_id": session_id,
        "result": result,
        "verification": verification,
    }
```

### Concurrency Considerations

For V1: **Single task at a time.** Sequential processing. Simple, debuggable, no race conditions.

For V2: Use `--worktree` or separate git worktrees for parallel task execution. Each task gets its own isolated copy of the repo.

```bash
# Parallel execution with worktrees
claude -w "task-001" -p "$PROMPT_1" --output-format json &
claude -w "task-002" -p "$PROMPT_2" --output-format json &
wait
```

### Monitoring and Observability

Log every execution as a structured JSON entry:

```bash
# ralph-log.jsonl (append-only)
{"timestamp":"...","task_id":"task-001","status":"completed","turns":12,"cost":1.23,"duration_s":180}
{"timestamp":"...","task_id":"task-002","status":"failed","reason":"tests","turns":28,"cost":3.45,"duration_s":420}
```

The user on their laptop can:
- `git pull` and read the log
- Check task statuses in the `tasks/` directory
- View diffs on feature branches
- Review and approve/reject completed tasks

---

## Summary: Key Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| CLI vs SDK | CLI for V1, SDK for V2 | CLI is shell-scriptable, lower complexity |
| Prompt construction | YAML task + Mustache-style templates | Separates data from template, version-controllable |
| System prompt | `--append-system-prompt-file` | Keep Claude Code defaults + add Ralph rules |
| Exit conditions | `--max-turns` + `--max-budget-usd` + `timeout` | Defense in depth |
| Verification | Always run tests/build post-execution | Never trust the model's "I'm done" |
| Auto-accept | Only for small, tested, low-risk diffs | Default to review for safety |
| Tool permissions | Per-task-type `--allowedTools` profiles | Principle of least privilege |
| Reproducibility | Pin model + structured prompts + test verification | Accept non-identical code, verify functional equivalence |
| Orchestration | Simple bash loop for V1 | KISS; upgrade to Python/SDK when complexity demands it |
| Concurrency | Sequential for V1, worktrees for V2 | Avoid complexity until proven necessary |
