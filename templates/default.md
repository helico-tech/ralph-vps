# Task: {{title}}

**ID:** {{id}}
**Type:** {{type}}
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

## Instructions

1. Read and understand the task description and acceptance criteria above.
2. Explore the relevant files to understand the current state of the code.
3. Make the changes described. Stay within the scope of this task — do not refactor unrelated code or add features not requested.
4. Run the project's test suite to verify your changes don't break anything.
5. If the task requires new functionality, write tests for it.
6. Stage only the files you changed. Never use `git add -A` or `git add .`.
7. Commit your changes with the message format: `ralph({{id}}): <brief description>`.
