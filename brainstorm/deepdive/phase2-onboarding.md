# Phase 2: Cross-Review from the Onboarding Lens

> By **onboarding** | 2026-03-03
>
> Reviewing: core-arch.md, observability.md, prompt-templates.md, client-interface.md, node-runtime.md

---

## Agent Rankings

| Rank | Agent | Score | Rationale |
|------|-------|-------|-----------|
| 1 | **core-arch** | 9/10 | The most disciplined document in the set. The "No Ceremony" test is exactly the right filter. Every abstraction is justified. The dependency rule is clear. The module structure is flat (~20 files). Most importantly, the design doesn't create barriers for a new user -- it's all internal structure that the user never touches. One deduction: the `FsTaskRepository` has a subtle complexity with snake_case/camelCase field normalization that will confuse contributors. |
| 2 | **node-runtime** | 8.5/10 | Strong alignment with onboarding needs. The runtime contract table is exactly what `ralph doctor` checks against. The Docker adapter is well-designed (SSH key copy trick, known_hosts pre-population, doctor-before-start). The bare VPS setup script is solid. Minor: Claude Code installation via `bun install -g @anthropic-ai/claude-code@latest` is outdated -- the native installer is now preferred. |
| 3 | **client-interface** | 8/10 | The best document for understanding the user's day-to-day interaction. The skill designs are thorough and practical. The review experience (skill vs CLI vs programmatic) is well-thought-out. Deductions: the `ralph init` implementation doesn't mention node provisioning (only local project init), and the doctor checks are project-local only (no remote node checks). There's a gap between what onboarding needs and what client-interface provides. |
| 4 | **observability** | 7.5/10 | Technically excellent. The trace design, cost tracking, and tuning recommendations are all well-reasoned. However, this document is overwhelmingly optimized for the power user who has 20+ completed tasks. A new user running their first task will see... nothing useful. The first-run observability experience is completely unaddressed. Also, the `ObservabilityPort` conflicts with core-arch's explicit decision to cut `EventEmitter`. |
| 5 | **prompt-templates** | 7/10 | Solid prompt engineering content. The system prompt is well-constrained (~80 lines). Template interpolation is simple. But the onboarding burden is real: the user needs to understand task types, which template applies, what variables are available, how acceptance criteria are injected. The "default" template as fallback is good, but the document doesn't explain how a new user would know to create additional templates or when they'd need to. |

---

## Where Users Will Get Stuck (That Others Haven't Considered)

### 1. The Gap Between `ralph init project` and First Task Execution

Every document assumes the node is already running. None of them address the moment where the user has run `ralph init project`, committed and pushed, and... nothing happens. The node isn't watching this repo yet.

**client-interface** creates `.ralph/` locally. **node-runtime** expects `TASK_REPO_URL` in the environment. But there's no bridge -- nothing tells the node "hey, there's a new project to watch."

For V1 (single project per node), the gap is smaller: set `TASK_REPO_URL` once during node setup. But nobody documents this handshake.

**Fix**: `ralph init project` should:
1. Check if a node is configured in `.ralph/config.json`
2. If not, prompt: "No node configured. Run `ralph init node` first, or enter your node's SSH host."
3. If yes, verify the node can reach this repo: `ssh ralph@node "git ls-remote <repo> HEAD"`

### 2. Task File Authoring is Too Complex for Beginners

The consensus requires YAML frontmatter with specific fields (`id`, `title`, `status`, `type`, `acceptance_criteria`). **prompt-templates** adds `files`, `constraints`, and type-specific behavior. **core-arch** requires `priority`, `createdAt`, `updatedAt`, `dependsOn`, `retryCount`, `maxRetries`, `tags`, `branch`, `needsReview`.

A new user sees this and thinks: "I just want to fix a bug. Why do I need 15 YAML fields?"

The `/ralph-task` skill handles this by generating the file from a description. The CLI's `ralph task create` does the same. But **if a user opens `.ralph/tasks/pending/` directly** (which they will -- it's a directory in their repo), they'll see complex YAML and either be confused or try to hand-edit it incorrectly.

**Fix**:
- The Task interface in `core/types.ts` should have exactly 5 required fields: `id`, `title`, `status`, `type`, `created_at`. Everything else optional with sensible defaults.
- `ralph task create --title "Fix the bug"` should work with just a title. No type, no acceptance criteria, no priority needed. Defaults to `type: default`, `priority: 100`.
- The `.ralph/tasks/pending/` directory should contain a `_TEMPLATE.md` file that shows the minimal task format.

### 3. Status Confusion: "Is It Working?"

After creating a task and pushing, the user's #1 question is: "Is the node picking this up?"

**observability** gives us traces and cost summaries -- after the task completes. **client-interface** gives us `ralph status` which reads `status.json` -- but only if the node has committed and pushed that file. **node-runtime** mentions a heartbeat file on disk -- but it's NOT in git.

The result: for the first 30-60 seconds after pushing a task, there is ZERO visible feedback. The user doesn't know if:
- The node is alive
- The node has pulled the latest
- The task has been claimed
- Something is broken

**Fix**:
- The claim commit (`ralph(<task-id>): claimed`) is the first signal. `ralph status` should check `git log origin/main --oneline -1` and look for claim commits.
- `ralph hello` (from my onboarding doc) provides this feedback loop for the very first task.
- The `ralph status` command needs a "last activity" indicator based purely on git log timestamps, not on `status.json`.

### 4. Error Messages Assume Technical Knowledge

**core-arch** defines custom error classes: `InvalidTransitionError`, `TransitionGuardError`, `TaskParseError`, `AdapterError`. These are great for debugging but terrible for users.

`TransitionGuardError: task-001: retry count 2 >= max 2, should fail instead` -- a new user has no idea what this means or what to do about it.

**Fix**: Every error that could surface to the user needs a human-readable explanation and a suggested action:
```
Error: Task task-001 has failed permanently.
  Reason: It was retried 2 times but verification kept failing.
  What to do: Check the execution trace with `ralph trace task-001`
  to see what went wrong, then create a new task.
```

### 5. Template Selection is Invisible

**prompt-templates** carefully designs templates per task type (bugfix, feature, refactor, etc.). But the user has no visibility into which template was used, what variables were injected, or what the final prompt looked like.

When a task fails and the user asks "why?", they can see the trace (turns, cost, tools) but not the PROMPT. Was the prompt bad? Were the acceptance criteria unclear? Did the template inject something weird?

**Fix**:
- Store the final rendered prompt in the trace file (`trace.renderedPrompt`).
- `ralph trace <task-id> --prompt` shows exactly what was sent to Claude.
- This is critical for debugging AND for the user to learn how to write better tasks.

### 6. The Review Flow Assumes Git Fluency

**client-interface** has the user approving tasks by merging branches. The `/ralph-review` skill runs `git merge origin/<branch> --ff-only`. The CLI shows diffs with `git diff --color`.

For a non-git-savvy user: "What's a branch? What's a merge? What does --ff-only mean?"

The skill abstracts most of this away (Claude does the git commands). The CLI is more exposed. But when something goes wrong (merge conflict, diverged branches), the error messages are pure git-speak.

**Fix**:
- The `/ralph-review` skill should handle merge conflicts gracefully: "There are conflicting changes. This usually means someone edited the same files while Ralph was working. Run `ralph review task-001 --resolve` for help."
- The CLI's review mode should never show raw git errors. Translate them.
- Document the review flow with screenshots/examples in the quick start guide.

---

## Do Hexagonal Abstractions Make Setup Harder?

**Short answer: No, not if done right. core-arch nailed it.**

The hexagonal architecture (ports & adapters) is entirely internal. The user never touches `TaskRepository`, `SourceControl`, or `AgentExecutor`. They interact with:
- `.ralph/` directory (task files, config)
- CLI commands (`ralph init`, `ralph status`, etc.)
- Skills (`/ralph-task`, `/ralph-review`)

The architecture only becomes visible when something breaks. And when something breaks, the layering actually HELPS diagnosis -- errors say "Adapter error [git.push]: rejected" rather than a raw stack trace.

**One concern**: core-arch defines 5 ports + 6 adapters + the orchestrator. That's ~20 files. For a contributor trying to understand the codebase, the indirection could be confusing. "Where does the task file actually get moved? Is it `TaskRepository.transition()`, or `SourceControl.stageFiles()`? Both?"

The answer is "both, coordinated by the orchestrator" -- which is documented but requires reading three files to understand one operation. For onboarding a contributor (not a user), a visual diagram would help.

**Verdict**: The hexagonal architecture is correct for this system. But add a single `ARCHITECTURE.md` file with a sequence diagram showing one task flowing through the system. That's the missing onboarding artifact for developers.

---

## Does the CLI Design Align with core-arch's Port Design?

### Alignment Issues

**client-interface** defines a `RalphClientPort` interface with methods like `createTask()`, `getStatus()`, `reviewTask()`. This is the right abstraction. Both the CLI and skills are adapters over this port.

But there's a mismatch:

| Operation | My onboarding doc | client-interface | core-arch |
|-----------|-------------------|-----------------|-----------|
| `ralph init project` | Creates `.ralph/`, detects project type, writes config | Creates `.ralph/`, installs skills | No mention of init |
| `ralph init node` | Provisions remote machine over SSH | Not mentioned | Not mentioned |
| `ralph doctor` | Checks local + remote (SSH to node) | Checks local only | Not mentioned |
| `ralph hello` | End-to-end first task | Not mentioned | Not mentioned |

**The problem**: Onboarding commands (`init node`, `hello`, `doctor --fix`) need to do things that no existing port supports:
- SSH into a remote machine
- Install software remotely
- Generate SSH keypairs
- Wait for a task to be claimed (polling git)

These don't fit into `RalphClientPort` because they're meta-operations about the system itself, not operations within the task lifecycle.

**Fix**: Create a separate `SetupPort` or just put these in a `src/cli/commands/setup/` directory without trying to force them through the hexagonal client core. Not everything needs to go through a port. `ralph init node` is a one-time operation run from the user's laptop -- it's setup tooling, not the core system. Trying to make it "clean" hexagonal would be ceremony.

### Overlapping Doctor Implementations

Three documents define `ralph doctor`:
1. **My onboarding doc**: Checks local + remote (SSH, Docker, API key, git access)
2. **client-interface**: Checks local only (.ralph/ structure, config, skills, gitkeep)
3. **node-runtime**: Checks runtime contract (git, bun, claude, network)

These are three DIFFERENT doctors checking three DIFFERENT things:
- Local doctor: "Is this project set up correctly?"
- Remote doctor: "Can I reach the node and is it healthy?"
- Runtime doctor: "Does this environment meet the orchestrator's requirements?"

**Fix**: One `ralph doctor` that runs all three layers in sequence:
```
$ ralph doctor

Local Project:
  [OK] .ralph/ directory structure
  [OK] config.json valid
  [OK] Skills installed (4/4)

Remote Node (ralph-vps-01):
  [OK] SSH connection
  [OK] Ralph service running
  [OK] Git access to this repo

Runtime (on node):
  [OK] git 2.43
  [OK] bun 1.1.38
  [OK] claude 2.1.0
  [OK] ANTHROPIC_API_KEY set
  [OK] Network: api.anthropic.com reachable
```

The local checks run without SSH. The remote checks require `node.host` in config (skip with a warning if not configured). The runtime checks are sent as a command over SSH.

---

## Is Observability Data Accessible Enough for a New User?

**No. Not even close.**

The observability doc is optimized for the 50th task, not the 1st. Here's what a new user experiences:

### First Task: Zero Observability

1. User creates task, pushes.
2. Waits.
3. Eventually, task moves from `pending/` to `active/`.
4. Waits more.
5. Task moves to `review/`.
6. User runs `ralph trace task-001` and sees a JSON dump.

The trace JSON is comprehensive but overwhelming. Cost, tokens, tool calls, turns -- for someone who just wants to know "did it work?", this is noise.

### What a New User Actually Needs

| Question | What they need | What we give them |
|----------|---------------|-------------------|
| "Is it working?" | A spinner or status message | Nothing until claim commit |
| "What's it doing?" | "Reading files" / "Running tests" | Nothing (heartbeat is local) |
| "Did it work?" | "Yes, tests pass, ready for review" | Task file moved to `review/` |
| "How much did it cost?" | "$0.47" | Full trace JSON |
| "What changed?" | A diff | They have to run `git diff` themselves |

### Proposed: Progressive Observability

**Level 1 (first task)**:
- `ralph status` shows: "Task task-001 is being worked on. It was claimed 2 minutes ago."
- When complete: "Task task-001 is ready for review. Cost: $0.47. Run `ralph review` to see changes."

**Level 2 (after 5 tasks)**:
- `ralph status` adds: "Today: 5 tasks, $2.30 spent. Average: $0.46/task."

**Level 3 (after 20 tasks)**:
- `ralph analytics` becomes meaningful with tuning recommendations.
- Anomaly detection starts flagging outliers.

The observability commands should be aware of how much history exists and adjust their output accordingly. Don't show "Tuning Recommendations" when there are only 3 data points.

### The Trace is Too Raw

The trace format from **observability** is a JSON file with 20+ fields. The `ralph trace` command from **client-interface** renders it nicely for the CLI. But neither document addresses what happens when the skill-based user (using `/ralph-status` inside Claude Code) asks about a trace.

The skill has to READ the JSON file and interpret it conversationally. That's a lot of trust in Claude correctly reading and summarizing a trace file. If the trace format changes, the skill's interpretation may become wrong.

**Fix**: Add a `ralph trace <task-id> --summary` flag that returns a pre-formatted, one-paragraph summary. Skills call this instead of reading raw JSON.

---

## Conflicts Between Proposals

### Conflict 1: EventEmitter vs Logger vs ObservabilityPort

| Agent | Position |
|-------|----------|
| **core-arch** | Cut `EventEmitter`. Use `Logger` port. One consumer, no fan-out needed. |
| **observability** | Introduces `ObservabilityPort` with `emit(event: DomainEvent)` and a `CompositeObservabilityAdapter` with multiple consumers (trace writer, heartbeat writer, future webhook). |

These directly contradict each other. core-arch explicitly says "only one consumer (logger), no fan-out needed" and cuts the event emitter. observability says "we need multiple consumers" and introduces an event system.

**Who's right**: observability. The trace writer and heartbeat writer ARE two consumers of execution events. A Logger that writes "task claimed" to stdout is not the same as a TraceWriter that builds a structured trace file. core-arch was correct to cut a GENERIC event bus, but underestimated the observability needs.

**Resolution**: core-arch's `Logger` port stays for structured logging. observability's `ObservabilityPort` gets renamed to `ExecutionTracer` (more specific) and handles trace + heartbeat construction. These are two separate ports, not a generic event system:

```typescript
// ports/logger.ts -- unchanged from core-arch
interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

// ports/execution-tracer.ts -- simplified from observability
interface ExecutionTracer {
  onTaskClaimed(taskId: string): void;
  onExecutionStarted(taskId: string, sessionId: string): void;
  onToolCalled(taskId: string, tool: string): void;
  onExecutionCompleted(taskId: string, result: ExecutionResult): void;
  onVerificationCompleted(taskId: string, result: VerificationResult): void;
  getTrace(taskId: string): ExecutionTrace | null;
}
```

This is more specific than a generic `emit(DomainEvent)`, which means it's easier to implement and test. It's still a port -- the adapter handles file I/O.

### Conflict 2: `status.json` Location and Behavior

| Agent | Position |
|-------|----------|
| **client-interface** | `status.json` is committed to git. Skills read it via `git pull`. |
| **observability** | Heartbeat is a local file, NOT committed to git. Consensus says no heartbeat commits. |
| **node-runtime** | Heartbeat is written by the orchestrator, checked by Docker HEALTHCHECK. |

**The confusion**: client-interface calls it `status.json` and treats it as committed state. observability calls it `heartbeat.json` and says it should NOT be committed. node-runtime calls it heartbeat and uses it for Docker health checks.

**Who's right**: observability. The consensus explicitly states "No heartbeat commits in git." But client-interface needs SOME way to know if the node is alive, and `status.json` in git is the only mechanism available without SSH.

**Resolution**: Split the concepts:
1. **heartbeat.json** -- local file on the node, updated every 30s, NOT in git. Used by Docker HEALTHCHECK and SSH-based `ralph doctor`.
2. **Last git activity** -- client-interface determines node health from the timestamp of the most recent ralph commit in `git log`. No claim commit in >5 minutes? Probably down.
3. No `status.json` in git. It creates exactly the polling/committing noise the consensus prohibited.

### Conflict 3: Claude Code Installation Method

| Agent | Position |
|-------|----------|
| **node-runtime** | `bun install -g @anthropic-ai/claude-code@latest` |
| **My onboarding doc** | `curl -fsSL https://claude.ai/install.sh \| bash` (native installer) |

**Who's right**: My doc. The npm/bun install method is deprecated. Anthropic's docs explicitly recommend the native installer, which is faster, has no Node.js dependency, and auto-updates. node-runtime's Dockerfile also uses the deprecated method.

**Resolution**: Update node-runtime's Dockerfile and VPS setup script to use the native installer:
```dockerfile
RUN curl -fsSL https://claude.ai/install.sh | bash
```

### Conflict 4: Config Location for Node Connection

| Agent | Position |
|-------|----------|
| **My onboarding doc** | `node.host` and `node.user` in `.ralph/config.json` |
| **client-interface** | No mention of node connection in config |
| **node-runtime** | `TASK_REPO_URL` as env var on the node |

None of these connect to each other. The user's laptop doesn't know where the node is. The node doesn't know which laptop to report to. They communicate exclusively through git, which is the right architecture -- but it means `ralph doctor` can't check the node without an explicit SSH config.

**Resolution**: `.ralph/config.json` includes optional `node` section. Used only by `ralph doctor` and `ralph init node`. Not used at runtime.

```json
{
  "node": {
    "host": "ralph-vps.example.com",
    "user": "ralph",
    "deploy_mode": "docker"
  }
}
```

### Conflict 5: Task Required Fields

| Agent | Position |
|-------|----------|
| **core-arch** | Task interface has 15+ fields, many "required" at parse time |
| **prompt-templates** | Requires `type` and `acceptance_criteria` for template selection |
| **client-interface** | `TaskCreateOptions` has only `title` and `description` required |

The client-interface correctly minimizes what the USER must provide. But core-arch's parser throws `TaskParseError` if `id`, `title`, or `status` are missing. And prompt-templates wants `type` and `acceptance_criteria` for meaningful prompt construction.

**Resolution**: Two levels of requirements:
1. **User provides**: `title` (required), everything else optional with defaults
2. **System generates**: `id`, `status` (always "pending"), `created_at`, `type` (defaults to "default")
3. **Parser validates**: `id`, `title`, `status` must exist in the parsed file (they will, because the creation tool generates them)

The user-facing tools (`/ralph-task`, `ralph task create`) generate the full YAML from minimal input. The parser validates the generated file. These are different validation layers for different audiences.

---

## Proposed Fixes Summary

| # | Fix | Affects | Priority |
|---|-----|---------|----------|
| 1 | `ralph init project` checks for configured node | onboarding, client-interface | High |
| 2 | Minimize required task fields to `title` only for user-facing tools | core-arch, client-interface, prompt-templates | High |
| 3 | Unified `ralph doctor` with local + remote + runtime layers | onboarding, client-interface, node-runtime | High |
| 4 | Replace EventEmitter/ObservabilityPort with specific `ExecutionTracer` port | core-arch, observability | Medium |
| 5 | Kill `status.json` in git. Use git log timestamps for node health. | client-interface, observability | Medium |
| 6 | Update Claude Code install to native installer | node-runtime | Medium |
| 7 | Store rendered prompt in trace file | observability, prompt-templates | Medium |
| 8 | Progressive observability (adjust output based on history depth) | observability | Medium |
| 9 | Add node connection config to `.ralph/config.json` | all | Medium |
| 10 | Human-readable error messages with suggested actions | core-arch | Low |
| 11 | Add `_TEMPLATE.md` to pending/ for hand-authored tasks | client-interface | Low |
| 12 | `ralph trace --summary` for skill consumption | observability, client-interface | Low |
| 13 | `ARCHITECTURE.md` with sequence diagram for contributor onboarding | core-arch | Low |

---

## Final Assessment

The five deep-dives are individually strong. The biggest risk isn't any single document being wrong -- it's that they were written in isolation and the **seams between them** are where users will fall through.

The happy path is well-designed across all documents. A user who follows every step perfectly will have a good experience. But users never follow every step perfectly, and the error paths, the "what went wrong?" diagnostics, and the "I'm stuck" escape hatches are underdeveloped.

The strongest alignment is between **core-arch** and **node-runtime** -- they clearly share the same mental model of what the system is. The weakest alignment is between **observability** and **client-interface** -- they disagree on fundamental data contracts (status.json, event systems) and neither fully addresses what a NEW user needs to see.

**If I had to cut scope**, I'd defer the entire observability system beyond basic cost-in-commit-messages and the stream-json parsing. The first 10 users will care about "does it work?" not "what's my P90 cost distribution?" Build the hello-world experience, the doctor, and the review flow perfectly. Analytics can come when there's enough data to analyze.
