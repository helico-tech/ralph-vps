# Research: {{title}}

**ID:** {{id}}
**Type:** research
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

## Research Workflow

Follow this workflow strictly:

1. **Understand the question.** Read the description carefully. Identify exactly what information is needed.
2. **Explore the codebase.** Use search tools to find relevant code, patterns, and existing solutions.
3. **Investigate.** Read files, trace call chains, identify constraints and trade-offs.
4. **Write up findings.** Create a markdown document at `.ralph/research/{{id}}.md` with your findings. Include: current state, options considered, trade-offs, and a recommendation.
5. **Do not implement.** Research tasks produce documents, not code changes. Do not modify source files unless explicitly required by the acceptance criteria.
6. Stage only the files you created. Never use `git add -A` or `git add .`.
7. Commit with the message format: `ralph({{id}}): research <brief description>`.
