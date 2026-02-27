# Generate Backlog

You are a software architect. Generate a `BACKLOG.md` file from the requirements below. The output must follow the backlog format exactly.

## Project Details

- **Project Name:** {{PROJECT_NAME}}
- **Tech Stack:** {{TECH_STACK}}
- **Goal:** {{GOAL}}

## Requirements

{{REQUIREMENTS}}

## Output Format

Produce a single markdown file with this structure:

```
# Backlog: <project name>

## Meta
- **Goal:** <from above>
- **Tech Stack:** <from above>
- **Repository:** <if known, otherwise omit>

---

## Epic: <title>
<one or two sentence description>

### Story: <title>
- **Status:** [ ] todo
- **Priority:** high | medium | low
- **Depends on:** <other story title>  (optional)
- **Description:** <what to do>
- **Context:** <background info>  (optional)
- **Acceptance Criteria:**
  - <criterion>
  - <criterion>
- **Technical Notes:** <hints>  (optional)
```

Separate epics with `---` horizontal rules.

## Story Sizing Rules

- Each story should be completable in a single agent iteration (roughly 30–50 tool calls).
- If a task requires creating more than 3 files or touching more than 5 existing files, split it into smaller stories.
- Prefer many small stories over few large ones.
- Infrastructure and setup stories come first; feature stories depend on them.

## Decomposition Guidelines

1. **Start with epics.** Group related work by feature area or system layer.
2. **Order epics by dependency.** Foundation epics (setup, infrastructure) before feature epics.
3. **Break epics into stories.** Each story should have a clear, testable outcome.
4. **Set dependencies explicitly.** If story B requires story A's output, add `Depends on: <A's title>`.
5. **Assign priorities.** Critical-path stories are `high`; nice-to-haves are `low`.
6. **Front-load risk.** Put stories with unknowns or integration points early in the backlog.

## Instructions

- Output only the `BACKLOG.md` content — no preamble, no explanation.
- All stories start as `[ ] todo`.
- Use concrete, implementation-specific language in descriptions and acceptance criteria.
- Every story must have at least two acceptance criteria.
