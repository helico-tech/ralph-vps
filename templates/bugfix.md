# Bugfix: {{title}}

**ID:** {{id}}
**Type:** bugfix
**Author:** {{author}}

## Bug Description

{{description}}

## Acceptance Criteria

{{#acceptance_criteria}}
- {{.}}
{{/acceptance_criteria}}

## Files to Focus On

{{#files}}
- {{.}}
{{/files}}

## Constraints

{{#constraints}}
- {{.}}
{{/constraints}}

## Bugfix Workflow

Follow this workflow strictly:

1. **Understand the bug.** Read the description and relevant files. Identify the root cause before writing any code.
2. **Write a failing test first.** Create a test that reproduces the bug. Run the test suite to confirm it fails.
3. **Fix the bug.** Make the minimal change necessary to fix the root cause. Avoid fixing symptoms — address the underlying problem.
4. **Verify the fix.** Run the full test suite. The new test should pass, and no existing tests should break.
5. **Review your change.** Ensure you haven't introduced new problems. Keep the diff minimal — only change what's necessary.
6. Stage only the files you changed. Never use `git add -A` or `git add .`.
7. Commit with the message format: `ralph({{id}}): fix <brief description>`.
