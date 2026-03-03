# Feature: {{title}}

**ID:** {{id}}
**Type:** feature
**Author:** {{author}}

## Feature Description

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

## Feature Workflow

Follow this workflow strictly:

1. **Study existing patterns.** Before writing any code, read the relevant files and understand how similar functionality is implemented in this project. Follow the same patterns and conventions.
2. **Plan your changes.** Identify which files need to be created or modified. Keep the scope tight — only implement what the acceptance criteria require.
3. **Implement the feature.** Write clean, readable code that follows project conventions. If you're unsure about a convention, look at existing code for guidance.
4. **Write tests.** Every new function or behavior should have tests. Follow the project's existing test patterns.
5. **Verify everything.** Run the full test suite. All tests — existing and new — must pass.
6. Stage only the files you changed. Never use `git add -A` or `git add .`.
7. Commit with the message format: `ralph({{id}}): add <brief description>`.
