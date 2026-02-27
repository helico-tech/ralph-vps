# Format: Epic

An epic is a high-level body of work that groups related stories. It appears as a level-2 heading inside a backlog file.

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| Heading | Yes | `## Epic: <title>` — short, descriptive name |
| Description | Yes | One or two sentences explaining the goal of the epic |
| Stories | Yes | One or more stories listed under the epic (see `story.md`) |

## Example

```markdown
## Epic: User Authentication

Implement login, registration, and session management so users can securely access the application.

### Story: Set up authentication database schema
- **Status:** [ ] todo
- **Priority:** high
- **Description:** Create users table with email, hashed password, and timestamps.
- **Acceptance Criteria:**
  - Migration creates users table with correct columns
  - Migration is reversible
```
