# Phase 2: Cross-Review from Runtime/Ops Perspective

> **node-runtime** cross-review | 2026-03-03
>
> Reviewing: onboarding.md, observability.md, core-arch.md, prompt-templates.md, client-interface.md
> Through the lens of: What actually happens when this runs on a VPS or inside Docker?

---

## 1. Review: onboarding.md (by onboarding specialist)

### What's Good

- The two-path approach (Docker vs bare VPS) is correct and maps cleanly to my runtime adapters. The comparison table is honest about tradeoffs.
- `ralph init node` running FROM the user's laptop over SSH is the right call. The user's laptop is the control plane, the VPS is the worker. Clear separation.
- The SSH key generation flow during `ralph init node` is realistic. Generating the key on the node and having the user add it as a deploy key avoids the user ever needing to copy private keys around.
- `ralph doctor` aligns perfectly with my `ralph doctor` contract checker. Same concept, same checks.
- The "Hello, Ralph" first-task experience with built-in diagnostics if it fails is genuinely good UX design.

### Operational Problems

**1. The Docker install script is a landmine.**

```typescript
await ssh.exec(DOCKER_INSTALL_SCRIPT);
```

"Install Docker" on a fresh VPS means: add Docker's GPT key, add the Docker apt repository, `apt-get update`, `apt-get install docker-ce docker-ce-cli containerd.io`. This script varies by OS version, can fail in ten different ways, and takes 2-5 minutes. If the user's VPS doesn't run Ubuntu/Debian (Fedora, Alpine, etc.), this fails silently or breaks the system.

**Fix:** Don't script Docker installation. Instead:
- For Hetzner: recommend the "Docker CE" app image, which comes with Docker pre-installed. Zero setup.
- For DigitalOcean: recommend the Docker 1-click droplet.
- If neither: provide a link to Docker's official install page and have `ralph init node` check for Docker presence before proceeding. The init script should VERIFY Docker is installed, not INSTALL it.

Trying to be a Docker installer is scope creep and a maintenance nightmare.

**2. `ralph init node --bare` installs Claude Code via a mystery install script.**

```bash
await ssh.execAs('ralph', 'curl -fsSL https://claude.ai/install.sh | bash');
```

The Claude Code CLI is an npm package (`@anthropic-ai/claude-code`). It installs via `npm install -g @anthropic-ai/claude-code` or `bun install -g @anthropic-ai/claude-code`. There is no `https://claude.ai/install.sh`. This is a fabricated URL.

**Fix:** Use the actual install method:
```bash
bun install -g @anthropic-ai/claude-code@latest
```

Node/Bun is already installed at this point in the script, so npm/bun is available. Don't pipe mystery URLs into bash.

**3. The API key validation is hand-wavy.**

```
-> Verified: API key is valid (model: claude-sonnet-4-20250514)
```

How do you verify an API key without making an API call? The init script needs to make a cheap API call (like listing models or sending a trivial prompt) to verify the key. This costs a fraction of a cent. Document that verification costs money (even if trivially small) so the user isn't surprised.

**4. No mention of `known_hosts` setup.**

The SSH key flow generates a keypair and has the user add the deploy key to GitHub. But the first `git clone` on the VPS will prompt: "The authenticity of host 'github.com' can't be established. Are you sure you want to continue connecting?" In a non-interactive (Docker/systemd) context, this BLOCKS forever.

My deep-dive covers this: pre-populate `known_hosts` with `ssh-keyscan`. The onboarding script needs to do this as part of the SSH key setup step. It's missing entirely.

**5. `ralph init project` detects project type but doesn't verify commands work.**

It detects `package.json + bun.lockb` and sets `test: "bun test"`. But what if `bun test` doesn't work because dependencies aren't installed? Or the test config is wrong?

**Fix:** After detecting and writing config, run the detected commands on the NODE (not the laptop) to verify they work. A `verify.test` command that doesn't pass on a clean checkout is worse than no command at all.

### Score: 7/10

Good UX design, honest about the dual-path tradeoff. But the provisioning scripts have gaps that would cause real failures during onboarding. The `known_hosts` omission alone would block most users.

---

## 2. Review: observability.md (by observability specialist)

### What's Good

- Comprehensive breakdown of Claude Code's output formats (json vs stream-json vs JSONL session logs). This is the best reference on what data is available.
- The execution trace design is thorough. Per-task JSON trace files + JSONL index is the right architecture.
- The heartbeat is explicitly disk-only, NOT in git. This aligns with my deep-dive and the consensus. No commit spam.
- The observability port design (emit events, adapters consume) is clean and maps to the hexagonal pattern.
- Cost tracking from `total_cost_usd` in Claude's JSON output -- authoritative, no estimation. Good.
- Tuning recommendations based on trace history is a genuinely useful V2 feature.

### Operational Problems

**1. `.ralph/traces/` committed to git will cause BLOAT.**

This is the single biggest operational concern in the entire document. Every task generates a `.ralph/traces/<task-id>.json` file. The trace includes tool call summaries, verification output, and potentially long Claude responses. A conservative estimate: 5-20 KB per trace file.

After 100 tasks: 500 KB - 2 MB of trace files in git history.
After 1000 tasks: 5 MB - 20 MB of trace files that NEVER get garbage collected (git stores every version forever).

The `index.jsonl` file is append-only, so it grows linearly too. After 1000 tasks, it's 100-300 KB of a single file with 1000 lines. Every `git pull` sends the entire new version.

**Fix:** Traces should NOT be in the `.ralph/` directory that lives in the project repo. Options:

a. **Trace files on disk only (not in git).** The orchestrator writes them to a local directory. The client reads them via SSH. This is the simplest.

b. **Trace files in git, but in a separate orphan branch** (`ralph-traces`). The project's main branch stays clean. Users who want traces check out that branch.

c. **Trace summaries in task frontmatter, full traces on disk.** When a task moves to `done/`, add `cost_usd`, `turns`, `duration_s` to its frontmatter. The full trace with tool call breakdowns stays local.

I recommend option (c): summary in git (small, useful for `ralph status`), full trace on disk (for deep inspection via SSH or `ralph trace <id>` which SSHes in).

**2. The heartbeat file location is inconsistent.**

My deep-dive writes it to `/home/ralph/heartbeat.json` (outside the workspace).
Observability writes it to `.ralph/heartbeat.json` (inside the workspace).

If it's inside the workspace, it's inside the git repo. Even if `.gitignore`d, it creates noise for `git status`. Worse, if someone runs `git add -A` (despite our rules against it), the heartbeat ends up in git.

**Fix:** Heartbeat lives outside the workspace: `/home/ralph/heartbeat.json` in Docker, or `~/heartbeat.json` on bare VPS. Never inside the git repo. The `.gitignore` approach is a second line of defense, not a primary strategy.

**3. Stream-JSON parsing adds complexity for V1.**

The doc recommends `--output-format stream-json` for V1 to capture tool calls. Parsing NDJSON in real-time from a subprocess is significantly more complex than parsing a single JSON blob at the end. It requires:
- Line-buffered reading from stdout
- State tracking across events
- Handling partial JSON chunks
- Error recovery if the stream is interrupted

For V1, plain `--output-format json` gives us cost, duration, turns, and session_id. That's enough. Tool call tracking is a V2 nicety. Don't add stream parsing complexity when you're trying to get the basic loop working.

**Fix:** Start with `--output-format json`. Add stream-json when you have a working system and actually need tool-level data. The observability port design supports this swap without touching the core -- just replace the adapter.

**4. `traces/index.jsonl` has no rotation strategy.**

A single append-only file that grows forever. On a VPS with 40 GB disk, this isn't a disk space problem. But `jq` and line-counting tools slow down as the file grows. After 10,000 tasks, parsing `index.jsonl` for cost summaries takes noticeable time.

**Fix:** Monthly rotation: `traces/index-2026-03.jsonl`, `traces/index-2026-04.jsonl`, etc. The analytics commands combine them when needed. Each file stays small.

**5. The composite observer pattern is fine but may mask failures.**

```typescript
for (const adapter of this.adapters) {
  adapter.emit(event);
}
```

If the trace writer fails (disk full, permission error), the heartbeat writer still runs. But the error is silently swallowed. In ops, silent failures are the worst kind.

**Fix:** Catch errors per-adapter and log them, but don't stop the loop. The main loop should never crash because a trace file couldn't be written.

### Score: 8/10

The best-researched document in the set. The observability port design is clean and correct. The trace-in-git bloat is the main concern -- it will become a real problem at scale and should be addressed before V1 ships.

---

## 3. Review: core-arch.md (by core-arch specialist)

### What's Good

- The hexagonal split is clean and well-motivated. Core (pure), ports (interfaces), adapters (impure), orchestrator (composition root). No over-abstraction.
- The "no ceremony" test is excellent: "if a port would have exactly one method that's called exactly once, it's not a port -- it's a function call." This prevents over-engineering.
- Cutting the `Clock`, `EventEmitter`, `ConfigLoader`, and `TemplateLoader` ports is correct. They would be ceremony without value.
- The `FsTaskRepository` not knowing about git is a good separation. File ops and git ops are independent testability concerns.
- The orchestrator as composition root (creates adapters, wires them, runs loop) is the right pattern. No DI framework.
- Section 3.7 explicitly states "Docker vs bare VPS: Nothing at the orchestrator level." This is the key insight and perfectly aligns with my runtime contract.

### Operational Problems

**1. `FsTaskRepository.transition()` does `writeFile` + `unlink` -- but the orchestrator also needs `git mv`.**

```typescript
async transition(task: Task, from: TaskStatus, to: TaskStatus): Promise<void> {
  const content = this.serializeTask(task);
  await writeFile(toPath, content);
  await unlink(fromPath).catch(() => {});
}
```

The design note says "The caller (orchestrator) is responsible for git mv." But wait -- `git mv` IS the file move. If the repository does `writeFile(toPath)` + `unlink(fromPath)`, that's a manual copy-and-delete. Then the orchestrator also does `git mv`? That's two different mechanisms moving the same file.

In git's model, `git mv A B` is atomic: it stages the rename. If you manually `writeFile(B)` + `unlink(A)`, git sees "file A deleted, new file B created" -- you lose rename tracking in git history.

**Fix:** The `TaskRepository.transition()` should NOT move files at all. It should:
1. Write the updated frontmatter to the existing file (in the FROM directory)
2. Return the updated task

Then the ORCHESTRATOR does:
1. `git mv from/file to/file` (atomic rename in git)
2. `git add to/file` (stage the content change from step 1)
3. `git commit`

This keeps rename tracking clean and separates concerns properly. The repository writes content, the source control moves files.

**2. The `SourceControl.pull()` does `git pull --rebase origin main` -- what if we're on a task branch?**

After executing a task, the orchestrator is on `ralph/<task-id>`. If the next loop iteration starts with `git.pull()`, that's `git pull --rebase origin main` on the task branch. This rebases the task branch onto remote main, which is NOT what we want.

The loop needs to `git checkout main` BEFORE pulling. The current code in `orchestrator/index.ts` (section 4) doesn't show this step between loop iterations.

**Fix:** Add `git.checkout('main')` at the start of each loop iteration, before `git.pull()`. Or better: have `pull()` always pull main regardless of current branch by doing `git fetch origin && git checkout main && git merge --ff-only origin/main`.

**3. The consistency check runs every loop iteration -- is this expensive?**

```typescript
const inconsistencies = checkConsistency(await repo.locateAll());
```

`locateAll()` reads EVERY task file in EVERY directory and parses the frontmatter. For 10 tasks, this is instant. For 200 tasks (100 in `done/`, 50 in `failed/`, etc.), this reads and parses 200 markdown files on every 30-second poll cycle.

**Fix:** Skip `done/` and `failed/` directories in the consistency check. Those are terminal states -- if they were consistent when they entered, they're consistent now. Only check `pending/`, `active/`, and `review/`.

Or: run the consistency check once at startup, then only after state transitions (not on idle polls).

**4. The `ShellVerifier` splits commands on spaces: `command.split(" ")`.**

```typescript
const [cmd, ...args] = command.split(" ");
```

This breaks on commands with quoted arguments: `bun test --grep "auth flow"` becomes `["bun", "test", "--grep", "\"auth", "flow\""]`. The quotes are not handled.

**Fix:** Don't split. Run through the shell:
```typescript
Bun.spawn(["sh", "-c", command], { cwd: this.cwd, ... });
```

This lets the user write any valid shell command in `verify.test`, including pipes, redirects, and quoted arguments.

**5. The mock executor is smart but the canned responses match on prompt substring.**

```typescript
whenPromptContains(substring: string, result: Partial<ExecutionResult>): void
```

Prompt content changes when templates change. Substring matching on prompts is fragile. A template tweak breaks all mock tests.

**Fix:** Match on task ID instead of prompt content. The orchestrator knows the task ID when it calls `execute()`. The mock should match on that, not on the interpolated prompt string.

### Score: 9/10

The strongest architecture document. The hexagonal split is clean, the "no ceremony" test prevents bloat, and the Docker/VPS agnosticism is explicitly stated. The `FsTaskRepository.transition()` doing manual file ops instead of letting git handle the move is the main issue -- it will break rename tracking and confuse the git history.

---

## 4. Review: prompt-templates.md (by prompt-templates specialist)

### What's Good

- The system prompt (`ralph-system.md`) is under 80 lines and covers the critical guardrails. "Do not ask questions -- no one will answer" is the most important line.
- The `RALPH-STUCK.md` protocol (stop early, document what failed) is operationally excellent. Burns far less budget than endless retrying.
- Template variables and interpolation are simple `{{variable}}` replacement. No Mustache, no Handlebars, no template engine dependency.
- Entry criteria with configurable tag/type filters support my multi-orchestrator scenario (frontend worker only picks up `[frontend]` tasks).
- Tool profiles per task type (readonly for research, standard for code changes) are security-correct.
- The research template writing to `.ralph/research/<id>.md` instead of modifying code is a good isolation pattern.

### Operational Problems

**1. Verification commands are hardcoded as strings in config, but they run on the NODE, not on the user's laptop.**

```json
{
  "verify": {
    "test": "bun test",
    "build": "bun run build"
  }
}
```

The user writes `"test": "bun test"` on their laptop. This runs on the VPS inside Docker. What if:
- The Docker image has `bun` but the project needs `npm`?
- The project needs specific environment variables for tests (e.g., `DATABASE_URL`)?
- The tests require a running database or service?

The config says WHAT to run, but nothing about the runtime environment needed for verification.

**Fix:** Add a `verify.env` section for environment variables needed during verification:
```json
{
  "verify": {
    "test": "bun test",
    "env": {
      "NODE_ENV": "test",
      "DATABASE_URL": "sqlite:///tmp/test.db"
    }
  }
}
```

The orchestrator injects these env vars when running verification commands. This keeps the node generic while allowing per-project test environments.

**2. The `custom_check` script for entry criteria is a security concern.**

```json
{
  "entry_criteria": {
    "custom_check": ".ralph/scripts/can-pickup.sh"
  }
}
```

A user-defined script that runs on the VPS with the orchestrator's permissions. If someone pushes a malicious script to `.ralph/scripts/`, the orchestrator executes it. In a system where git is the transport layer, this means anyone with push access can execute arbitrary code on the VPS.

**Fix:** Either:
a. Remove custom_check entirely for V1 (the built-in filters are sufficient).
b. If kept, run it in a restricted sandbox (separate user, no network, read-only filesystem).
c. At minimum: only allow scripts that existed at orchestrator startup time (don't hot-reload custom checks from git pulls).

**3. The verification timeout defaults are not documented in the config schema.**

The doc mentions `test_timeout_seconds: 120` but it's buried in a later section. If the user doesn't set it and their test suite takes 3 minutes, the orchestrator kills it and marks the task as failed. The user has no idea why tests "failed."

**Fix:** Generous defaults (300s for tests, 120s for build, 60s for lint) and a clear log message when a verification command is killed: `"Test command killed after 120s timeout. Increase verify.test_timeout_seconds in config.json."`

**4. `--dangerously-skip-permissions` vs `--allowedTools` tension is unresolved.**

The doc notes that `--dangerously-skip-permissions` skips ALL permission prompts, making `--allowedTools` potentially redundant. But it then defines per-type tool profiles with `--allowedTools`. Which one are we actually using?

From my runtime perspective: inside Docker, use `--dangerously-skip-permissions` (the container IS the sandbox). On bare VPS without containerization, `--allowedTools` is the safety boundary. The adapter should decide:
- Docker adapter: `--dangerously-skip-permissions`
- Bare VPS adapter: `--allowedTools` with the type-specific profile

But wait -- the orchestrator code should NOT know about the deployment environment. This is a configuration concern.

**Fix:** Add a config flag:
```json
{
  "execution": {
    "permission_mode": "skip_all" | "allowed_tools_only"
  }
}
```

Docker users set `"skip_all"`. Bare VPS users set `"allowed_tools_only"`. The executor adapter reads this and passes the right flags. The core doesn't know or care.

**5. The `per_type_overrides` structure for exit criteria is a map inside a map.**

```json
{
  "exit_criteria": {
    "require_tests": true,
    "per_type_overrides": {
      "research": { "require_tests": false }
    }
  }
}
```

This is fine for 2-3 overrides. But the merge logic ("default + override") needs to be clearly documented and tested. What happens if a type override sets `"require_build": true` but the global config has no `verify.build` command? The orchestrator should catch this at startup, not at task execution time.

**Fix:** Validate the full merged config at startup: for every type that has `require_tests: true`, verify that `verify.test` exists. Fail fast with a clear error message.

### Score: 7/10

The templates and system prompt are well-crafted. The entry/exit criteria framework is thorough. The operational gaps are in the boundary between config and runtime: verification commands need environment context, custom checks need sandboxing, and the permission mode needs to be configurable per deployment, not hardcoded.

---

## 5. Review: client-interface.md (by client-interface specialist)

### What's Good

- The three-adapter model (Skills, CLI, Programmatic API) with a shared core is architecturally clean. Same operations, different presentation layers.
- The skill definitions are concrete and actionable. `/ralph-task` includes the actual frontmatter format, `/ralph-review` includes the merge flow. No hand-waving.
- The CLI's argument parser is hand-rolled with zero dependencies. Good discipline.
- The review experience is the most detailed section and addresses the most important user interaction. The skill version (conversational) and CLI version (keyboard-driven) serve different preferences.
- `ralph doctor` on the client side complements my `ralph doctor` on the node side. Full-stack health checking.

### Operational Problems

**1. `/ralph-status` reads `.ralph/status.json` for heartbeat -- but we agreed heartbeat is NOT in git.**

```markdown
2. Read `.ralph/status.json` for node heartbeat info.
3. Determine node health from the `last_heartbeat` field:
   - < 5 minutes ago: ONLINE
   - 5-15 minutes ago: POSSIBLY DOWN
```

The consensus and every other deep-dive (including mine) says: heartbeat is a local file on the VPS, NOT committed to git. `.ralph/status.json` doesn't exist in the git repo. The skill instructs Claude to read a file that isn't there.

This is the most critical inconsistency across the deep-dives. If heartbeat is in git, we get commit spam (consensus says no). If it's not in git, the client can't read it via `git pull`.

**Fix:** Two options:

a. **Git-committed status file, but ONLY updated on state transitions** (not every 30s). When the orchestrator claims a task, moves to review, or completes, it updates `.ralph/status.json` and commits. This gives the client a "last known state" without heartbeat spam. The file changes ~2-4 times per task, not every 30 seconds.

b. **SSH-based heartbeat reading.** The `ralph status` CLI command SSHes to the node and reads the heartbeat file directly:
```bash
ssh ralph-vps 'cat /home/ralph/heartbeat.json'
```
This gives real-time data but requires SSH access from the client.

I recommend (a) for the git-based channel and (b) as an optional enhancement. The skill reads the git-committed `status.json` (stale but available). The CLI can optionally SSH for live data.

**2. The skills duplicate logic that exists in the core library.**

The `/ralph-task` skill says "Generate a task ID by looking at existing task files and incrementing." The core library has a `createTask()` function that does the same thing. If the ID generation logic changes, it must change in both places.

This is a known tradeoff (acknowledged in the doc), but it's worse than presented. Skills are prompts -- Claude INTERPRETS them. The core library is code -- it EXECUTES deterministically. If Claude interprets the ID generation slightly differently (e.g., starts from a different number, uses a different format), you get ID conflicts.

**Fix:** Have skills call the CLI instead of reimplementing logic:
```markdown
## Steps
1. Run `ralph task create --title "..." --type bugfix --json`
2. Parse the JSON output for the created task details
3. Present the result to the user
```

This way, the skill is a thin wrapper around the CLI, which calls the core. One implementation, three interfaces. The skill becomes more reliable and less likely to diverge.

**3. The review flow does `git merge` from the client side -- this is dangerous.**

```markdown
6. On **Approve**:
   - Run `git merge origin/<branch> --ff-only`
```

The client runs on the user's laptop. The user's working tree may have uncommitted changes, be on a different branch, or have a dirty index. Running `git merge` in this context can produce unexpected results.

Worse: if the merge isn't fast-forward (because the user pushed to main while Ralph was working), it fails. The skill says to "warn the user" but doesn't handle the common case of merge conflicts.

**Fix:** The approve operation should be a single atomic command that handles all edge cases:
```bash
ralph review task-013 --approve
```

Under the hood:
1. Stash any local changes
2. Fetch + checkout main + fast-forward
3. Merge the task branch (fail clearly if conflicts)
4. Move the task file
5. Commit + push
6. Unstash local changes

This is too complex for a skill prompt to get right consistently. The CLI handles it correctly because it's code, not a prompt interpretation.

**4. No mention of how the CLI discovers the node's SSH host.**

`ralph status`, `ralph logs`, `ralph trace` all need to know where the VPS is. The `config.json` has `"node": { "host": "...", "user": "ralph" }` but this config is in the project repo's `.ralph/config.json`. If the user hasn't run `ralph init project` yet, there's no config. If they have multiple projects on different nodes, which config wins?

**Fix:** The node connection info should be either:
a. In a global config `~/.ralph/config.json` (user-level, not project-level), or
b. Passed via environment variable or flag: `ralph status --host ralph-vps`

Project-level config is fine for task queue operations (which project repo to use). Node-level config is orthogonal.

**5. The `--json` flag for machine-readable output is mentioned but not specified.**

The CLI offers `--json` on several commands, but the JSON schema for each command's output isn't documented. If the programmatic API returns typed objects, the CLI `--json` output should match those types exactly.

**Fix:** Define the JSON output schema for each command (or just say "it's the serialized TypeScript interface" and point to the types file). Without this, anyone scripting against `ralph status --json` is guessing at the format.

### Score: 7/10

The three-adapter model is architecturally sound. The skill definitions are the most actionable in the set. But the heartbeat inconsistency is a real gap (the skill reads a file that doesn't exist), the skill-vs-CLI logic duplication will cause bugs, and the merge-from-client flow is too complex for a skill prompt to handle reliably.

---

## Rankings: Most to Least Operationally Sound

| Rank | Specialist | Score | Key Strength | Key Weakness |
|------|-----------|-------|-------------|-------------|
| 1 | **core-arch** | 9/10 | Cleanest hexagonal split. Docker/VPS agnosticism is explicit. "No ceremony" test prevents bloat. | `FsTaskRepository.transition()` breaks git rename tracking. |
| 2 | **observability** | 8/10 | Best research on Claude output formats. Trace design is thorough. | Traces in git will cause bloat. Stream-json for V1 is premature. |
| 3 | **onboarding** | 7/10 | Best UX flow. The "Hello, Ralph" experience is excellent. | Provisioning scripts have real gaps (known_hosts, Docker install, fabricated URLs). |
| 4 | **prompt-templates** | 7/10 | System prompt and templates are production-ready. Entry/exit criteria are well-structured. | Verification runs on node without env context. Permission mode unresolved. |
| 5 | **client-interface** | 7/10 | Three-adapter model is correct. Review experience is detailed. | Heartbeat reads a file that doesn't exist. Skills duplicate core logic. |

---

## Cross-Cutting Operational Conflicts

### Conflict 1: Where Does the Heartbeat Live?

| Agent | Location | In Git? |
|-------|---------|---------|
| **node-runtime** (me) | `/home/ralph/heartbeat.json` (outside workspace) | No |
| **observability** | `.ralph/heartbeat.json` (inside workspace, gitignored) | No |
| **client-interface** | `.ralph/status.json` (inside workspace) | Yes (reads it) |
| **consensus** | "No heartbeat commits in git" | No |

**Resolution:** Two separate files serving different purposes:

1. **`/home/ralph/heartbeat.json`** (disk only, updated every poll cycle): Real-time orchestrator health. Read via SSH. Contains: state, active_task, uptime, PID.

2. **`.ralph/status.json`** (git-committed, updated on state transitions only): Last-known state for the client. Contains: last_active_task, last_completed_task, total_completed, total_failed, last_transition_at. Committed as part of the claim/complete/fail commits. 2-4 updates per task, not per poll cycle.

The client reads `status.json` from git. The admin reads `heartbeat.json` via SSH. No spam, no missing files.

### Conflict 2: Where Do Traces Live?

| Agent | Location | In Git? |
|-------|---------|---------|
| **observability** | `.ralph/traces/<task-id>.json` | Yes |
| **node-runtime** (me) | Not explicitly defined | -- |

**Resolution:** Summary in git, full trace on disk.

When a task completes, the orchestrator:
1. Writes the full trace to `/home/ralph/traces/<task-id>.json` (disk only)
2. Adds summary fields to the task's frontmatter (in git): `cost_usd`, `turns`, `duration_s`, `tool_call_count`, `attempt`
3. Appends a summary line to `.ralph/traces/index.jsonl` (in git, one line per task)

The index JSONL is small (100 bytes per task = 100 KB for 1000 tasks). The full traces stay on disk (5-20 KB each, read via SSH or `ralph trace <id>` which SSHes in).

### Conflict 3: Task Repository Does File Ops, But Git Does the Move

| Agent | Who moves the file? |
|-------|-------------------|
| **core-arch** | `FsTaskRepository.transition()` does `writeFile` + `unlink`. Orchestrator does `git mv` separately. |
| **node-runtime** (me) | Orchestrator does `git mv` (which IS the file move). |

**Resolution:** core-arch's approach is wrong for git. `git mv` is an atomic rename that preserves history. `writeFile(new) + unlink(old)` is a delete-and-create that loses history.

Correct flow:
1. `git mv .ralph/tasks/pending/task.md .ralph/tasks/active/task.md` (moves the file)
2. Write updated frontmatter to the moved file
3. `git add .ralph/tasks/active/task.md` (stage the content change)
4. `git commit`

The `TaskRepository` should have a `update(task: Task): Promise<void>` method that writes content to the file (wherever it currently is). The `SourceControl` handles moving with `git mv`. The orchestrator coordinates: move first, then update content.

### Conflict 4: How Do Skills Call the System?

| Agent | Approach |
|-------|---------|
| **client-interface** | Skills reimplement core logic (parse files, generate IDs, etc.) |
| **node-runtime** (me) | Skills should call the CLI which calls the core |

**Resolution:** Skills should call `ralph` CLI commands via Bash tool. This is cleaner, more reliable, and prevents divergence:

```markdown
## Steps
1. Run `ralph task create --title "..." --type bugfix --json`
2. Parse the JSON output
3. Present to user
```

The CLI is the single source of truth for all operations. Skills are thin presentation wrappers.

---

## Proposed Fixes Summary

| # | Issue | Fix | Affects |
|---|-------|-----|---------|
| 1 | Heartbeat location inconsistency | Two files: disk heartbeat + git status.json on transitions | All agents |
| 2 | Traces in git = bloat | Summary in git, full traces on disk | observability, core-arch |
| 3 | TaskRepository breaks git rename tracking | Let git mv handle moves, repository only writes content | core-arch |
| 4 | known_hosts not in onboarding | Add ssh-keyscan to init script | onboarding |
| 5 | Skills duplicate core logic | Skills call CLI via Bash | client-interface |
| 6 | Verification commands lack env context | Add verify.env to config | prompt-templates |
| 7 | custom_check is a security hole | Remove for V1 or sandbox | prompt-templates |
| 8 | Permission mode (skip-all vs allowed-tools) not configurable | Add execution.permission_mode to config | prompt-templates, core-arch |
| 9 | Stream-json premature for V1 | Start with plain json output | observability |
| 10 | Docker install scripted in onboarding | Require pre-installed Docker, don't script installation | onboarding |
| 11 | Review merge from client is fragile | Use CLI command, not skill prompt | client-interface |
| 12 | Consistency check reads all task dirs every loop | Skip done/failed, or run only at startup + after transitions | core-arch |
