# Testing & Verification Strategy for Ralph VPS

## Executive Summary

This document defines a **confidence ladder** — a build-and-verify sequence where each step is provably working before the next begins. The core philosophy: **if you can't test it, you can't trust it. If you can't trust it, don't deploy it to a remote machine you'll forget about.**

The system has a natural layering: task file format → state machine → git sync → agent execution → full loop. Each layer can be tested in isolation, then composed. The key insight is that **the entire system can be tested locally before a VPS is ever provisioned**.

---

## 1. Build Order (The Confidence Ladder)

The right sequence builds from pure logic (no I/O) outward to full infrastructure:

### Layer 0: Task File Format & Parsing
- Define the task file schema (YAML/TOML/JSON front matter + markdown body)
- Write a parser that reads task files into typed objects
- **Why first**: Everything depends on this. If parsing is wrong, nothing works.
- **Testable in isolation**: Yes, pure function, no I/O needed.

### Layer 1: Task State Machine
- Define valid states: `pending` → `claimed` → `running` → `done` / `failed` / `review`
- Define valid transitions and guards (e.g., only claim if unclaimed)
- **Why second**: The state machine is the heart of correctness.
- **Testable in isolation**: Yes, pure logic.

### Layer 2: Task Queue (File System)
- Scan a directory for task files
- Filter/sort by state, priority, timestamp
- Claim a task (atomic write with lock)
- **Why third**: Connects parsing + state machine to the file system.
- **Testable in isolation**: Yes, using a temp directory.

### Layer 3: Git Sync
- Pull changes, detect new/modified tasks
- Commit state changes, push results
- Handle conflicts (two agents claiming the same task)
- **Why fourth**: Adds network/git complexity on top of working queue logic.
- **Testable in isolation**: Yes, using local bare repos (no remote needed).

### Layer 4: Agent Executor (Claude Code Wrapper)
- Construct prompt from task file
- Invoke Claude Code CLI
- Capture output, logs, exit code
- Write results back to task file
- **Why fifth**: Needs working task files and state machine.
- **Testable in isolation**: Yes, with mock/stub Claude Code.

### Layer 5: The Loop (Orchestrator)
- Poll for tasks → claim → execute → commit → push → repeat
- Handle errors, retries, cooldowns
- **Why sixth**: Composes everything above.
- **Testable locally**: Yes, with local git repos and mock Claude Code.

### Layer 6: Docker Container
- Package the loop into a container
- Mount/configure git credentials
- Health checks, log forwarding
- **Why seventh**: Infrastructure wrapping around working logic.
- **Testable locally**: Yes, Docker runs on the dev machine.

### Layer 7: VPS Deployment
- Provision VPS, deploy container
- Verify it runs, picks up tasks, pushes results
- **Why last**: Only after everything works locally.

---

## 2. Unit Testing Strategy

### What CAN be unit tested (pure logic, no I/O)

**Task file parsing:**
```
- Valid task file → correct typed object
- Missing required fields → clear error
- Invalid state value → clear error
- Malformed YAML/front matter → clear error
- Edge cases: empty body, unicode, very long content
```

**State machine transitions:**
```
- pending → claimed: allowed
- pending → running: NOT allowed (must claim first)
- claimed → running: allowed
- running → done: allowed
- running → failed: allowed
- done → pending: NOT allowed (or allowed for retry?)
- Any transition with wrong agent ID: NOT allowed
```

**Task queue sorting/filtering:**
```
- Filter by state (give me all pending tasks)
- Sort by priority
- Sort by creation date
- Filter by tag/label
```

**Prompt construction:**
```
- Task with context files → prompt includes file contents
- Task with specific instructions → prompt formatted correctly
- Task with constraints (no file creation, etc.) → prompt includes guardrails
```

**Result parsing:**
```
- Claude Code output → structured result object
- Exit code mapping → success/failure determination
- Log extraction → relevant log lines captured
```

### Testing framework recommendation

Use **Bun's built-in test runner** (`bun test`). It's fast, has good TypeScript support, and keeps dependencies minimal. No need for Jest, Vitest, or anything heavier.

```typescript
// Example: state machine unit test
import { describe, it, expect } from "bun:test";
import { transition } from "./state-machine";

describe("task state machine", () => {
  it("allows pending → claimed", () => {
    const task = { state: "pending", claimedBy: null };
    const result = transition(task, "claim", { agentId: "ralph-1" });
    expect(result.state).toBe("claimed");
    expect(result.claimedBy).toBe("ralph-1");
  });

  it("rejects pending → running (must claim first)", () => {
    const task = { state: "pending", claimedBy: null };
    expect(() => transition(task, "start", { agentId: "ralph-1" })).toThrow();
  });
});
```

---

## 3. Integration Testing Strategy

### Git sync testing (no remote server needed)

The critical insight: **you can test git sync entirely locally using bare repos.**

```bash
# Setup: create a "remote" bare repo locally
git init --bare /tmp/test-remote.git

# Clone it twice: once as "VPS agent", once as "user laptop"
git clone /tmp/test-remote.git /tmp/test-agent
git clone /tmp/test-remote.git /tmp/test-laptop
```

This gives you a fully functional git workflow without any network. Tests can:
- User creates a task file, commits, pushes
- Agent pulls, sees new task, claims it, pushes claim
- User pulls, sees task is claimed
- Agent completes task, pushes result
- User pulls, sees result

**Conflict testing:**
- Two agents both try to claim the same task
- User modifies a task while agent is working on it
- Agent pushes while user has uncommitted changes (doesn't matter — separate repos)

### Full loop testing (local, no VPS)

Run the entire orchestrator loop locally:
1. Create a temp directory structure with bare repo + two clones
2. Seed it with task files
3. Start the orchestrator pointing at the agent clone (with mock Claude Code)
4. Verify tasks progress through states
5. Verify results appear in the "laptop" clone after pull

### Docker integration testing

```bash
# Build container
docker build -t ralph-agent .

# Run against local bare repo (mounted or via git daemon)
docker run -v /tmp/test-remote.git:/repo ralph-agent

# Verify container behavior matches local behavior
```

---

## 4. Local Testing (Everything Before VPS)

**Yes, the entire system MUST be testable locally before any VPS is involved.**

### Local testing topology

```
┌─────────────────────────────────────────────┐
│  Developer's Machine                         │
│                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│  │ Bare Repo│◄──│ "Laptop" │   │ "Agent"  │ │
│  │ (origin) │──►│  Clone   │   │  Clone   │ │
│  └──────────┘   └──────────┘   └──────────┘ │
│                                     │        │
│                              ┌──────┴──────┐ │
│                              │ Orchestrator│ │
│                              │ (mock CC)   │ │
│                              └─────────────┘ │
└─────────────────────────────────────────────┘
```

### What "mock Claude Code" means

The orchestrator calls Claude Code CLI. For testing, we replace it with a script that:
1. Reads the task prompt from stdin/args
2. Simulates work (creates/modifies files based on simple rules)
3. Writes a deterministic output
4. Exits with code 0 (success) or 1 (failure, for error-path testing)

```bash
#!/bin/bash
# mock-claude-code.sh
# Reads task, creates a result file, exits successfully
echo "Mock Claude Code executed"
echo "Task completed successfully" > result.md
exit 0
```

Or for more sophisticated testing, a TypeScript mock:

```typescript
// mock-claude.ts — reads task file, produces deterministic output
const taskPath = process.argv[2];
const task = await Bun.file(taskPath).text();

// Simulate different outcomes based on task content
if (task.includes("should-fail")) {
  console.error("Simulated failure");
  process.exit(1);
}

// Write a result
await Bun.write("result.md", `Completed task from: ${taskPath}`);
process.exit(0);
```

### Docker-in-Docker: Not needed

Don't bother with Docker-in-Docker. Instead:
1. Test all logic outside Docker first (unit + integration tests with local git repos)
2. Test the Docker container separately (does it build? does it start? does it mount volumes correctly?)
3. The Docker container is just packaging — the logic inside is the same logic you already tested

---

## 5. Verification Gates

Each layer has a gate that must pass before proceeding. **No skipping.**

### Gate 0: Task Format ✓
- [ ] Parser handles all valid task file formats
- [ ] Parser rejects all invalid formats with clear errors
- [ ] Round-trip: parse → serialize → parse produces identical result
- [ ] At least 10 test cases covering edge cases

### Gate 1: State Machine ✓
- [ ] All valid transitions succeed
- [ ] All invalid transitions throw/return errors
- [ ] State machine is fully deterministic (same input → same output)
- [ ] 100% branch coverage on transition logic
- [ ] Property-based test: random sequence of valid transitions never produces invalid state

### Gate 2: Task Queue ✓
- [ ] Queue correctly lists pending tasks from directory
- [ ] Queue respects priority ordering
- [ ] Claiming a task atomically updates the file
- [ ] Two concurrent claims: only one succeeds (file locking)
- [ ] Works with 0, 1, 10, 100 task files

### Gate 3: Git Sync ✓
- [ ] Pull detects new task files
- [ ] Commit + push succeeds for state changes
- [ ] Conflict detection works (two agents claiming same task)
- [ ] Conflict resolution strategy works (retry with fresh pull)
- [ ] Works with local bare repo (no network)

### Gate 4: Agent Executor ✓
- [ ] Prompt construction produces correct format
- [ ] Mock Claude Code: success path captures output
- [ ] Mock Claude Code: failure path captures error
- [ ] Timeout handling: agent killed after max time
- [ ] Output written back to task file correctly

### Gate 5: Full Loop ✓
- [ ] Orchestrator picks up pending task
- [ ] Orchestrator claims, executes, completes task
- [ ] Orchestrator handles empty queue (waits/polls)
- [ ] Orchestrator handles execution failure (marks failed)
- [ ] Full cycle visible from "laptop" clone after pull
- [ ] Multiple tasks processed in sequence

### Gate 6: Docker ✓
- [ ] Container builds successfully
- [ ] Container starts and runs orchestrator
- [ ] Container can access git repo (credentials mounted)
- [ ] Health check endpoint/file works
- [ ] Logs are accessible from outside container
- [ ] Container restarts cleanly after crash

### Gate 7: VPS ✓
- [ ] Container runs on VPS
- [ ] VPS can pull from / push to git remote
- [ ] Task round-trip works: laptop → git → VPS → git → laptop
- [ ] System survives VPS restart
- [ ] Logs accessible remotely

---

## 6. Mock Strategies

### Strategy 1: CLI Stub (simplest, start here)

Replace the Claude Code CLI binary path with a shell script.

```bash
# Set in config or environment
CLAUDE_CODE_BIN=./test/mock-claude-code.sh
```

The mock script receives the same args as real Claude Code and produces deterministic output. This is the **first** mock to implement and sufficient for most testing.

### Strategy 2: Behavior-Based Mock (for complex scenarios)

A TypeScript mock that reads the task and produces different outputs based on content:

```typescript
// Scenarios encoded in task file:
// - "task-add-function" → creates a new .ts file with a function
// - "task-fix-bug" → modifies an existing file
// - "task-timeout" → sleeps forever (tests timeout handling)
// - "task-crash" → exits with code 137 (tests crash handling)
// - "task-conflict" → modifies a file that will conflict on push
```

### Strategy 3: Record/Replay (for regression)

Record real Claude Code sessions and replay them:
1. Run a task with real Claude Code
2. Capture: stdin, stdout, stderr, exit code, files created/modified
3. Store as a test fixture
4. Replay: mock reads fixture and reproduces the same behavior

**When to use this**: After the system works end-to-end with real Claude Code, record sessions for regression testing. Don't start here — it's the most complex mock strategy.

### Strategy 4: Cost-Controlled Real Execution

For smoke tests only: run actual Claude Code with a trivial task (e.g., "create an empty file called `hello.txt`"). This verifies the integration is real but keeps cost/time minimal.

```typescript
// smoke-test.ts
// Only runs if RALPH_SMOKE_TEST=1
// Uses a real Claude Code invocation with a trivial task
// Budget: < $0.01 per run
```

---

## 7. End-to-End Test Scenario

### The "Golden Path" Test

This is the full happy-path test that proves the system works:

```
Step 1: Setup
  - Create bare repo, two clones ("laptop", "agent")
  - Configure orchestrator to use agent clone + mock Claude Code

Step 2: Create Task (simulate user on laptop)
  - In laptop clone, create file: tasks/001-add-greeting.md
    ---
    state: pending
    priority: 1
    title: Add a greeting function
    ---
    Create a function `greet(name: string): string` that returns "Hello, {name}!"
  - Commit and push

Step 3: Run Orchestrator
  - Start orchestrator in agent clone
  - Wait for it to pull, detect task, claim it

Step 4: Verify Claim
  - In laptop clone, pull
  - Assert tasks/001-add-greeting.md now has state: claimed

Step 5: Wait for Completion
  - Orchestrator runs mock Claude Code
  - Mock creates greet.ts with the function
  - Orchestrator commits result, pushes

Step 6: Verify Result
  - In laptop clone, pull
  - Assert tasks/001-add-greeting.md now has state: done
  - Assert greet.ts exists with expected content
  - Assert execution log exists

Step 7: Cleanup
  - Stop orchestrator
  - Remove temp directories
```

### The "Failure Path" Test

```
Same as above, but:
- Mock Claude Code exits with code 1
- Verify task state becomes "failed"
- Verify error is captured in task file or log
- Verify orchestrator continues to next task (doesn't crash)
```

### The "Conflict Path" Test

```
Step 1-3: Same as golden path (task created, orchestrator claims)

Step 4: User modifies task while agent is working
  - In laptop clone, modify the task file
  - Commit and push

Step 5: Agent finishes and tries to push
  - Push fails due to conflict
  - Agent handles conflict (pull, re-apply, retry)
  - OR: Agent marks conflict, flags for human review

Step 6: Verify
  - Either: conflict resolved automatically
  - Or: task marked with conflict state, human can see it
```

---

## 8. Regression Testing Strategy

### What breaks most often in systems like this

1. **Task file format changes** — adding a field breaks existing parsing
2. **State machine edge cases** — new state added, transitions not updated
3. **Git race conditions** — timing-dependent bugs in claim/push
4. **Claude Code output format changes** — output parsing breaks

### Regression test approach

**Fixture-based tests:**
- Store known-good task files as test fixtures
- Store known-good Claude Code outputs as fixtures
- Tests compare against these fixtures
- When format changes intentionally, update fixtures deliberately

**Snapshot testing (for prompt construction):**
- Snapshot the constructed prompt for each task type
- If the prompt changes unexpectedly, the test fails
- Deliberate changes: update the snapshot

**CI pipeline:**
```
bun test                    # Unit tests (< 5 seconds)
bun test:integration        # Integration tests with local git (< 30 seconds)
bun test:e2e                # End-to-end with mock Claude Code (< 60 seconds)
docker build && docker test # Container tests (< 120 seconds)
```

Total regression suite: **under 4 minutes**. Fast enough to run on every commit.

### Git bisect compatibility

All tests must be:
- Self-contained (no external dependencies)
- Deterministic (no flaky tests)
- Fast (enables `git bisect run bun test`)

---

## 9. Monitoring & Observability

### For a remote unattended system, you NEED:

#### Logs (non-negotiable)

**Structured logging** — JSON lines, not printf debugging:
```json
{"ts":"2026-03-03T10:00:00Z","level":"info","event":"task_claimed","task":"001","agent":"ralph-1"}
{"ts":"2026-03-03T10:00:05Z","level":"info","event":"execution_start","task":"001","agent":"ralph-1"}
{"ts":"2026-03-03T10:05:00Z","level":"info","event":"execution_done","task":"001","duration_s":295,"exit_code":0}
{"ts":"2026-03-03T10:05:01Z","level":"info","event":"push_success","task":"001","commit":"abc123"}
```

**Log levels:**
- `error`: Something broke, needs attention
- `warn`: Something unexpected but handled (conflict resolved, retry succeeded)
- `info`: Normal operations (task claimed, completed, pushed)
- `debug`: Detailed internals (git commands executed, file contents)

**Log destination:** Write to file inside container, mount the log directory. Optionally forward to a log aggregator, but start with files.

#### Health Checks

**Liveness:** "Is the process running?"
- Simple: a file touched every loop iteration (e.g., `/tmp/ralph-heartbeat`)
- Docker health check: `test -f /tmp/ralph-heartbeat && find /tmp/ralph-heartbeat -mmin -5`
- If heartbeat is stale (>5 min old), container is unhealthy → Docker restarts it

**Readiness:** "Is it able to do work?"
- Can it reach the git remote? (`git ls-remote origin`)
- Is the working directory clean? (no uncommitted garbage)
- Is there disk space?

#### Metrics (keep it simple)

Don't set up Prometheus/Grafana for V1. Instead, log metrics as structured events and grep them later:
```json
{"ts":"...","event":"metrics","tasks_completed":5,"tasks_failed":1,"uptime_hours":24,"last_push":"2026-03-03T09:55:00Z"}
```

Emit a metrics event every N minutes (e.g., every 15 min). This gives you enough to diagnose issues without infrastructure overhead.

#### Alerting (V1: git-based)

Since the user is already watching git:
- **Heartbeat commit**: Every 30 min, commit a heartbeat file (e.g., `status/heartbeat.json`) with timestamp, tasks completed, health status
- **User can pull and see**: If heartbeat is stale, system is down
- **Failed tasks**: Visible in git as task files with `state: failed`

No need for PagerDuty or Slack integrations in V1. The git repo IS the monitoring dashboard.

#### Introspection (for the user on their laptop)

```bash
# See what Ralph is doing right now
git pull && cat status/heartbeat.json

# See all failed tasks
grep -l "state: failed" tasks/*.md

# See execution log for a specific task
cat logs/001-add-greeting.log

# See how many tasks completed today
grep "execution_done" logs/orchestrator.log | grep "2026-03-03" | wc -l
```

---

## 10. The Verification Ladder (Full Build Sequence)

This is the complete step-by-step sequence from empty repo to running on VPS. Each step has a "prove it works" criterion.

### Step 1: Project Setup
**Build:**
- Init TypeScript project with Bun
- Set up test runner (`bun test`)
- Set up linting (optional but recommended)

**Prove it:**
```bash
bun test  # Runs, outputs "0 tests passed" (no tests yet, but framework works)
```

### Step 2: Task File Format
**Build:**
- Define TypeScript types for task files
- Write parser (YAML front matter + markdown body)
- Write serializer (typed object → task file)

**Prove it:**
```bash
bun test  # 10+ tests pass: valid files parsed, invalid files rejected, round-trip works
```

### Step 3: State Machine
**Build:**
- Define states and transitions
- Implement transition function with guards
- Implement transition history (audit trail)

**Prove it:**
```bash
bun test  # 15+ tests pass: all transitions tested, invalid ones rejected
```

### Step 4: Task Queue
**Build:**
- Directory scanner: find task files, parse them
- Filter/sort logic
- Claim function: atomic state update + write

**Prove it:**
```bash
bun test  # Tests create temp dirs with task files, scan/filter/claim works
```

### Step 5: Git Sync
**Build:**
- Pull function (fetch + merge/rebase)
- Commit function (stage changed files, commit with message)
- Push function (push to origin, handle rejection)
- Conflict detection and resolution

**Prove it:**
```bash
bun test:integration  # Tests use local bare repos, full git workflow works
```

### Step 6: Agent Executor
**Build:**
- Prompt construction from task file
- Claude Code CLI invocation (configurable binary path)
- Output capture (stdout, stderr, exit code)
- Result writing back to task file

**Prove it:**
```bash
bun test  # Tests use mock Claude Code script, verify prompt and output handling
```

### Step 7: Orchestrator Loop
**Build:**
- Main loop: pull → scan → claim → execute → commit → push → repeat
- Error handling: failed execution, failed push, empty queue
- Cooldown/polling interval
- Graceful shutdown (SIGTERM/SIGINT)

**Prove it:**
```bash
bun test:e2e  # Full end-to-end with local git repos and mock Claude Code
# Create task → loop picks up → executes → pushes → verify from "laptop" clone
```

### Step 8: Logging & Health Checks
**Build:**
- Structured JSON logger
- Heartbeat file (touch on every loop)
- Metrics emission
- Status file committed to git periodically

**Prove it:**
```bash
bun test  # Logger outputs correct JSON, heartbeat file updated
# Manual: run orchestrator for 2 min, check logs are readable and heartbeat is fresh
```

### Step 9: Docker Container
**Build:**
- Dockerfile (Bun runtime, git, SSH client)
- docker-compose.yml for local testing
- Volume mounts for logs, git credentials
- Health check configuration

**Prove it:**
```bash
docker compose up -d
docker compose ps     # Container is running, health check passes
docker compose logs   # Logs are structured JSON
# Run the same e2e test but inside Docker
```

### Step 10: Real Claude Code Test (Local)
**Build:**
- Swap mock for real Claude Code
- Create a trivial task (e.g., "create hello.txt")
- Run locally (not in Docker yet)

**Prove it:**
```bash
# Manual test with real Claude Code
# Task goes pending → claimed → running → done
# Result file exists and is correct
# Cost: < $0.05
```

### Step 11: Real Claude Code in Docker (Local)
**Build:**
- Mount Claude Code credentials into container
- Configure API key / auth

**Prove it:**
```bash
docker compose up -d
# Same trivial task, but running inside Docker
# Task completes, result pushed to local bare repo
```

### Step 12: VPS Provisioning
**Build:**
- Provision VPS (DigitalOcean/Hetzner/etc.)
- Install Docker
- Set up SSH access
- Deploy container

**Prove it:**
```bash
ssh user@vps "docker ps"           # Container is running
ssh user@vps "docker logs ralph"   # Logs look correct
```

### Step 13: VPS End-to-End
**Build:**
- Point container at real git remote (GitHub/GitLab)
- Configure git credentials (SSH key or token)
- Create a real task, push to remote

**Prove it:**
```bash
# From laptop:
git push origin main  # Task file pushed
# Wait...
git pull              # Task is now "done", result files present
```

### Step 14: Resilience Testing
**Build:**
- Test VPS restart: `ssh user@vps "sudo reboot"`
- Test container crash: `ssh user@vps "docker kill ralph"`
- Test network interruption: temporarily block git push

**Prove it:**
```bash
# After each disruption:
# Container comes back up (Docker restart policy)
# Orchestrator resumes from clean state
# No duplicate task execution
# No data loss
```

---

## Appendix A: Test File Structure

```
tests/
├── unit/
│   ├── task-parser.test.ts      # Task file parsing
│   ├── state-machine.test.ts    # State transitions
│   ├── task-queue.test.ts       # Queue filtering/sorting
│   ├── prompt-builder.test.ts   # Prompt construction
│   └── result-parser.test.ts    # Output parsing
├── integration/
│   ├── git-sync.test.ts         # Git operations with local bare repos
│   ├── task-claim.test.ts       # Concurrent claim testing
│   └── helpers/
│       └── git-fixtures.ts      # Create temp repos for testing
├── e2e/
│   ├── golden-path.test.ts      # Full happy path
│   ├── failure-path.test.ts     # Error handling path
│   ├── conflict-path.test.ts    # Git conflict handling
│   └── mock/
│       ├── mock-claude-code.sh  # Simple bash mock
│       └── mock-claude-code.ts  # Behavior-based mock
├── fixtures/
│   ├── tasks/
│   │   ├── valid-minimal.md     # Minimal valid task
│   │   ├── valid-full.md        # Task with all fields
│   │   ├── invalid-no-state.md  # Missing state field
│   │   └── invalid-bad-yaml.md  # Malformed front matter
│   └── outputs/
│       ├── success-output.txt   # Mock Claude Code success output
│       └── failure-output.txt   # Mock Claude Code failure output
└── smoke/
    └── real-claude.test.ts      # Real Claude Code (opt-in, costs money)
```

## Appendix B: CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test              # Unit tests (< 5s)

  integration:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test:integration  # Git integration tests (< 30s)

  e2e:
    runs-on: ubuntu-latest
    needs: integration
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test:e2e          # End-to-end with mock (< 60s)

  docker:
    runs-on: ubuntu-latest
    needs: e2e
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ralph-agent .
      - run: docker compose -f docker-compose.test.yml up --abort-on-container-exit
```

## Appendix C: Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Flaky git tests (timing) | False failures erode trust in tests | Use deterministic local repos, no network I/O in tests |
| Mock drift (mock doesn't match real Claude Code) | Tests pass but production fails | Periodic smoke tests with real Claude Code; record/replay |
| State corruption (half-written task file) | Agent stuck, tasks lost | Atomic writes (write temp file, rename); fsync |
| Concurrent claim race | Two agents work on same task | File locking or git-based locking (commit-and-push, fail if conflict) |
| VPS disk full | Agent stops working silently | Health check includes disk space; log rotation |
| Git credentials expire | Push fails, work lost | Health check tests `git ls-remote`; alert via heartbeat staleness |
| Claude Code API outage | Agent idle | Retry with backoff; log the failure; don't mark task as permanently failed |

## Appendix D: The "One-Liner" Verification Commands

At each step, you should be able to run one command to verify everything works:

```bash
# Step 2-4: Unit tests
bun test

# Step 5: Integration tests (includes git sync)
bun test:integration

# Step 7: End-to-end test
bun test:e2e

# Step 9: Docker test
docker compose -f docker-compose.test.yml up --abort-on-container-exit

# Step 13: VPS smoke test
./scripts/vps-smoke-test.sh  # Creates task, waits, verifies completion

# Everything at once (CI)
bun test && bun test:integration && bun test:e2e
```

---

## Summary: The Testing Philosophy

1. **Test from the inside out.** Pure logic first, then I/O, then infrastructure.
2. **Every layer is independently testable.** If it's not, refactor until it is.
3. **Local testing is non-negotiable.** If it doesn't work on your laptop, it won't work on a VPS.
4. **Mock Claude Code early, test with real Claude Code late.** Mocks for speed, real calls for confidence.
5. **Git IS the monitoring system.** Heartbeats, task states, logs — all visible via `git pull`.
6. **No step is skipped.** Each gate must pass before the next step begins.
7. **Fast tests enable fast iteration.** Full suite under 4 minutes. Run it on every commit.
