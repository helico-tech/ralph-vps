# Format: Backlog Index (BACKLOG.md)

BACKLOG.md is a lightweight index that lists project metadata and epics. Each epic is a separate file in `epics/`. The agent reads this file each iteration to find the active or next epic.

## Structure

```
# Backlog: <project name>

## Meta
- **Goal:** <one-sentence project goal>
- **Tech Stack:** <languages, frameworks, key tools>
- **Repository:** <repo URL or path>

## Epics

- [ ] <slug> — <title>
- [ ] <slug> — <title>
- [ ] <slug> — <title>
```

## Epic Line Format

Each epic is a single line under `## Epics`:

```
- [<status>] <slug> — <title>
```

| Part | Description |
|------|-------------|
| Status | `[ ]` todo, `[~]` in-progress, `[x]` done |
| Slug | Kebab-case identifier, maps to `epics/<slug>.md` |
| Title | Human-readable epic title (after ` — `) |

The ` — ` separator (space-em-dash-space) separates slug from title. Use a real em dash (`—`), not a hyphen.

## Slug Conventions

- Lowercase, kebab-case: `user-auth`, `project-setup`, `api-crud`
- Must match the filename: slug `user-auth` → `epics/user-auth.md`
- No spaces, no special characters beyond hyphens

## Rules

1. Only one epic should be `[~]` in-progress at a time.
2. The agent finds the active epic by scanning for `[~]`, or picks the first `[ ]` if none is in-progress.
3. The agent marks an epic `[~]` when starting it and `[x]` when all its stories are done.
4. Completed (`[x]`) epic files should not be read — they waste tokens.
5. The index is grep-parseable: `grep '^\- \[ \]' BACKLOG.md` finds todo epics.

## Minimal Example

```markdown
# Backlog: my-app

## Meta
- **Goal:** Build a REST API for task management
- **Tech Stack:** Node.js, Express, PostgreSQL
- **Repository:** git@github.com:user/my-app.git

## Epics

- [x] project-setup — Project Setup
- [~] api-crud — Task CRUD API
- [ ] auth — User Authentication
```
