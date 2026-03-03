# Phase 2: Cross-Review from Client/UX Perspective

> **client-interface** | Critique, synthesis, and conflict resolution
> **Date**: 2026-03-03

---

## 1. Document-by-Document Critique

### onboarding.md -- First Run Experience

**What's good:**

- The split between `ralph init node` and `ralph init project` is exactly right. One node serves many projects. This matches my CLI command hierarchy perfectly -- `ralph init` branches into `ralph init project` and `ralph init node`.
- `ralph hello` is a masterpiece of onboarding UX. One command, the user watches a task go through the entire lifecycle, and they understand the system. This is the kind of thing that turns skeptics into users.
- Project type auto-detection (reading `package.json`, `Cargo.toml`, etc.) is thoughtful. The user shouldn't have to tell Ralph what test runner they use.
- The `ralph doctor --fix` pattern is brilliant. Don't just diagnose -- offer to fix. This saves the user from a context switch into Stack Overflow.
- Failure taxonomy is thorough. Every common failure mode has a named cause and a fix. This is the kind of documentation that prevents 90% of support questions.

**Where the client UX breaks down:**

1. **`ralph init node --docker` asks for interactive input on the VPS during step 4.** The user has to go to GitHub, add a deploy key, then come back and press Enter. That's a context switch FROM the terminal TO a browser TO the terminal. My CLI should open the browser URL automatically (`open https://github.com/.../settings/keys` on macOS) and provide the public key on the clipboard if possible. Reduce friction.

2. **The config.json schema has diverged.** Onboarding's config.json puts node info in `project.node.host` and `project.node.user`. My deep-dive puts it in `node.id` at the top level and doesn't store SSH host info in the config at all (it's in the CLI's own state). We need to reconcile: should the project config know about the node's SSH details? I say NO -- the project config is committed to git and SSH host info is deployment-specific. Node connection details belong in the CLI's local config (`~/.ralph/nodes.json` or similar), not in the project.

3. **No mention of what happens when `ralph init project` is run in a project that already has `.ralph/`.** Idempotency is claimed but not specified. My CLI's `ralph init` should detect existing `.ralph/` and either skip, update, or error with a message. The onboarding doc doesn't address this.

4. **The `ralph hello` command does something my CLI design doesn't have: real-time progress polling.** My CLI `ralph status` is a one-shot check. But `ralph hello` shows a progress bar that actively waits for the node to pick up and complete the task. This is a special case -- a blocking command with polling -- that doesn't exist in my other commands. I should add this as a `--wait` flag or make it specific to `ralph hello`. It's too good to cut.

5. **`ralph doctor` is described in both onboarding.md and my deep-dive, but with different check lists.** Onboarding checks SSH connectivity, Docker status, and API key validity (remote checks). My doctor checks `.ralph/` directory structure, git config, and skill installation (local checks). We need BOTH. The doctor should have two modes: `ralph doctor` (local project checks) and `ralph doctor --node` (remote node checks).

**Score: 8/10.** The best onboarding design I've seen for a developer tool. Two weaknesses: interactive steps during setup, and config schema mismatch.

---

### observability.md -- Metrics & Introspection

**What's good:**

- The decision to use `stream-json` for execution (with fallback to plain `json`) is correct. Tool call tracking is too valuable to skip. My CLI's `ralph trace` command is useless without per-tool breakdowns.
- Execution trace design is thorough and well-structured. The `ExecutionTrace` interface gives me everything I need for `ralph trace`, `ralph costs`, and `ralph review` display.
- The trace index (`index.jsonl`) is smart -- avoids scanning every trace file for aggregate queries. My `ralph costs` implementation can just parse this index.
- The `ObservabilityPort` with composite adapter pattern is elegant. One `emit()` call, multiple consumers. This is hexagonal done right.
- The "Dashboard Without a Dashboard" philosophy matches my approach exactly: CLI commands ARE the dashboard. No Grafana, no web UI, just well-formatted terminal output.
- Anomaly detection with statistical thresholds (3x average) is useful for review -- my `ralph review` can surface "this task cost 3x the average for its type" warnings.

**Where the client UX breaks down:**

1. **The heartbeat is on disk only, NOT in git.** This is correct for the node, but it means my `ralph status` command can ONLY see what's been pushed to git. If the node is mid-task, the client sees the last `status.json` update (which might be "idle" from before the task was claimed). The real-time gap is acknowledged but not solved.

   **My proposed fix:** The node should update `status.json` in git at two points: (a) when claiming a task (pushed with the claim commit), and (b) when completing a task (pushed with the result commit). The heartbeat stays on disk. `status.json` is NOT a heartbeat -- it's a state snapshot that changes on transitions only. This gives my `ralph status` enough information without polluting git with frequent updates.

2. **The `ralph analytics` command described in observability.md is more ambitious than what I designed.** Their version includes cost distribution (min/median/mean/P90/max), success rates by type, and tuning recommendations. My `ralph costs` is simpler. I should adopt their analytics design -- it's genuinely useful and the data is already in the trace index.

3. **Obsidian integration is mentioned as V2 but the hook is vague.** The user uses Obsidian. A `ralph report --format obsidian` that outputs a Markdown table is trivial to implement and would be a crowd-pleaser. But it should NOT be in V1 scope. File this for V2 alongside HTML reports.

4. **The observability doc defines `DomainEvent` types that overlap with but don't match the core-arch doc's approach.** Observability has `execution.tool_called`, `execution.turn_completed`, etc. Core-arch has a `Logger` port with `info/warn/error`. These need to be reconciled -- either the Logger port is sufficient (observability's position is "no"), or we add the ObservabilityPort (core-arch's position is "premature"). I side with observability here: domain events are richer than log levels and enable the composite adapter pattern.

5. **No mention of how the client READS traces when they're committed to git.** The trace file is written by the node and committed. When I run `ralph trace task-013`, I need to `git pull` first to get the latest trace. This is fine but should be explicit: every read command starts with a pull. My deep-dive covers this; observability's doesn't.

**Score: 9/10.** The strongest technical document. Excellent data model, clean architecture, practical feature set. Loses one point for the real-time status gap and for not addressing client access patterns thoroughly.

---

### core-arch.md -- Hexagonal Architecture & Domain Design

**What's good:**

- The "pure core" principle is correct and well-executed. Core functions take data in, return data out, no side effects. This is exactly what the client needs -- my `RalphClientPort` calls the same pure functions.
- The port designs are minimal and focused. `TaskRepository`, `SourceControl`, `AgentExecutor`, `Verifier`, `Logger` -- five ports, each with a narrow interface. No bloat.
- The explicit decision NOT to create certain ports (`Clock`, `EventEmitter`, `TemplateLoader`, `ConfigLoader`, `Notifier`) with clear reasoning for each is refreshing. "If a port would have exactly one method called exactly once, it's not a port -- it's a function call." Correct.
- The state machine with guards (`transitionTask`) is exactly what my client needs for the review workflow. When I approve a task, I call `transitionTask(task, 'done', ctx)` -- same function, different adapter.
- Mock executor design enables testing the full orchestrator loop without Claude. My CLI tests can use the same mock.

**Where the client UX breaks down:**

1. **The hexagonal architecture is designed entirely for the NODE side.** The `TaskRepository`, `SourceControl`, `AgentExecutor`, `Verifier` ports are all orchestrator concerns. There is NO port for the client. My deep-dive defines a `RalphClientPort` and `GitPort` on the client side, but core-arch doesn't acknowledge that the client exists as a hexagonal system too.

   **My proposed fix:** The core domain should be shared between node and client. The `Task` entity, `TaskStatus`, `transitionTask()`, `pickNextTask()`, `checkConsistency()` -- all of these are used by BOTH sides. The ports differ: the node has `AgentExecutor` and `Verifier`, the client has `ReviewPort` and `StatusPort`. But the core is shared.

   Proposed structure:
   ```
   src/
     core/           # Shared: types, state machine, task queue, consistency
     node/           # Node-specific: orchestrator loop, execution, verification
       ports/
       adapters/
     client/         # Client-specific: task creation, review, status
       ports/
       adapters/
         cli/        # CLI adapter
         skill/      # Skill adapter (generated SKILL.md files)
   ```

2. **The `Task` entity has 15 fields, including `assignedTo`, `dependsOn`, `retryCount`, `maxRetries`, `tags`, `needsReview`.** From the user's perspective, they shouldn't know most of these exist when creating a task. The consensus was 6 user-facing fields. Core-arch's `Task` entity mixes user-facing fields with system-managed fields. This is fine for the domain model, but the client API should expose a `TaskCreateOptions` that only includes user-facing fields, and the core fills in defaults.

3. **The `FsTaskRepository.transition()` does `unlink(fromPath)` and `writeFile(toPath)` -- but NOT `git mv`.** The orchestrator coordinates between `TaskRepository` and `SourceControl`. On the client side, this same coordination is needed for `ralph review --approve` (which does `git mv` + `git merge`). The orchestrator pattern for coordination should be documented as a reusable pattern, not just inline in the orchestrator loop. Otherwise, the client has to reinvent this coordination.

4. **`SourceControl.pull()` uses `git pull --rebase`.** My client uses `git pull --ff-only`. These are different strategies with different failure modes. Rebase rewrites history; ff-only refuses to merge if there's divergence. For the client (user's working tree), ff-only is safer. For the node (dedicated workspace), rebase is fine. The port should make this configurable, or we should agree on one strategy.

5. **No `SourceControl.diff()` or `SourceControl.merge()` method.** The client needs both for the review workflow. `git diff main...ralph/<task-id>` for showing changes, `git merge ralph/<task-id>` for approving. Core-arch's `SourceControl` port needs to be extended for client use, or the client defines its own extended port.

**Score: 8/10.** Excellent architecture for the node. Needs expansion to acknowledge the client as a first-class citizen. The shared core is the missing piece.

---

### prompt-templates.md -- Templates & Entry/Exit Criteria

**What's good:**

- The system prompt (`ralph-system.md`) is under 80 lines with a clear justification for each rule. No bloat. The "stuck" protocol (rules 14-17, writing `RALPH-STUCK.md`) is clever -- it turns a failure into useful feedback.
- Starting with one default template and adding specializations only when data shows benefit is the right approach. The template inventory (default, bugfix, feature, refactor, research) is reasonable for V1 as long as only default is required.
- Entry criteria validation is clear: `id`, `type`, `title`, `acceptance_criteria` are required. Everything else has defaults.
- The prompt construction pipeline is a pure function. Input: task + config. Output: prompt string + CLI args. No side effects. This matches core-arch's philosophy.
- Tool profiles per task type (`readonly` for research, `standard` for everything else) are a smart security posture.

**Where the client UX breaks down:**

1. **`acceptance_criteria` is REQUIRED.** This is the biggest UX conflict with my client design. When a user types `/ralph-task "fix the login bug"`, they want a task created quickly. If `acceptance_criteria` is mandatory, the skill must either (a) ask the user for criteria before creating the task, or (b) infer criteria from the description.

   Option (b) is what my `/ralph-task` skill does -- it reads the codebase and generates criteria. But this adds latency and non-determinism. Option (a) adds friction.

   **My proposed fix:** Make `acceptance_criteria` recommended but not strictly required at the entry criteria level. If missing, the prompt builder should inject a generic criterion: "The described change works correctly and all tests pass." The node logs a warning but doesn't skip the task. This way, quick-and-dirty task creation works, while well-specified tasks get better results.

2. **`type` is REQUIRED with a fixed enum: `bugfix | feature | refactor | research | test | chore`.** My CLI's `ralph task create` needs to either require `--type` (friction) or infer it from the description (non-deterministic). And the skill does inference naturally. But what if the user just writes a description that doesn't clearly map to a type?

   **My proposed fix:** Default `type` to `"default"` (which uses the default template). The user can optionally specify a type for better prompt specialization, but omitting it is fine. The entry criteria validator should accept `"default"` as a valid type.

3. **The template variables include `{{test_command}}`, `{{build_command}}`, `{{lint_command}}` from config.json.** My `ralph init project` auto-detects these. But what if the user hasn't run `ralph init project` yet and creates a task manually? The prompt builder should handle missing commands gracefully (substitute a comment like `# no test command configured`), which the doc does. Good.

4. **Per-type exit criteria overrides add a config section I hadn't considered.** My `ralph init project` generates a basic `config.json` but doesn't include `exit_criteria.per_type_overrides`. This should be added to the init template so users know it's configurable.

5. **The `custom_check` entry criterion (a script that runs before task pickup) is a nice escape hatch but complicates the client.** If I run `ralph task list`, should it show tasks that would fail the custom check? Probably yes -- the list should show all tasks, and the custom check is the node's concern, not the client's. But then `ralph status` should indicate "3 pending tasks (1 not eligible: custom check)." This is a display concern I need to handle.

**Score: 8/10.** Solid template design with the right philosophy (start simple, specialize later). The required `acceptance_criteria` and required `type` are the main UX friction points.

---

### node-runtime.md -- Docker, Bare VPS, Beyond

**What's good:**

- "Docker is an adapter, not the architecture" is the right framing. The orchestrator is environment-agnostic. The Dockerfile is packaging.
- The runtime contract table is a spec sheet for `ralph doctor`. Every requirement, why it's needed, how to check it. This is directly consumable by my doctor implementation.
- The doctor implementation (`runDoctor()`) with `Check[]` array is clean and extensible. My CLI can share this code: `ralph doctor` on the client runs the local checks, `ralph doctor --node` SSHes in and runs the same checks remotely.
- The Docker Compose multi-container setup for multiple projects is well-designed. Each orchestrator gets its own workspace and log volume.
- Graceful shutdown handling per phase is thorough. Kill Claude mid-execution, return task to pending. Wait for push to finish.

**Where the client UX breaks down:**

1. **The heartbeat file is on disk only, NOT accessible to the client without SSH.** `ralph status` on the client can see git-committed data (task directories, status.json, traces). But the heartbeat -- which has the richest real-time information (current cost, turns so far, tool calls so far) -- is only on the VPS filesystem.

   **My proposed fix (same as observability section):** The git-committed `status.json` should be updated at state transitions (claiming a task, completing a task). It's NOT a heartbeat -- it's a state snapshot. The heartbeat stays on disk for Docker HEALTHCHECK and SSH debugging. The client reads `status.json` for "what's the last known state?" and checks the heartbeat only when SSH access is available (e.g., `ralph doctor --node` or `ralph logs`).

2. **The `.env.example` file lists orchestrator-specific variables (`POLL_INTERVAL`, `MAX_TASK_TIMEOUT`, `LOG_LEVEL`, `CLAUDE_MODEL`, `CLAUDE_MAX_TURNS`, `CLAUDE_MAX_BUDGET`).** But these same settings are also in `.ralph/config.json` (per the onboarding and prompt-templates docs). There's a conflict: where does the node's poll interval come from? `.env` or `config.json`? Environment variables should override config file values, but this needs to be documented and consistent. My `ralph init node` generates the `.env`; my `ralph init project` generates the `config.json`. They shouldn't duplicate configuration.

   **My proposed fix:** `.env` holds SECRETS and DEPLOYMENT-SPECIFIC values only: `ANTHROPIC_API_KEY`, `TASK_REPO_URL`, `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`. Everything else (poll interval, model, turns, budget) goes in `.ralph/config.json` because it's per-project and should be version-controlled. Environment variables can override config values for one-off testing, but the config file is the source of truth.

3. **The `setup-vps.sh` script is bare-metal, not wrapped in `ralph init node --bare`.** My onboarding design has `ralph init node` running FROM the user's laptop, SSHing into the VPS, and executing the setup. Node-runtime's `setup-vps.sh` runs ON the VPS after the user SSHes in manually. These are two different UX paradigms. Running from the laptop is better -- the user stays in their local terminal the whole time.

4. **Log access requires SSH.** `ssh vps 'docker compose logs -f ralph'` is fine for debugging but it's a context switch. My `ralph logs` command should proxy this -- `ralph logs` SSHes in, streams logs, and pipes them to the user's terminal. One command, no manual SSH.

5. **No mention of `ralph update node`.** Node-runtime describes manual update procedures (`git pull && bun install && systemctl restart`). My CLI should have `ralph update node` that does this over SSH. The onboarding doc suggests this too.

**Score: 7/10.** Solid infrastructure design. Loses points for the status data accessibility gap and for not wrapping operations in CLI commands (expecting SSH instead).

---

## 2. Agent Rankings

### Who Designed for the USER?

| Rank | Agent | User Focus | Technical Quality | Client Compatibility | Notes |
|------|-------|-----------|-------------------|---------------------|-------|
| 1 | **observability** | 8/10 | 9/10 | 9/10 | Best data model. Trace design is directly consumable by CLI. Domain events enable future expansion. |
| 2 | **onboarding** | 9/10 | 8/10 | 8/10 | Best UX thinking. `ralph hello` is brilliant. Config schema mismatch and interactive steps are the weak spots. |
| 3 | **core-arch** | 5/10 | 9/10 | 6/10 | Best architecture. But it's node-only. The client is invisible. Shared core is the missing piece. |
| 4 | **prompt-templates** | 6/10 | 8/10 | 7/10 | Good template design. Required `acceptance_criteria` and `type` create friction for quick task creation. |
| 5 | **node-runtime** | 4/10 | 8/10 | 5/10 | Good infrastructure. But everything requires SSH. The client can't see the heartbeat, can't stream logs, can't update the node without manual SSH. |

### The Core Tension

**Observability** and **onboarding** designed with the user's laptop workflow in mind. They ask: "What does the user see? What do they type?"

**Core-arch** and **node-runtime** designed for the system's internals. They ask: "How does the code work? How is the process managed?"

**Prompt-templates** sits in the middle -- it affects both the node's behavior AND the user's task creation experience.

The client interface bridges this gap. Every internal design decision eventually surfaces in a command the user types or a display the user reads.

---

## 3. Identified UX Conflicts

### Conflict 1: Config Schema Disagreement

| Doc | Config Location | Contents |
|-----|----------------|----------|
| onboarding | `.ralph/config.json` | project name, repo URL, test/build/lint commands, node host/user, task defaults |
| prompt-templates | `.ralph/config.json` | verify commands, exit criteria, entry criteria, tool profiles, template dir |
| node-runtime | `.env` | API key, repo URL, git identity, poll interval, timeout, log level, model, turns, budget |
| core-arch | loaded at startup, shape not specified | Not addressed in detail |
| client-interface | `.ralph/config.json` | node ID, poll interval, model, budget, client defaults, git branch prefix |

**The Problem:** Five documents, five different schemas. Some settings appear in BOTH `.env` and `config.json`. The user doesn't know where to change the model or budget.

**Resolution:**

`.env` (not committed, node-only):
```
ANTHROPIC_API_KEY=sk-ant-...
TASK_REPO_URL=git@github.com:user/project.git
GIT_AUTHOR_NAME=Ralph
GIT_AUTHOR_EMAIL=ralph@helico.dev
```

`.ralph/config.json` (committed, per-project):
```json
{
  "version": 1,
  "project": {
    "name": "my-project"
  },
  "verify": {
    "test": "bun test",
    "build": "bun run build",
    "lint": "bun run lint"
  },
  "task_defaults": {
    "max_retries": 2,
    "model": "opus",
    "max_turns": 50,
    "max_budget_usd": 5.0,
    "timeout_seconds": 1800
  },
  "entry_criteria": {
    "require_tags": [],
    "exclude_tags": []
  },
  "exit_criteria": {
    "require_tests": true,
    "require_build": false,
    "require_lint": false
  },
  "git": {
    "main_branch": "main",
    "branch_prefix": "ralph/"
  },
  "client": {
    "default_priority": "normal",
    "default_type": "feature"
  }
}
```

Rule: `.env` holds secrets and deployment identity. `config.json` holds everything else. Environment variables override `config.json` for one-off testing only.

---

### Conflict 2: Required Fields for Task Creation

| Doc | Required User Fields | System-Managed Fields |
|-----|---------------------|----------------------|
| prompt-templates | `id`, `type`, `title`, `acceptance_criteria` (all required) | everything else |
| core-arch | `id`, `title`, `status` (required for parsing) | 12 other fields with defaults |
| onboarding | `id`, `title`, `status`, `priority`, `created` (shown in init project) | not specified |
| client-interface | `title`, `description` (minimum for CLI) | `id`, `type`, `priority`, `status`, `created`, `author` |

**The Problem:** The user must provide `acceptance_criteria` for the prompt system to work. But the user might just type `ralph task create "fix the login bug"`. No criteria, no type, just a description.

**Resolution:**

Minimum required by user: **title** (or a description that becomes the title).

Generated by the system:
- `id`: auto-incremented
- `status`: always `pending`
- `priority`: default `normal`
- `type`: default `default` (or inferred by skill)
- `created`: current timestamp
- `author`: git user.name

Recommended but not required:
- `acceptance_criteria`: if missing, the default template injects "The described change works correctly and all tests pass"
- `files`: if missing, agent determines scope
- `constraints`: if missing, no additional constraints

The prompt-templates entry criteria should accept tasks WITHOUT `acceptance_criteria` -- log a warning, use the fallback criterion, but don't skip the task. This preserves quick task creation while encouraging thorough specifications.

---

### Conflict 3: Status Data Accessibility

| Doc | What the client can see | How |
|-----|------------------------|-----|
| observability | Traces, trace index, task dirs | git pull + read files |
| node-runtime | Heartbeat (real-time) | SSH only |
| core-arch | Task entities via TaskRepository | code |
| onboarding | status.json via git | git pull |

**The Problem:** The richest real-time data (heartbeat: current cost, turns, tool calls) is locked behind SSH. The client's `ralph status` can only show git-committed state.

**Resolution:**

Two tiers of status:

1. **Git-committed status** (`status.json`, updated on state transitions):
   - Node state: idle/working
   - Current task ID + title (if working)
   - Started at (if working)
   - Tasks completed/failed today
   - Last transition timestamp

2. **SSH-accessible heartbeat** (disk-only, updated every 30s):
   - Real-time cost, turns, tool calls
   - Detailed execution phase
   - PID, uptime

`ralph status` reads tier 1 (fast, no SSH needed).
`ralph status --live` reads tier 2 (requires SSH to node, richer data).
`ralph doctor --node` reads tier 2 for health checks.

This means `ralph status` is always available (just a `git pull` + file read), while `ralph status --live` is optional and requires node SSH access to be configured.

---

### Conflict 4: Doctor Scope

| Doc | What doctor checks |
|-----|--------------------|
| onboarding | Local env + SSH connection + Docker status + git access + API key + task queue |
| node-runtime | Runtime contract: git, bun, claude CLI, API key, network |
| client-interface | .ralph/ structure, git config, skill installation |

**Resolution:**

```
ralph doctor              # Local project checks (fast, no SSH)
                          # - .ralph/ exists and is valid
                          # - Git repo configured with remote
                          # - Skills installed
                          # - .gitkeep files present
                          # - No uncommitted .ralph/ changes

ralph doctor --node       # Remote node checks (requires SSH)
                          # - SSH connectivity
                          # - Docker/service running
                          # - Runtime contract (git, bun, claude)
                          # - API key valid
                          # - Git access from node
                          # - Disk space, memory

ralph doctor --fix <issue> # Auto-fix known issues
```

All three docs' checks are valid. They just run in different contexts.

---

### Conflict 5: Observability Port vs Logger Port

| Doc | Approach |
|-----|----------|
| observability | `ObservabilityPort` with `emit(DomainEvent)`, composite adapter (trace writer + heartbeat writer) |
| core-arch | `Logger` port with `info/warn/error`, simple console adapter, explicitly rejected EventEmitter as premature |

**The Problem:** Two different models for the same concern. The Logger is simpler but can't power tool call tracking or anomaly detection. The ObservabilityPort is richer but core-arch called it premature.

**Resolution:** The ObservabilityPort wins. The Logger port is a subset of what we need. Tool call tracking, trace writing, and heartbeat updating are all observability concerns that don't fit into `info/warn/error` log levels. The `Logger` can be one adapter of the `ObservabilityPort` (the one that formats events as log lines).

However, core-arch's concern about premature complexity is valid. For V1, the composite adapter has exactly two consumers: `TraceWriterAdapter` and `ConsoleLogAdapter`. That's reasonable. Don't add more until needed.

---

### Conflict 6: `SourceControl` Port Scope

| Doc | Methods on SourceControl |
|-----|--------------------------|
| core-arch | `pull`, `commit`, `push`, `pushBranch`, `createBranch`, `checkout`, `stageFiles`, `stageTracked`, `changedFiles` |
| client-interface | all of the above + `diff`, `merge`, `deleteBranch`, `fetch`, `status` |

**The Problem:** The node's `SourceControl` port doesn't include `diff()`, `merge()`, or `deleteBranch()`, which the client needs for the review workflow.

**Resolution:** Extend the port for client use:

```typescript
interface SourceControl {
  // Existing (node + client)
  pull(options?: { ffOnly?: boolean }): Promise<void>;
  commit(message: string): Promise<string>;
  push(): Promise<boolean>;
  pushBranch(branch: string): Promise<boolean>;
  createBranch(name: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  stageFiles(paths: string[]): Promise<void>;

  // Added for client
  fetch(): Promise<void>;
  diff(spec: string): Promise<string>;
  diffStats(spec: string): Promise<DiffStats>;
  merge(branch: string, options?: { noFf?: boolean }): Promise<void>;
  deleteBranch(name: string, options?: { remote?: boolean }): Promise<void>;
  status(): Promise<GitStatus>;
}
```

The node adapter ignores methods it doesn't use. The client adapter uses all of them. Same interface, different usage patterns. No need for separate ports.

---

## 4. Proposed Fixes for Each Document

| Doc | Fix | Priority | Effort |
|-----|-----|----------|--------|
| **onboarding** | Split config: `.env` for secrets, `config.json` for everything else | High | Low |
| **onboarding** | Make `ralph init project` idempotent (detect existing `.ralph/`) | Medium | Low |
| **onboarding** | Add `--wait` flag concept from `ralph hello` to CLI design | Medium | Medium |
| **onboarding** | Open browser URL during deploy key step | Low | Low |
| **observability** | Document client access patterns (pull before read) | Medium | Low |
| **observability** | Align `DomainEvent` types with core-arch's Logger (subsume it) | High | Medium |
| **observability** | Define `status.json` as transition-only (not heartbeat) | High | Low |
| **core-arch** | Acknowledge client as hexagonal system, shared core | High | Medium |
| **core-arch** | Extend `SourceControl` port with `diff`, `merge`, `deleteBranch` | High | Low |
| **core-arch** | Replace `Logger` port with `ObservabilityPort` from observability doc | Medium | Medium |
| **core-arch** | Document `Task` entity's user-facing vs system-managed field split | Medium | Low |
| **prompt-templates** | Make `acceptance_criteria` recommended, not required for entry | High | Low |
| **prompt-templates** | Accept `"default"` as a valid task type | Medium | Low |
| **prompt-templates** | Add config section for per-type overrides in `ralph init project` template | Low | Low |
| **node-runtime** | Wrap VPS operations in CLI commands (`ralph logs`, `ralph update node`) | High | Medium |
| **node-runtime** | Remove orchestrator settings from `.env`, keep in `config.json` | High | Low |
| **node-runtime** | Make heartbeat accessible via `ralph status --live` (SSH proxy) | Medium | Medium |

---

## 5. Shared Core Proposal

The biggest architectural gap across all documents is the lack of a shared core between node and client. Here's the structure:

```
src/
  core/                          # SHARED between node and client
    types.ts                     # Task, TaskStatus, Priority, ExecutionTrace, etc.
    state-machine.ts             # transitionTask(), TRANSITIONS map
    task-queue.ts                # pickNextTask() -- node uses this; client uses listTasks()
    consistency.ts               # checkConsistency()
    prompt-builder.ts            # buildPrompt() -- node-only in V1, but still core
    errors.ts                    # RalphError, InvalidTransitionError, etc.

  ports/                         # SHARED interfaces
    task-repository.ts           # TaskRepository
    source-control.ts            # SourceControl (extended for client)
    observability.ts             # ObservabilityPort + DomainEvent types

  node/                          # NODE-SPECIFIC
    ports/
      agent-executor.ts          # AgentExecutor
      verifier.ts                # Verifier
    adapters/
      claude-cli-executor.ts
      shell-verifier.ts
      fs-task-repository.ts
      git-source-control.ts
      trace-writer.ts
      heartbeat-writer.ts
    orchestrator.ts              # Main loop
    doctor.ts                    # Runtime contract checks

  client/                        # CLIENT-SPECIFIC
    core.ts                      # RalphClientPort implementation
    ports/
      (none in V1 -- uses shared ports)
    adapters/
      cli/
        index.ts                 # CLI entrypoint
        parse-args.ts
        handlers/                # One per command
        formatters/              # Terminal output formatting
      skill/                     # Generated SKILL.md content (build step)
    doctor.ts                    # Local project checks
```

The `core/` directory is imported by both `node/` and `client/`. The `ports/` directory defines shared interfaces. The adapters are specific to each side.

This means:
- `ralph task create` (client) and the node's claim logic both use `transitionTask()`
- `ralph review --approve` (client) and the node's move-to-review logic both use `transitionTask()`
- Both sides parse task files with the same parser
- Both sides use the same `SourceControl` interface (different adapters: client uses ff-only pull, node uses rebase pull)

---

## 6. Summary

The five deep-dive documents are individually strong but collectively have gaps. The main themes:

1. **Config schema must be unified.** One schema, documented once, used everywhere.
2. **The client is a first-class citizen,** not an afterthought. Core-arch needs to acknowledge it.
3. **Required fields for task creation should be minimal.** Don't gatekeep task creation with mandatory `acceptance_criteria` and `type`.
4. **Status data has a real-time gap.** Solve it with transition-only `status.json` + optional SSH live status.
5. **ObservabilityPort subsumes Logger.** Domain events are richer than log levels.
6. **Node operations should be wrapped in CLI commands.** The user should never need to SSH for routine operations.

The system is well-designed. These are integration-level issues, not fundamental flaws. The architecture is sound; the seams between components need alignment.
