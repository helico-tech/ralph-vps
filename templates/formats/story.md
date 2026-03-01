# Format: Story

A story is a single unit of work within an epic file. Stories have a task list that the agent works through, checking off items as it completes them. This enables handoff between iterations — if an iteration ends mid-story, the next iteration reads the task list and picks up from the first unchecked item.

## Fields

| Field | Required | Format |
|-------|----------|--------|
| Heading | Yes | `### Story: <title>` — concise, action-oriented |
| Status | Yes | `- **Status:** [ ] todo`, `[~] in-progress`, or `[x] done` |
| Priority | Yes | `- **Priority:** high`, `medium`, or `low` |
| Depends on | No | `- **Depends on:** <other story title>` — must be completed first |
| Context | No | `- **Context:** <background info>` — pointers to files, docs, or decisions |
| Technical Notes | No | `- **Technical Notes:** <implementation hints>` — suggestions, not mandates |
| Tasks | Yes | `#### Tasks` followed by `- [ ]` checkbox list |
| Acceptance Criteria | Yes | `#### Acceptance Criteria` followed by bullet list |

## Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Todo — not yet started |
| `[~]`  | In-progress — agent is working on it |
| `[x]`  | Done — completed and verified |

## Task List

The `#### Tasks` section is an ordered checkbox list of concrete work items:

```markdown
#### Tasks
- [ ] Create the database migration file
- [ ] Add model with validations
- [ ] Write unit tests
- [ ] Run tests and verify they pass
```

Rules:
- Tasks are worked through in order, top to bottom.
- The agent checks off each task (`- [x]`) after completing it and commits the epic file.
- If an iteration ends mid-story, the next iteration picks up from the first unchecked `- [ ]` task.
- A story can only be marked `[x] done` when ALL tasks are checked off AND acceptance criteria pass.

## Acceptance Criteria

The `#### Acceptance Criteria` section lists validation checks:

```markdown
#### Acceptance Criteria
- Migration creates table with correct columns
- All tests pass
- No linting errors
```

These are verified after all tasks are complete, before marking the story done.

## Example

```markdown
### Story: Add login API endpoint
- **Status:** [~] in-progress
- **Priority:** high
- **Depends on:** Set up authentication database schema
- **Context:** Auth strategy decided in ADR-003. Use bcrypt for password comparison.
- **Technical Notes:** Consider using express-rate-limit middleware.

#### Tasks
- [x] Create POST /api/auth/login route handler
- [x] Implement bcrypt password verification
- [ ] Add JWT session token generation
- [ ] Add rate limiting middleware (5 req/min/IP)
- [ ] Write integration tests for login endpoint

#### Acceptance Criteria
- Endpoint accepts email and password in JSON body
- Returns 200 with session token on valid credentials
- Returns 401 on invalid credentials
- Rate-limited to 5 attempts per minute per IP
```
