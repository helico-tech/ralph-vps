# Chore: {{title}}

**ID:** {{id}}
**Type:** chore
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

## Chore Workflow

Follow this workflow strictly:

1. **Understand the scope.** Read the description. Identify exactly which files and configurations need to change.
2. **Make the changes.** Follow existing patterns. Keep changes minimal and focused.
3. **Verify nothing is broken.** Run tests even for non-code changes. Configuration changes can break things in unexpected ways.
4. **Do not scope-creep.** Chores are maintenance tasks. Do not refactor or improve beyond the stated acceptance criteria.
5. Stage only the files you changed. Never use `git add -A` or `git add .`.
6. Commit with the message format: `ralph({{id}}): chore <brief description>`.
