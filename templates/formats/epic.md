# Format: Epic File

An epic is a standalone markdown file in `epics/<slug>.md`. It groups related stories. The slug in BACKLOG.md maps to this file.

## Structure

```
# Epic: <title>

<description — one or two sentences>

### Story: <title>
<story fields per story.md>

### Story: <title>
<story fields per story.md>
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| Heading | Yes | `# Epic: <title>` — h1 since it's a standalone file |
| Description | Yes | One or two sentences explaining the goal of the epic |
| Stories | Yes | One or more stories listed under the epic (see `story.md`) |

## Rules

1. The heading is `#` (h1), not `##`, because each epic is its own file.
2. Stories within an epic are listed in recommended execution order.
3. The agent works through stories top to bottom, respecting dependencies.
4. The filename must match the slug in BACKLOG.md: `epics/user-auth.md` ↔ `user-auth`.

## Example

```markdown
# Epic: User Authentication

Implement login, registration, and session management so users can securely access the application.

### Story: Set up authentication database schema
- **Status:** [x] done
- **Priority:** high

#### Tasks
- [x] Create users table migration with email, hashed password, and timestamps
- [x] Add unique index on email column
- [x] Verify migration is reversible

#### Acceptance Criteria
- Migration creates users table with correct columns
- Migration is reversible

### Story: Add login API endpoint
- **Status:** [~] in-progress
- **Priority:** high
- **Depends on:** Set up authentication database schema

#### Tasks
- [x] Create POST /api/auth/login route
- [x] Implement bcrypt password verification
- [ ] Add JWT session token generation
- [ ] Add rate limiting middleware

#### Acceptance Criteria
- Endpoint accepts email and password in JSON body
- Returns 200 with session token on valid credentials
- Returns 401 on invalid credentials
- Rate-limited to 5 attempts per minute per IP
```
