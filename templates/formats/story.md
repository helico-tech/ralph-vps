# Format: Story

A story is a single unit of work that an agent can complete in one iteration. Stories live under an epic heading in the backlog.

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| Heading | Yes | `### Story: <title>` — concise, action-oriented |
| Status | Yes | `- **Status:** [ ] todo`, `- **Status:** [~] in-progress`, or `- **Status:** [x] done` |
| Priority | Yes | `- **Priority:** high`, `medium`, or `low` |
| Depends on | No | `- **Depends on:** <other story title>` — must be completed first |
| Description | Yes | `- **Description:** <what to do>` — one or two sentences |
| Context | No | `- **Context:** <background info>` — pointers to files, docs, or decisions |
| Acceptance Criteria | Yes | `- **Acceptance Criteria:**` followed by a bulleted sub-list |
| Technical Notes | No | `- **Technical Notes:** <implementation hints>` — suggestions, not mandates |

## Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Todo — not yet started |
| `[~]`  | In-progress — agent is working on it |
| `[x]`  | Done — completed and verified |

## Example

```markdown
### Story: Add login API endpoint
- **Status:** [ ] todo
- **Priority:** high
- **Depends on:** Set up authentication database schema
- **Description:** Create POST /api/auth/login that validates credentials and returns a session token.
- **Context:** Auth strategy decided in ADR-003. Use bcrypt for password comparison.
- **Acceptance Criteria:**
  - Endpoint accepts email and password in JSON body
  - Returns 200 with session token on valid credentials
  - Returns 401 on invalid credentials
  - Rate-limited to 5 attempts per minute per IP
- **Technical Notes:** Consider using express-rate-limit middleware.
```
