# Refactor: {{title}}

**ID:** {{id}}
**Type:** refactor
**Author:** {{author}}

## Description

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

## Refactor Workflow

Follow this workflow strictly:

1. **Understand the current code.** Read the files in scope. Identify why the code needs refactoring — coupling, duplication, poor naming, etc.
2. **Ensure tests exist.** Do not refactor code that has no tests — write them first. The tests define the contract you must preserve.
3. **Refactor incrementally.** Make small, verifiable steps. Run tests after each meaningful change.
4. **Preserve behavior exactly.** A refactor changes structure, not behavior. If the tests pass, behavior is preserved.
5. **Do not add features.** Stay within scope. If you notice improvements outside the acceptance criteria, ignore them.
6. Stage only the files you changed. Never use `git add -A` or `git add .`.
7. Commit with the message format: `ralph({{id}}): refactor <brief description>`.
