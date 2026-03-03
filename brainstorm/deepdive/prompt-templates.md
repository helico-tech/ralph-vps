# Deep Dive: Prompt Templates & Entry/Exit Criteria

> Architecture B deep-dive by **prompt-templates** | 2026-03-03

---

## Table of Contents

1. [The System Prompt (ralph-system.md)](#1-the-system-prompt)
2. [Template Design](#2-template-design)
3. [Entry Criteria (Task Pickup Gates)](#3-entry-criteria)
4. [Exit Criteria (Task Completion Gates)](#4-exit-criteria)
5. [The Prompt Construction Pipeline](#5-the-prompt-construction-pipeline)
6. [Verification Configuration](#6-verification-configuration)
7. [Tool Profiles per Task Type](#7-tool-profiles-per-task-type)
8. [The Agent Definition (ralph-worker.md)](#8-the-agent-definition)
9. [Context Window Management](#9-context-window-management)
10. [Example: Full Task Lifecycle](#10-example-full-task-lifecycle)

---

## 1. The System Prompt

This file lives at `.ralph/ralph-system.md` and gets appended to Claude's default system prompt via `--append-system-prompt-file`. It does NOT replace the defaults -- it augments them.

**Design principle:** Under 80 lines. Every line competes for attention with the task itself. Redundant rules dilute important ones.

### Actual File: `.ralph/ralph-system.md`

```markdown
# Ralph Agent Rules

You are an autonomous coding agent executing a task from a queue. There is NO human present. Do not ask questions -- no one will answer. Make the best decision you can and document your reasoning.

## Core Rules

1. Only work on the task described in your prompt. Nothing else.
2. Be surgical. Minimal changes. No drive-by refactoring, no "while I'm here" improvements.
3. Do not modify anything under `.ralph/`. That directory is owned by the orchestrator.
4. Do not run `git push`, `git push --force`, or `git checkout main`. The orchestrator handles all remote git operations.
5. Do not run `rm -rf`, do not delete files unrelated to the task, do not install new packages unless the task explicitly requires it.
6. Do not modify `.env`, `.env.*`, or any file containing secrets or credentials.

## Verification

7. Always run the project's test command after making changes.
8. If tests fail, fix the issue and re-run. Do not commit failing code.
9. If you add new behavior, add tests for it.
10. If the build or lint check is specified, run it before committing.

## Commits

11. Commit your work using conventional commits with the task ID:
    - Bug fixes: `fix(<scope>): <description> [<task-id>]`
    - Features: `feat(<scope>): <description> [<task-id>]`
    - Refactors: `refactor(<scope>): <description> [<task-id>]`
    - Tests: `test(<scope>): <description> [<task-id>]`
    - Docs/research: `docs(<scope>): <description> [<task-id>]`
12. Stage files explicitly. Do NOT use `git add -A` or `git add .`. Add only the files you changed.
13. You may make multiple commits for incremental progress. Each commit should leave the code in a valid state.

## When You Are Stuck

14. If tests keep failing after 3 attempts at fixing, STOP. Write a summary of what you tried and what failed to a file named `RALPH-STUCK.md` in the repo root, then commit it.
15. If you don't understand the codebase well enough to proceed safely, STOP. Document what's unclear in `RALPH-STUCK.md`.
16. If the task description is ambiguous and you cannot determine the correct approach, pick the most conservative interpretation and document your reasoning in the commit message.
17. Stopping early with a clear explanation is ALWAYS better than making incorrect changes.

## Scope Control

18. If you discover a pre-existing bug unrelated to the task, do NOT fix it. Note it in your commit message or in `RALPH-STUCK.md`.
19. If the task requires changes to files not listed in the file scope (when provided), proceed only if absolutely necessary and document why.
20. Prefer small, focused changes over comprehensive refactors.
```

**Why these rules and not others:**

- Rules 1-6: Prevent the agent from going rogue. These are the "don't destroy things" guardrails.
- Rules 7-10: Enforce verification. The agent's self-report of "done" is worthless without test evidence.
- Rules 11-13: Enable the orchestrator to parse commit history and understand what happened. Explicit staging prevents `.ralph/` contamination.
- Rules 14-17: The "stuck" protocol. Without this, the agent burns its entire budget retrying the same failed approach. `RALPH-STUCK.md` becomes the agent's failure report.
- Rules 18-20: Scope control. Without these, a bugfix task becomes a refactoring expedition.

**What is NOT in this file:** Project-specific commands (test, build, lint). Those come from the task prompt via template interpolation, sourced from `.ralph/config.json`. The system prompt is project-agnostic.

---

## 2. Template Design

### Philosophy

Start with one default template that handles any task type reasonably well. Then specialize. A mediocre specialized template is worse than a good general one -- you're maintaining N templates where a bug in one goes unnoticed because it only triggers for that type.

Templates use simple `{{variable}}` interpolation. No conditionals, no loops, no Mustache partials. If the template needs logic, the logic belongs in the prompt builder, not the template.

### Variables Available to Templates

| Variable | Source | Required | Description |
|----------|--------|----------|-------------|
| `{{id}}` | frontmatter | Yes | Task identifier |
| `{{title}}` | frontmatter | Yes | Human-readable title |
| `{{type}}` | frontmatter | Yes | Task type (bugfix, feature, etc.) |
| `{{description}}` | Markdown body | Yes | Full task description (everything below frontmatter) |
| `{{acceptance_criteria}}` | frontmatter | Yes | Rendered as checklist items |
| `{{files}}` | frontmatter | No | Rendered as bullet list of file paths |
| `{{constraints}}` | frontmatter | No | Rendered as bullet list |
| `{{test_command}}` | config.json | Yes | Project's test command |
| `{{build_command}}` | config.json | No | Project's build command |
| `{{lint_command}}` | config.json | No | Project's lint command |

Array variables (`acceptance_criteria`, `files`, `constraints`) are pre-rendered by the prompt builder before interpolation. The template receives them as formatted strings.

### Default Template (`.ralph/templates/default.md`)

This template works for ANY task type. It is the fallback when no specialized template exists.

```markdown
# Task: {{title}} [{{id}}]

## Description

{{description}}

## Files in Scope

{{files}}

> If no files are listed above, determine the relevant files by reading the project structure and understanding the task requirements.

## Acceptance Criteria

{{acceptance_criteria}}

## Constraints

{{constraints}}

## Workflow

1. Read the files in scope (or explore the project structure if none specified) to understand the current state of the code.
2. Plan your approach before making changes. Think through edge cases.
3. Implement the changes incrementally. Commit after each logical step.
4. Run the test suite: `{{test_command}}`
5. If tests fail, diagnose the failure, fix it, and re-run.
6. If a build command is configured, verify the build: `{{build_command}}`
7. If a lint command is configured, verify lint passes: `{{lint_command}}`
8. Once all checks pass, make a final commit with message format:
   `{{type}}(scope): {{title}} [{{id}}]`
```

### Bugfix Template (`.ralph/templates/bugfix.md`)

```markdown
# Bugfix: {{title}} [{{id}}]

## Role

You are fixing a bug. Be surgical -- change only what is necessary to resolve the issue. Do not refactor surrounding code. Do not add features.

## Bug Description

{{description}}

## Files to Investigate

{{files}}

> Start with these files. If the root cause is elsewhere, follow it, but document why you left the listed scope.

## Acceptance Criteria

{{acceptance_criteria}}

## Constraints

- Only modify files listed above unless the root cause requires otherwise.
- Do not refactor code unrelated to the bug.
- Do not change public interfaces or function signatures unless required by the fix.
{{constraints}}

## Workflow

1. Read the files listed above to understand the current behavior.
2. Reproduce the bug mentally -- understand why it happens.
3. Identify the root cause. Document it in your commit message.
4. Implement the minimal fix.
5. Add a test that would have caught this bug (a regression test).
6. Run the test suite: `{{test_command}}`
7. If tests fail, fix and re-run. Do not commit failing tests.
8. Verify the build: `{{build_command}}`
9. Commit with: `fix(scope): {{title}} [{{id}}]`
```

### Feature Template (`.ralph/templates/feature.md`)

```markdown
# Feature: {{title}} [{{id}}]

## Role

You are implementing a new feature. Follow existing patterns and conventions in the codebase. When in doubt, match what's already there rather than introducing new patterns.

## Feature Description

{{description}}

## Files to Modify or Create

{{files}}

> If no files are listed, determine the right locations by reading existing code structure and following established patterns.

## Acceptance Criteria

{{acceptance_criteria}}

## Constraints

- Follow existing code patterns and naming conventions.
- Include tests for all new behavior.
- Handle errors explicitly -- do not silently swallow exceptions.
{{constraints}}

## Workflow

1. Read existing code to understand the project's patterns, conventions, and architecture.
2. Plan the implementation. Identify which files to create or modify.
3. Implement incrementally. Start with the core logic, then edges cases, then tests.
4. Write tests alongside the implementation -- not as an afterthought.
5. Run the test suite: `{{test_command}}`
6. Run lint: `{{lint_command}}`
7. Verify the build: `{{build_command}}`
8. Commit with: `feat(scope): {{title}} [{{id}}]`
```

### Refactor Template (`.ralph/templates/refactor.md`)

```markdown
# Refactor: {{title}} [{{id}}]

## Role

You are performing a focused refactoring. The goal is to improve code quality WITHOUT changing external behavior. If any existing test breaks, your refactoring has a bug.

## Refactoring Description

{{description}}

## Files in Scope

{{files}}

## Acceptance Criteria

- All existing tests pass WITHOUT modification (unless the test itself is what's being refactored).
{{acceptance_criteria}}

## Constraints

- Do NOT change any public API, external behavior, or observable side effects.
- Do NOT add new features.
- Do NOT fix unrelated bugs (note them in your commit message if you find any).
{{constraints}}

## Workflow

1. Run the test suite FIRST to establish a passing baseline: `{{test_command}}`
2. If tests are already failing, STOP. Document this and do not proceed.
3. Read the files in scope.
4. Perform the refactoring incrementally. After each significant change, run tests.
5. Ensure ALL existing tests still pass.
6. Verify the build: `{{build_command}}`
7. Commit with: `refactor(scope): {{title}} [{{id}}]`
```

### Research Template (`.ralph/templates/research.md`)

```markdown
# Research: {{title}} [{{id}}]

## Role

You are researching a technical question. Your deliverable is a written analysis, NOT code changes. Do not modify source code.

## Research Question

{{description}}

## Files to Reference

{{files}}

## Deliverables

{{acceptance_criteria}}

## Constraints

- Do NOT modify any source code files.
- Write your findings to `.ralph/research/{{id}}.md`.
- Structure your findings with: Summary, Analysis, Recommendations, Open Questions.
- Include code examples as illustration, not as implementations.
{{constraints}}

## Workflow

1. Read the referenced files and any related source code.
2. Analyze the question thoroughly.
3. Write your findings to `.ralph/research/{{id}}.md`.
4. Commit with: `docs(research): {{title}} [{{id}}]`
```

### When to Add a New Template

Do NOT add a template just because you can think of a task type. Add one when:

1. You have 3+ tasks of that type that would clearly benefit from different workflow instructions.
2. The default template produces consistently suboptimal results for that type.
3. The behavioral difference is in the WORKFLOW or CONSTRAINTS, not just the title.

If the only difference is the commit prefix, that's a variable, not a template.

---

## 3. Entry Criteria (Task Pickup Gates)

Entry criteria determine whether a task is eligible to be picked up. They are checked BEFORE the orchestrator claims a task.

### Required Field Validation

A task MUST have these frontmatter fields or it's rejected:

| Field | Validation | On Failure |
|-------|-----------|------------|
| `id` | Non-empty string | Skip task, log warning |
| `type` | One of: `bugfix`, `feature`, `refactor`, `research`, `test`, `chore` | Skip task, log warning |
| `title` | Non-empty string | Skip task, log warning |
| `acceptance_criteria` | Non-empty array with at least one entry | Skip task, log warning |

Optional fields (`files`, `constraints`, `depends_on`, `tags`, `priority`, `max_retries`) have defaults if missing.

### Dependency Gate

If `depends_on` is present and non-empty, every referenced task ID must exist in `done/`. If any dependency is in `pending/`, `active/`, `review/`, or `failed/`, the task is not eligible.

```typescript
function dependenciesMet(task: Task, doneTasks: Set<string>): boolean {
  if (!task.depends_on || task.depends_on.length === 0) return true;
  return task.depends_on.every(dep => doneTasks.has(dep));
}
```

### Priority Ordering

Among eligible tasks (valid + dependencies met), pick by:

1. `priority` ASC (lower number = higher priority, default: 100)
2. `created_at` ASC (older tasks first)
3. `id` ASC (alphabetical tiebreaker)

### Configurable Tag Filters

In `.ralph/config.json`, the user can restrict which tasks this node picks up:

```json
{
  "entry_criteria": {
    "require_tags": ["backend"],
    "exclude_tags": ["manual"],
    "require_type": ["bugfix", "feature", "refactor"],
    "max_priority": 500
  }
}
```

- `require_tags`: Task must have ALL of these tags. Empty array = no filter.
- `exclude_tags`: Task must have NONE of these tags.
- `require_type`: Task type must be in this list. Empty array = all types.
- `max_priority`: Skip tasks with priority above this threshold (low priority = high number).

### Custom Entry Criteria

For advanced use, `.ralph/config.json` supports a `entry_criteria.custom_check` field pointing to a script:

```json
{
  "entry_criteria": {
    "custom_check": ".ralph/scripts/can-pickup.sh"
  }
}
```

The script receives the task file path as `$1` and must exit 0 (eligible) or non-zero (skip). This allows project-specific logic like "only pick up tasks if the staging server is healthy" or "skip tasks that reference files currently in a PR."

### Implementation

```typescript
// src/orchestrator/task-queue.ts

interface EntryConfig {
  require_tags?: string[];
  exclude_tags?: string[];
  require_type?: string[];
  max_priority?: number;
  custom_check?: string;
}

interface Task {
  id: string;
  type: string;
  title: string;
  priority: number;
  acceptance_criteria: string[];
  depends_on?: string[];
  tags?: string[];
  created_at?: string;
}

function isEligible(
  task: Task,
  doneTasks: Set<string>,
  config: EntryConfig
): boolean {
  // 1. Required fields present
  if (!task.id || !task.type || !task.title) return false;
  if (!task.acceptance_criteria || task.acceptance_criteria.length === 0) return false;

  // 2. Valid type
  const validTypes = ['bugfix', 'feature', 'refactor', 'research', 'test', 'chore'];
  if (!validTypes.includes(task.type)) return false;

  // 3. Dependencies met
  if (task.depends_on?.some(dep => !doneTasks.has(dep))) return false;

  // 4. Tag filters
  if (config.require_tags?.length) {
    if (!config.require_tags.every(t => task.tags?.includes(t))) return false;
  }
  if (config.exclude_tags?.length) {
    if (config.exclude_tags.some(t => task.tags?.includes(t))) return false;
  }

  // 5. Type filter
  if (config.require_type?.length) {
    if (!config.require_type.includes(task.type)) return false;
  }

  // 6. Priority filter
  if (config.max_priority !== undefined && task.priority > config.max_priority) return false;

  return true;
}

function pickNext(
  tasks: Task[],
  doneTasks: Set<string>,
  config: EntryConfig
): Task | null {
  const eligible = tasks.filter(t => isEligible(t, doneTasks, config));

  eligible.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.created_at && b.created_at) return a.created_at.localeCompare(b.created_at);
    return a.id.localeCompare(b.id);
  });

  return eligible[0] ?? null;
}
```

---

## 4. Exit Criteria (Task Completion Gates)

Exit criteria determine what happens after Claude finishes executing. They're evaluated in layers, from coarsest to finest.

### Layer 1: Claude Process Exit

Did the `claude -p` process exit cleanly?

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Clean exit | Proceed to Layer 2 |
| Non-zero | Process error (crash, signal, timeout) | Mark `failed`, reason: `process_error` |

The orchestrator wraps the Claude invocation in `timeout`:

```bash
timeout $TIMEOUT_SECONDS claude -p "$PROMPT" --output-format json ... 2>/dev/null
```

If `timeout` kills the process, exit code is 124. Map this to `failed:timeout`.

### Layer 2: Stop Reason (from JSON output)

Parse the `--output-format json` output for the stop reason:

| `stop_reason` | Meaning | Action |
|---------------|---------|--------|
| `end_turn` | Claude finished naturally | Proceed to Layer 3 |
| `max_tokens` | Hit output token limit mid-response | Mark `failed`, reason: `max_tokens` |
| `refusal` | Claude refused the task | Mark `failed`, reason: `refusal` |
| `error_max_turns` | Hit `--max-turns` limit | Retry once with +25% turns, then `failed:max_turns` |
| `error_max_budget` | Hit `--max-budget-usd` limit | Mark `failed`, reason: `budget_exceeded` |

```typescript
// src/orchestrator/executor.ts

interface ClaudeResult {
  result: string;
  session_id: string;
  stop_reason: string;
  cost_usd: number;
  turns_used: number;
}

function evaluateStopReason(result: ClaudeResult): 'continue' | 'retry' | 'fail' {
  switch (result.stop_reason) {
    case 'end_turn':
      return 'continue'; // proceed to verification
    case 'error_max_turns':
      return 'retry';    // might succeed with more turns
    default:
      return 'fail';     // terminal failure
  }
}
```

### Layer 3: Verification (Tests, Build, Lint)

The orchestrator runs verification commands OUTSIDE of Claude's session. This is critical -- the agent might claim tests pass when they don't, or skip running them entirely.

Verification is configured in `.ralph/config.json`:

```json
{
  "verify": {
    "test": "bun test",
    "build": "bun run build",
    "lint": "bun run lint"
  }
}
```

Each command is run sequentially. Results:

| Check | Result | Action |
|-------|--------|--------|
| Test | Pass | Continue |
| Test | Fail | Retry if eligible, else `failed:tests` |
| Build | Pass | Continue |
| Build | Fail | Retry if eligible, else `failed:build` |
| Lint | Pass | Continue |
| Lint | Fail (warning) | Continue with warning in metadata |

```typescript
// src/orchestrator/verifier.ts

interface VerifyConfig {
  test?: string;
  build?: string;
  lint?: string;
}

interface VerifyResult {
  passed: boolean;
  test?: { passed: boolean; output: string };
  build?: { passed: boolean; output: string };
  lint?: { passed: boolean; output: string };
}

async function verify(config: VerifyConfig, cwd: string): Promise<VerifyResult> {
  const results: VerifyResult = { passed: true };

  if (config.test) {
    const test = await runCommand(config.test, cwd);
    results.test = { passed: test.exitCode === 0, output: test.stderr + test.stdout };
    if (!test.exitCode === 0) results.passed = false;
  }

  if (config.build) {
    const build = await runCommand(config.build, cwd);
    results.build = { passed: build.exitCode === 0, output: build.stderr + build.stdout };
    if (build.exitCode !== 0) results.passed = false;
  }

  if (config.lint) {
    const lint = await runCommand(config.lint, cwd);
    results.lint = { passed: lint.exitCode === 0, output: lint.stderr + lint.stdout };
    // Lint failures are warnings, not blockers
  }

  return results;
}
```

### Layer 4: Custom Checks

For project-specific validation beyond test/build/lint:

```json
{
  "verify": {
    "test": "bun test",
    "build": "bun run build",
    "custom": [
      {
        "name": "type-check",
        "command": "bunx tsc --noEmit",
        "required": true
      },
      {
        "name": "no-console-logs",
        "command": "! grep -rn 'console.log' src/ --include='*.ts'",
        "required": false
      }
    ]
  }
}
```

Each custom check has a `required` flag. Required checks block completion; optional checks add warnings to task metadata.

### State Transition Matrix

Based on exit criteria evaluation:

| All Layers Pass | Retries Remaining | Transition |
|-----------------|-------------------|------------|
| Yes | N/A | `active/` -> `review/` |
| No (retryable) | Yes | `active/` -> `pending/` (increment `retry_count`) |
| No (retryable) | No | `active/` -> `failed/` |
| No (terminal) | N/A | `active/` -> `failed/` |

Retryable failures: `tests`, `build`, `error_max_turns`.
Terminal failures: `budget_exceeded`, `refusal`, `timeout`, `process_error`, `max_tokens`.

### Configuration in `.ralph/config.json`

```json
{
  "exit_criteria": {
    "require_tests": true,
    "require_build": false,
    "require_lint": false,
    "max_retries_default": 1,
    "per_type_overrides": {
      "refactor": {
        "require_tests": true,
        "require_build": true
      },
      "research": {
        "require_tests": false,
        "require_build": false
      }
    }
  }
}
```

If `require_tests` is `true` but no `verify.test` command is configured, the task fails with `misconfigured:no_test_command`. The orchestrator refuses to mark something as verified if it can't actually verify it.

Exception: `research` tasks. They produce documentation, not code. If `require_tests` is false for the research type, skip verification entirely -- just check that the agent produced output files.

---

## 5. The Prompt Construction Pipeline

The prompt builder is a **pure function**. It takes a parsed task and configuration, and returns a prompt string plus CLI arguments. No side effects, no file I/O, no git operations. This makes it trivially testable.

### Input/Output Contract

```typescript
// src/orchestrator/prompt-builder.ts

interface TaskInput {
  id: string;
  type: string;
  title: string;
  description: string;          // Markdown body (below frontmatter)
  acceptance_criteria: string[];
  files?: string[];
  constraints?: string[];
}

interface ProjectConfig {
  verify: {
    test?: string;
    build?: string;
    lint?: string;
  };
  defaults: {
    model: string;
    max_turns: number;
    max_budget_usd: number;
    timeout_seconds: number;
  };
  tool_profiles: Record<string, string[]>;
  templates_dir: string;
}

interface PromptOutput {
  prompt: string;
  tools: string[];
  maxTurns: number;
  maxBudget: number;
  timeoutSeconds: number;
  model: string;
}
```

### Implementation

```typescript
// src/orchestrator/prompt-builder.ts

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_TOOL_PROFILE = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(bun test *)', 'Bash(bun run *)', 'Bash(bunx *)',
  'Bash(npm test *)', 'Bash(npm run *)', 'Bash(npx *)',
  'Bash(git status *)', 'Bash(git diff *)', 'Bash(git log *)',
  'Bash(git add *)', 'Bash(git commit *)',
];

export function buildPrompt(task: TaskInput, config: ProjectConfig): PromptOutput {
  // 1. Validate required fields
  validate(task);

  // 2. Select template
  const template = selectTemplate(task.type, config.templates_dir);

  // 3. Render array fields
  const renderedFiles = renderFileList(task.files);
  const renderedCriteria = renderChecklist(task.acceptance_criteria);
  const renderedConstraints = renderBulletList(task.constraints);

  // 4. Interpolate
  const prompt = interpolate(template, {
    id: task.id,
    title: task.title,
    type: commitPrefix(task.type),
    description: task.description,
    files: renderedFiles,
    acceptance_criteria: renderedCriteria,
    constraints: renderedConstraints,
    test_command: config.verify.test ?? '# no test command configured',
    build_command: config.verify.build ?? '# no build command configured',
    lint_command: config.verify.lint ?? '# no lint command configured',
  });

  // 5. Select tool profile
  const tools = config.tool_profiles[task.type] ?? DEFAULT_TOOL_PROFILE;

  // 6. Select execution limits
  const maxTurns = config.defaults.max_turns;
  const maxBudget = config.defaults.max_budget_usd;
  const timeoutSeconds = config.defaults.timeout_seconds;
  const model = config.defaults.model;

  return { prompt, tools, maxTurns, maxBudget, timeoutSeconds, model };
}

function validate(task: TaskInput): void {
  if (!task.id) throw new Error('Task missing required field: id');
  if (!task.type) throw new Error('Task missing required field: type');
  if (!task.title) throw new Error('Task missing required field: title');
  if (!task.acceptance_criteria?.length) {
    throw new Error('Task missing required field: acceptance_criteria');
  }
}

function selectTemplate(type: string, templatesDir: string): string {
  const specific = join(templatesDir, `${type}.md`);
  const fallback = join(templatesDir, 'default.md');

  if (existsSync(specific)) return readFileSync(specific, 'utf-8');
  if (existsSync(fallback)) return readFileSync(fallback, 'utf-8');

  throw new Error(`No template found for type "${type}" and no default.md exists`);
}

function interpolate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

function renderFileList(files?: string[]): string {
  if (!files?.length) return '_No files specified -- determine scope from the task description._';
  return files.map(f => `- \`${f}\``).join('\n');
}

function renderChecklist(items: string[]): string {
  return items.map(item => `- [ ] ${item}`).join('\n');
}

function renderBulletList(items?: string[]): string {
  if (!items?.length) return '_No additional constraints._';
  return items.map(item => `- ${item}`).join('\n');
}

function commitPrefix(type: string): string {
  const prefixes: Record<string, string> = {
    bugfix: 'fix',
    feature: 'feat',
    refactor: 'refactor',
    research: 'docs',
    test: 'test',
    chore: 'chore',
  };
  return prefixes[type] ?? type;
}
```

### How the Template Gets the Right Test Command

The prompt builder reads `verify.test` from `.ralph/config.json` and injects it into the template's `{{test_command}}` slot. The user configures this once per project:

```json
{
  "verify": {
    "test": "bun test",
    "build": "bun run build",
    "lint": "bunx biome check ."
  }
}
```

If a project has multiple test commands (e.g., unit vs. integration), the config holds the primary command. The template can reference it, and the system prompt tells the agent to run the full suite. Per-task test overrides are NOT supported in V1 -- the task's `constraints` field can include "Run `bun test src/auth` specifically" if the task creator wants to narrow it.

### Testing the Prompt Builder

The prompt builder is a pure function. Test it with snapshots:

```typescript
// src/tests/unit/prompt-builder.test.ts

import { describe, it, expect } from 'bun:test';
import { buildPrompt } from '../../orchestrator/prompt-builder';

describe('buildPrompt', () => {
  const baseTask = {
    id: 'task-001',
    type: 'bugfix',
    title: 'Fix null check in auth',
    description: 'The authenticate() function crashes when user.email is null.',
    acceptance_criteria: ['authenticate() handles null email', 'All tests pass'],
    files: ['src/auth.ts'],
  };

  const baseConfig = {
    verify: { test: 'bun test', build: 'bun run build', lint: 'bun run lint' },
    defaults: { model: 'opus', max_turns: 50, max_budget_usd: 5, timeout_seconds: 600 },
    tool_profiles: {},
    templates_dir: '.ralph/templates',
  };

  it('selects bugfix template and interpolates variables', () => {
    const result = buildPrompt(baseTask, baseConfig);
    expect(result.prompt).toContain('Fix null check in auth');
    expect(result.prompt).toContain('task-001');
    expect(result.prompt).toContain('bun test');
    expect(result.prompt).toContain('- [ ] authenticate() handles null email');
  });

  it('throws on missing acceptance_criteria', () => {
    const badTask = { ...baseTask, acceptance_criteria: [] };
    expect(() => buildPrompt(badTask, baseConfig)).toThrow('acceptance_criteria');
  });

  it('falls back to default template for unknown type', () => {
    const task = { ...baseTask, type: 'unknown' };
    // Should use default.md, not throw
    const result = buildPrompt(task, baseConfig);
    expect(result.prompt).toContain('Fix null check in auth');
  });

  it('renders "no files specified" when files are absent', () => {
    const task = { ...baseTask, files: undefined };
    const result = buildPrompt(task, baseConfig);
    expect(result.prompt).toContain('No files specified');
  });
});
```

---

## 6. Verification Configuration

### The User's Configuration File: `.ralph/config.json`

```json
{
  "verify": {
    "test": "bun test",
    "build": "bun run build",
    "lint": "bunx biome check .",
    "custom": []
  },
  "exit_criteria": {
    "require_tests": true,
    "require_build": false,
    "require_lint": false,
    "max_retries_default": 1,
    "per_type_overrides": {
      "refactor": {
        "require_build": true
      },
      "research": {
        "require_tests": false
      }
    }
  }
}
```

### What If a Project Has No Tests?

Two options:

1. **Set `require_tests: false`**: Tasks go to `review/` based on Claude's exit status alone. The orchestrator logs a warning: `"No test verification -- task completion is unverified."` The user accepts the risk.

2. **Set `verify.test` to a meaningful command anyway**: Even `bun run build` or `bunx tsc --noEmit` is better than nothing. Type-checking catches a class of errors that would otherwise slip through.

There is NO option to set `require_tests: true` without providing `verify.test`. That's a configuration error and the orchestrator refuses to start.

### Per-Type Verification Matrix

| Type | Tests | Build | Lint | Custom | Notes |
|------|-------|-------|------|--------|-------|
| bugfix | Required | Optional | Optional | Optional | Must not break existing tests |
| feature | Required | Optional | Optional | Optional | New tests expected |
| refactor | Required | Required | Optional | Optional | Build required -- refactors can break compilation |
| research | Skip | Skip | Skip | Skip | Output is documentation, not code |
| test | Required | Optional | Optional | Optional | The tests themselves are the deliverable |
| chore | Optional | Optional | Optional | Optional | Config changes, docs updates, etc. |

These are defaults. The user overrides them in `exit_criteria.per_type_overrides`.

### Verification Timeout

Each verification command gets its own timeout (default: 120 seconds). If a test suite hangs, the orchestrator kills it and treats it as a test failure.

```json
{
  "verify": {
    "test": "bun test",
    "test_timeout_seconds": 120,
    "build_timeout_seconds": 60,
    "lint_timeout_seconds": 30
  }
}
```

---

## 7. Tool Profiles per Task Type

### Why Per-Type Tool Restrictions Matter

`--allowedTools` is the scalpel. `--dangerously-skip-permissions` is a sledgehammer. We use the scalpel.

A research task has no business running `Edit` or `Write` on source files. A bugfix task has no business running `WebSearch`. Restricting tools prevents the agent from straying outside its lane, reduces the surface area for mistakes, and makes the agent's behavior more predictable.

### Default Tool Profiles

Defined in `.ralph/config.json`:

```json
{
  "tool_profiles": {
    "readonly": [
      "Read", "Glob", "Grep",
      "Bash(cat *)", "Bash(ls *)", "Bash(find *)", "Bash(wc *)",
      "Bash(head *)", "Bash(tail *)"
    ],
    "standard": [
      "Read", "Edit", "Write", "Glob", "Grep",
      "Bash(bun test *)", "Bash(bun run *)", "Bash(bunx *)",
      "Bash(npm test *)", "Bash(npm run *)", "Bash(npx *)",
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)",
      "Bash(git add *)", "Bash(git commit *)",
      "Bash(cat *)", "Bash(ls *)", "Bash(find *)", "Bash(wc *)",
      "Bash(head *)", "Bash(tail *)", "Bash(mkdir *)"
    ]
  },
  "type_to_profile": {
    "bugfix": "standard",
    "feature": "standard",
    "refactor": "standard",
    "test": "standard",
    "chore": "standard",
    "research": "readonly"
  }
}
```

### Profile Details

**`readonly`** -- For research tasks:

- Can read any file, search the codebase, run read-only shell commands.
- CANNOT edit files, write files, or run tests.
- CAN write to `.ralph/research/` via a specifically allowed Bash command (the research template handles this by instructing the agent to write to a specific path, and the `Bash(cat *)` command permits it via redirection if needed -- or we add `Write` and scope it in the system prompt).

*Practical note:* Claude Code's `Write` tool doesn't support path restrictions. So for research, we include `Write` but the template + system prompt instruct "only write to `.ralph/research/`". The tool profile is a speed bump, not a wall. If the agent ignores the instruction, the orchestrator's post-execution diff check catches unauthorized file modifications.

**`standard`** -- For all code-changing tasks:

- Full read/write/edit access.
- Can run tests, build, lint via approved bash patterns.
- Can use git for status/diff/log/add/commit (but NOT push).
- CANNOT run arbitrary bash commands outside the approved patterns.

### Custom Tool Profiles

If a project needs specific tools (e.g., Docker commands, database migrations):

```json
{
  "tool_profiles": {
    "with_docker": [
      "...standard tools...",
      "Bash(docker compose *)",
      "Bash(docker exec *)"
    ]
  },
  "type_to_profile": {
    "feature": "with_docker"
  }
}
```

### How `--allowedTools` Is Constructed

The prompt builder reads the task type, maps it to a profile name, looks up the profile's tool list, and returns it as part of `PromptOutput.tools`. The orchestrator joins them with spaces for the CLI:

```typescript
// In the orchestrator's executor
const toolsArg = output.tools.map(t => `"${t}"`).join(' ');
const cmd = `claude -p "${promptFile}" --allowedTools ${toolsArg} ...`;
```

---

## 8. The Agent Definition (ralph-worker.md)

### Two Approaches to Agent Configuration

**Option A: `--append-system-prompt-file` only**
- The orchestrator constructs the full prompt and passes it via `-p`.
- Behavioral rules come from `--append-system-prompt-file .ralph/ralph-system.md`.
- Tool restrictions come from `--allowedTools`.
- Model selection comes from `--model`.

**Option B: `--agent ralph-worker` with agent definition**
- An agent definition file bundles model, tools, and system prompt.
- The orchestrator still constructs the task prompt and passes it via `-p`.

### When to Use Which

For V1: **Use Option A.** The orchestrator already controls model, tools, and limits via CLI flags. An agent definition adds another layer of configuration that can conflict with CLI flags. Keep the source of truth in one place: the orchestrator's `buildPrompt` output.

For V2 (if we want to use `--agent`): The agent definition handles the STATIC configuration (model, permission mode), while `--append-system-prompt-file` handles BEHAVIORAL rules. The task prompt (via `-p`) remains dynamic.

### Actual File: `.claude/agents/ralph-worker.md` (V2)

```markdown
---
name: ralph-worker
model: claude-opus-4-6
permissionMode: bypassPermissions
---

You are Ralph, an autonomous coding agent. You execute tasks from a queue without human supervision.

Your behavioral rules are provided via the system prompt file. Your task is provided via the -p flag. Follow both precisely.

Key constraints:
- No interactive input is available. Never ask questions.
- The orchestrator handles all git push operations. You only commit locally.
- Your work will be verified by automated tests after you finish.
```

### Why Not Use Both in V1?

If the agent definition says `model: opus` and the CLI says `--model sonnet`, which wins? The CLI flag. But now you have two places to check when debugging "why did this run on the wrong model?" One source of truth is always better than two.

In V1, the orchestrator IS the source of truth. The agent definition file adds nothing that the orchestrator doesn't already control via flags.

### The `permissionMode: bypassPermissions` Question

Inside Docker with network restrictions, `bypassPermissions` is acceptable. The container IS the sandbox. But `--allowedTools` is still preferred over `bypassPermissions` for a different reason: it constrains the agent's BEHAVIOR, not just its permissions. An agent with `bypassPermissions` can run `rm -rf /` -- the permission system won't stop it. An agent with `--allowedTools "Bash(bun test *)"` can only run commands starting with `bun test`.

**Recommendation:** Use `--allowedTools` for behavioral control. Use `bypassPermissions` only inside Docker as a fallback for tools not covered by the allowlist.

---

## 9. Context Window Management

### The Problem

Claude Code has a finite context window. On long-running tasks, the context fills with file contents, tool outputs, and conversation history. Claude Code does automatic context compaction (summarizing older messages), but critical information can be lost -- including the original task description and acceptance criteria.

### How `--max-turns` Relates to Context Exhaustion

Each turn is roughly one tool call + response. A typical task:

| Phase | Turns | Context Impact |
|-------|-------|----------------|
| Read task-related files | 3-8 | Files loaded into context |
| Plan approach | 1 | Minimal |
| Implement changes | 5-15 | Edits generate diffs in context |
| Run tests | 1-3 | Test output can be large |
| Fix failing tests | 3-10 | More diffs, more test output |
| Final verification | 1-2 | More test output |
| Commit | 1-2 | Minimal |

Total: 15-40 turns for a typical task. At 50 turns, you have a safety margin. At 100 turns, the agent is almost certainly thrashing.

### Task Sizing Guidelines

Include these in project documentation (not in the system prompt -- that's wasted attention):

| Guideline | Threshold |
|-----------|-----------|
| Max files to modify | 5-8 files |
| Max lines of change | ~200 lines |
| Max turns expected | 30-40 |
| Max budget expected | $3-5 |
| Max time expected | 10-15 minutes |

If a task exceeds these, decompose it. Two small tasks that each succeed are worth more than one large task that fails at turn 45.

### Practical `--max-turns` Settings

| Task Type | Recommended `--max-turns` | Reasoning |
|-----------|---------------------------|-----------|
| bugfix | 40 | Usually surgical -- fewer files, fewer iterations |
| feature | 60 | More exploration and implementation |
| refactor | 50 | Read-heavy but implementation is focused |
| research | 30 | Read-only, should finish quickly |
| test | 40 | Write tests, run them, fix, repeat |
| chore | 30 | Small config/doc changes |

These can be per-type overrides in config:

```json
{
  "defaults": {
    "max_turns": 50,
    "max_budget_usd": 5.00,
    "timeout_seconds": 900
  },
  "per_type_overrides": {
    "feature": { "max_turns": 60, "max_budget_usd": 8.00 },
    "research": { "max_turns": 30, "max_budget_usd": 2.00 }
  }
}
```

### Mitigations for Context Loss

1. **Keep the task prompt front-loaded**: The most important information (acceptance criteria, constraints) is at the TOP of the prompt. Claude's attention is best at the beginning.
2. **The system prompt re-anchors behavior**: Even if the task context is compacted, the system prompt (appended separately) persists. The "when stuck, stop" rule survives compaction.
3. **Acceptance criteria as a checklist**: The `- [ ]` format encourages Claude to track progress. It naturally returns to the checklist to verify completion.
4. **Small tasks beat big tasks**: The user's best defense against context exhaustion is writing smaller tasks.

---

## 10. Example: Full Task Lifecycle

### Step 1: User Creates a Task

The user (on their laptop) creates a task file:

**File: `.ralph/tasks/pending/fix-auth-null.md`**

```markdown
---
id: fix-auth-null
type: bugfix
title: Fix null email crash in authenticate()
priority: 50
acceptance_criteria:
  - "authenticate() returns AuthError when user.email is null"
  - "authenticate() returns AuthError when user.email is empty string"
  - "All existing auth tests still pass"
  - "New test covers null and empty email cases"
files:
  - src/auth.ts
  - src/auth.test.ts
constraints:
  - "Do not modify the User type definition"
  - "Do not change the function signature of authenticate()"
depends_on: []
max_retries: 1
tags:
  - backend
  - auth
---

## Description

The `authenticate()` function in `src/auth.ts` crashes with a TypeError when
`user.email` is `null` or `undefined`. This happens because the email validation
regex is called directly on `user.email` without a null check.

Stack trace from production:
```
TypeError: Cannot read properties of null (reading 'match')
  at authenticate (src/auth.ts:42)
  at handleLogin (src/routes/login.ts:18)
```

The auth module was refactored in PR #42 and the null check was accidentally
removed.
```

The user commits and pushes:

```bash
git add .ralph/tasks/pending/fix-auth-null.md
git commit -m "task: add fix-auth-null"
git push origin main
```

### Step 2: Entry Criteria Check

The orchestrator pulls, scans `pending/`, and evaluates `fix-auth-null.md`:

```
[ENTRY] Checking fix-auth-null.md
  id: fix-auth-null               OK
  type: bugfix                     OK (valid type)
  title: present                   OK
  acceptance_criteria: 4 items     OK
  depends_on: []                   OK (no dependencies)
  tags: [backend, auth]            OK (matches require_tags: [backend])
  priority: 50                     OK (below max_priority: 500)
[ENTRY] Task fix-auth-null is ELIGIBLE
```

### Step 3: Prompt Construction

The prompt builder:

1. Parses frontmatter + body from the task file.
2. Selects `.ralph/templates/bugfix.md`.
3. Interpolates variables.
4. Reads `verify.test` from config: `bun test`.

**Constructed prompt:**

```markdown
# Bugfix: Fix null email crash in authenticate() [fix-auth-null]

## Role

You are fixing a bug. Be surgical -- change only what is necessary to resolve the issue. Do not refactor surrounding code. Do not add features.

## Bug Description

The `authenticate()` function in `src/auth.ts` crashes with a TypeError when
`user.email` is `null` or `undefined`. This happens because the email validation
regex is called directly on `user.email` without a null check.

Stack trace from production:
```
TypeError: Cannot read properties of null (reading 'match')
  at authenticate (src/auth.ts:42)
  at handleLogin (src/routes/login.ts:18)
```

The auth module was refactored in PR #42 and the null check was accidentally
removed.

## Files to Investigate

- `src/auth.ts`
- `src/auth.test.ts`

> Start with these files. If the root cause is elsewhere, follow it, but document why you left the listed scope.

## Acceptance Criteria

- [ ] authenticate() returns AuthError when user.email is null
- [ ] authenticate() returns AuthError when user.email is empty string
- [ ] All existing auth tests still pass
- [ ] New test covers null and empty email cases

## Constraints

- Only modify files listed above unless the root cause requires otherwise.
- Do not refactor code unrelated to the bug.
- Do not change public interfaces or function signatures unless required by the fix.
- Do not modify the User type definition
- Do not change the function signature of authenticate()

## Workflow

1. Read the files listed above to understand the current behavior.
2. Reproduce the bug mentally -- understand why it happens.
3. Identify the root cause. Document it in your commit message.
4. Implement the minimal fix.
5. Add a test that would have caught this bug (a regression test).
6. Run the test suite: `bun test`
7. If tests fail, fix and re-run. Do not commit failing tests.
8. Verify the build: `bun run build`
9. Commit with: `fix(scope): Fix null email crash in authenticate() [fix-auth-null]`
```

### Step 4: CLI Command

The orchestrator constructs and runs:

```bash
timeout 900 claude -p "$(cat /tmp/ralph-prompt-fix-auth-null.md)" \
  --output-format json \
  --max-turns 40 \
  --max-budget-usd 5.00 \
  --model opus \
  --allowedTools \
    "Read" "Edit" "Write" "Glob" "Grep" \
    "Bash(bun test *)" "Bash(bun run *)" "Bash(bunx *)" \
    "Bash(git status *)" "Bash(git diff *)" "Bash(git log *)" \
    "Bash(git add *)" "Bash(git commit *)" \
    "Bash(cat *)" "Bash(ls *)" "Bash(find *)" \
  --append-system-prompt-file .ralph/ralph-system.md \
  2>/dev/null
```

Working directory is the project root, on branch `ralph/fix-auth-null`.

### Step 5: Claude JSON Output

```json
{
  "result": "Fixed the null email crash in authenticate(). Added null/empty checks before email validation regex. Added 4 new test cases covering null, undefined, and empty string email values. All 23 tests pass.",
  "session_id": "sess-a1b2c3d4",
  "stop_reason": "end_turn",
  "cost_usd": 1.47,
  "turns_used": 18,
  "model": "claude-opus-4-6"
}
```

### Step 6: Exit Criteria Evaluation

**Layer 1 -- Process exit:** Exit code 0. OK.

**Layer 2 -- Stop reason:** `end_turn`. Claude finished naturally. OK.

**Layer 3 -- Verification:**

```
[VERIFY] Running: bun test
  23 tests, 23 passed, 0 failed (1.2s)
  Result: PASS

[VERIFY] Running: bun run build
  Build completed successfully
  Result: PASS

[VERIFY] Lint not required for bugfix type. Skipping.
```

**Layer 4 -- Custom checks:** None configured. Skipping.

**All layers pass.** Transition: `active/` -> `review/`.

### Step 7: State Transition

The orchestrator:

1. Pushes the `ralph/fix-auth-null` branch with the agent's commits.
2. Switches back to `main`.
3. Moves the task file: `git mv .ralph/tasks/active/fix-auth-null.md .ralph/tasks/review/fix-auth-null.md`
4. Updates frontmatter with execution metadata:

```yaml
---
id: fix-auth-null
type: bugfix
title: Fix null email crash in authenticate()
priority: 50
acceptance_criteria:
  - "authenticate() returns AuthError when user.email is null"
  - "authenticate() returns AuthError when user.email is empty string"
  - "All existing auth tests still pass"
  - "New test covers null and empty email cases"
files:
  - src/auth.ts
  - src/auth.test.ts
constraints:
  - "Do not modify the User type definition"
  - "Do not change the function signature of authenticate()"
depends_on: []
max_retries: 1
tags:
  - backend
  - auth
execution:
  session_id: sess-a1b2c3d4
  branch: ralph/fix-auth-null
  cost_usd: 1.47
  turns_used: 18
  model: claude-opus-4-6
  started_at: "2026-03-03T10:15:00Z"
  completed_at: "2026-03-03T10:22:00Z"
  verification:
    tests: pass
    build: pass
  stop_reason: end_turn
---
```

5. Commits: `ralph(fix-auth-null): completed -> review`
6. Pushes to main.
7. Appends to `.ralph/logs/executions.jsonl`:

```json
{"task_id":"fix-auth-null","status":"review","cost_usd":1.47,"turns":18,"duration_s":420,"model":"claude-opus-4-6","stop_reason":"end_turn","verify_tests":"pass","verify_build":"pass","branch":"ralph/fix-auth-null","timestamp":"2026-03-03T10:22:00Z"}
```

### Step 8: User Reviews

The user pulls, sees the task in `review/`, checks the branch:

```bash
git pull
git log --oneline ralph/fix-auth-null
git diff main...ralph/fix-auth-null
```

They approve via the `/ralph-review` skill, which moves the task to `done/` and merges the branch.

---

## Summary: Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| System prompt approach | `--append-system-prompt-file` (augment, don't replace) | Keep Claude Code's built-in behaviors |
| System prompt length | <80 lines, 20 rules | Longer prompts dilute attention |
| Template strategy | Default + 4 specialized (bugfix, feature, refactor, research) | Start minimal, specialize when data shows benefit |
| Template interpolation | Simple `{{variable}}` replacement, no logic | Logic belongs in the builder, not the template |
| Entry criteria | Required fields + dependency check + configurable filters | Reject bad tasks early, before burning API tokens |
| Exit criteria | 4 layers: process exit, stop reason, verification, custom | Defense in depth |
| Verification source of truth | Orchestrator runs commands OUTSIDE Claude's session | Never trust the agent's claim of "tests pass" |
| Tool profiles | Per-type via `--allowedTools`, NOT `--dangerously-skip-permissions` | Principle of least privilege at the behavioral level |
| Agent definition | Not used in V1, optional in V2 | One source of truth (orchestrator CLI flags) |
| Context management | Small tasks + max-turns caps + front-loaded prompts | Can't fix context exhaustion, can avoid it |
| Prompt builder | Pure function, no side effects | Trivially testable with snapshots |
| Config location | `.ralph/config.json` | Single file, version-controlled, project-specific |
