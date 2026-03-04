# Test: {{title}}

**ID:** {{id}}
**Type:** test
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

## Test Workflow

Follow this workflow strictly:

1. **Understand what needs testing.** Read the description and the code under test. Understand the expected behavior.
2. **Find the right test file.** Check if a test file for the target module already exists. Add to it — don't create a parallel file.
3. **Write focused tests.** Each test should verify one specific behavior. Use descriptive names that explain the scenario.
4. **Do not modify production code.** If production code needs changes to be testable, that is a separate task.
5. **Run the full suite.** All tests — new and existing — must pass.
6. Stage only the test files you created or modified. Never use `git add -A` or `git add .`.
7. Commit with the message format: `ralph({{id}}): test <brief description>`.
