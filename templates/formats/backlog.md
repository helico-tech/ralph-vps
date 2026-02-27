# Format: Backlog (BACKLOG.md)

A backlog file is the single source of truth for planned work. It contains metadata, epics, and their stories. The agent reads this file each iteration to decide what to work on next.

## Structure

```
# Backlog: <project name>

## Meta
- **Goal:** <one-sentence project goal>
- **Tech Stack:** <languages, frameworks, key tools>
- **Repository:** <repo URL or path>

---

## Epic: <title>
<description>

### Story: <title>
<story fields per story.md>

### Story: <title>
<story fields per story.md>

---

## Epic: <title>
<description>

### Story: <title>
<story fields per story.md>
```

## Rules

1. Epics are separated by `---` horizontal rules.
2. Stories within an epic are listed in recommended execution order.
3. The agent picks the next story by finding the first `[ ] todo` story whose dependencies (if any) are all `[x] done`.
4. The agent sets the story to `[~] in-progress` before starting work and `[x] done` when finished.
5. Stories should be sized so one agent iteration can complete them (roughly 30–50 tool calls).

## Minimal Example

```markdown
# Backlog: my-app

## Meta
- **Goal:** Build a REST API for task management
- **Tech Stack:** Node.js, Express, PostgreSQL
- **Repository:** git@github.com:user/my-app.git

---

## Epic: Project Setup

Set up the project scaffolding, dependencies, and development tooling.

### Story: Initialize Node.js project
- **Status:** [x] done
- **Priority:** high
- **Description:** Run npm init, install Express and TypeScript, configure tsconfig.
- **Acceptance Criteria:**
  - package.json exists with express and typescript dependencies
  - tsconfig.json configured for ES2020 target
  - npm run build compiles without errors

### Story: Add PostgreSQL connection
- **Status:** [ ] todo
- **Priority:** high
- **Depends on:** Initialize Node.js project
- **Description:** Set up a database connection pool using pg library.
- **Acceptance Criteria:**
  - Database connection configured via environment variables
  - Connection pool created on app startup
  - Health check endpoint verifies DB connectivity

---

## Epic: Task CRUD

Implement create, read, update, and delete operations for tasks.

### Story: Create tasks endpoint
- **Status:** [ ] todo
- **Priority:** high
- **Depends on:** Add PostgreSQL connection
- **Description:** Implement POST /api/tasks to create a new task.
- **Acceptance Criteria:**
  - Accepts title and description in JSON body
  - Returns 201 with created task including generated ID
  - Validates that title is non-empty
```
