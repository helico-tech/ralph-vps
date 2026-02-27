# Format: Progress Entry

A progress entry is appended to PROGRESS.md after each completed story. It provides a chronological record of what the agent accomplished.

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| Heading | Yes | `## <story title>` |
| Timestamp | Yes | `- **Completed:** <YYYY-MM-DD HH:MM UTC>` |
| Epic | Yes | `- **Epic:** <epic title>` |
| Summary | Yes | `- **Summary:** <what was done>` — two or three sentences |
| Changes | Yes | `- **Changes:**` followed by a bulleted list of files or areas modified |
| Issues | No | `- **Issues:**` — problems encountered, workarounds applied, or follow-up needed |

## Example

```markdown
## Add login API endpoint
- **Completed:** 2026-02-27 14:32 UTC
- **Epic:** User Authentication
- **Summary:** Created POST /api/auth/login endpoint with bcrypt password verification and JWT session tokens. Added rate limiting middleware.
- **Changes:**
  - src/routes/auth.ts — new login route
  - src/middleware/rate-limit.ts — rate limiting config
  - tests/auth.test.ts — login endpoint tests
  - package.json — added bcrypt and jsonwebtoken dependencies
- **Issues:** express-rate-limit v7 changed its API; pinned to v6 for now.
```
