# PonyBunny Phase-2 Refactor Playbook for Codex

This document is a **staged refactor runbook** for migrating PonyBunny toward a **Phase-2 runtime architecture**:

- event-driven runtime
- multi-worker, single-process execution model
- preserved current behavior
- incremental, low-risk refactoring

It is designed specifically for **Codex sessions with limited context length**.

The operating principle is:

> Never ask Codex to do the whole refactor in one go.

Instead, use **small bounded tasks**, commit after each one, validate, then start a new Codex session with the next prompt.

---

## 1. Goal

The immediate goal is **not** to rewrite PonyBunny.

The immediate goal is to create the infrastructure needed for later refactoring:

1. introduce a unified runtime event abstraction
2. bridge existing event sources into it
3. persist runtime events for tracing/replay
4. add a minimal operator surface for inspecting events
5. only after that, begin extracting workers

---

## 2. Non-goals

During the early phases, Codex must **not**:

- rewrite scheduler behavior
- rewrite execution logic
- rewrite gateway RPC contracts
- rewrite IPC protocol
- rewrite database repositories broadly
- change business logic semantics
- remove old event systems yet
- refactor the whole repo structure

---

## 3. Target Phase-2 Direction

The target architecture after later phases is:

```text
Gateway
  │
  │ RPC / WebSocket
  ▼
Scheduler
  │
  ▼
RuntimeEventBus
  ├── ExecutionWorker
  ├── ToolWorker
  ├── ConversationWorker
  └── QualityWorker
```

But this runbook only starts by building the **foundation** for that target.

---

## 4. Working Rules for Every Codex Session

Paste these rules into every Codex session before the task-specific prompt.

```text
You are making a controlled incremental refactor.

Rules:
1. Preserve all current behavior.
2. Do not do a broad rewrite.
3. Keep changes limited to the requested scope.
4. Keep the project buildable after the change.
5. Do not remove existing code unless explicitly asked.
6. Prefer adapters and wrappers over replacement.
7. Add comments only where they clarify architecture.
8. If you need to choose between elegance and safety, choose safety.
9. After changes, summarize exactly what files were added or modified.
10. If the task seems larger than requested, stop at the safe boundary.
```

---

## 5. Repository Output Location

Create a new folder in the repository:

```text
docs/refactoring/
```

And store all generated architecture/refactor documents there.

Recommended docs to keep in-repo:

```text
docs/refactoring/
  architecture-discovery.md
  architecture-deep-analysis.md
  phase2-runtime-architecture.md
  phase2-codex-runbook.md
  phase2-event-protocol.md
  phase2-migration-checklist.md
```

---

## 6. Execution Strategy

Use **one Codex session per stage**.

Recommended sequence:

1. create design docs in repo
2. create runtime event bus abstraction
3. bridge gateway events
4. bridge scheduler/debug events
5. add runtime event store
6. add CLI event tail
7. add replay skeleton
8. only then start worker extraction

After each stage:

- review diff
- run build/tests
- commit
- start fresh Codex session for next stage

---

# Part A — Files to Create First

These files are documentation-first and should be created before code changes.

---

## A1. phase2-runtime-architecture.md

Create this file:

```text
docs/refactoring/phase2-runtime-architecture.md
```

Use the following content:

```md
# PonyBunny Phase-2 Runtime Architecture

## Objective

Refactor PonyBunny toward a Phase-2 runtime model that is:

- event-driven
- multi-worker, single-process
- easier to debug
- safer to change incrementally
- compatible with the existing Gateway + Scheduler topology

## Current Problems

The current runtime has several structural issues:

1. Scheduler is both orchestrator and execution initiator.
2. Execution, tools, LLM streaming, and verification are tightly coupled.
3. Runtime events are fragmented across gateway events, debug events, IPC messages, and database run events.
4. Global singletons hide dependencies and increase cross-module coupling.
5. The runtime is operationally split into processes, but the codebase remains internally monolithic.

## Phase-2 Design Principles

1. Orchestration is separate from execution.
2. Execution is separate from tool invocation.
3. Tool invocation is separate from transport/UI concerns.
4. All major runtime state transitions should emit RuntimeEvents.
5. Existing behavior must be preserved during migration.
6. Refactoring should proceed through adapters, not big-bang rewrites.

## Runtime Components

### Scheduler

Responsibilities:
- decide what task/work item becomes ready
- update task lifecycle state
- emit scheduling events
- track orchestration progress

Non-responsibilities:
- perform tool execution
- directly own LLM transport behavior
- directly handle UI broadcasting

### RuntimeEventBus

Responsibilities:
- publish runtime events
- allow workers and observers to subscribe
- act as the internal event backbone

### ExecutionWorker

Responsibilities:
- respond to task-ready events
- run execution logic for a work item
- emit execution lifecycle events

### ToolWorker

Responsibilities:
- execute tool requests
- emit tool lifecycle events
- isolate tool execution concerns from orchestration

### ConversationWorker

Responsibilities:
- process conversation/session events
- emit conversation responses and optionally task creation events

### QualityWorker

Responsibilities:
- verify completed execution results
- emit verification outcomes
- avoid embedding verification directly inside scheduler orchestration logic

## Migration Direction

### Phase 1
Introduce RuntimeEventBus and RuntimeEvent abstraction.

### Phase 2
Bridge existing event systems into RuntimeEventBus.

### Phase 3
Persist RuntimeEvents in SQLite.

### Phase 4
Add event inspection CLI.

### Phase 5
Extract ExecutionWorker.

### Phase 6
Extract ToolWorker.

### Phase 7
Extract ConversationWorker and QualityWorker.

## Constraints

- preserve current user-visible behavior
- do not break Gateway RPC contracts
- do not break IPC behavior
- do not require distributed workers yet
- keep architecture compatible with later multi-process evolution
```

---

## A2. phase2-event-protocol.md

Create this file:

```text
docs/refactoring/phase2-event-protocol.md
```

Use the following content:

```md
# PonyBunny Phase-2 Event Protocol

## Purpose

This document defines the internal RuntimeEvent protocol used to normalize runtime state changes across scheduling, execution, tooling, conversation, and observability.

## RuntimeEvent Shape

```ts
export interface RuntimeEvent {
  id: string
  type: string
  taskId?: string
  goalId?: string
  runId?: string
  source: string
  timestamp: number
  payload?: unknown
}
```

## Event Naming Rules

- use lower-case dotted names
- use stable verb-oriented event names
- prefer domain events over UI-specific names
- keep payload backward-compatible where possible

## Core Event Families

### Goal / Task

- `goal.created`
- `goal.started`
- `goal.completed`
- `goal.failed`
- `goal.cancelled`
- `task.created`
- `task.ready`
- `task.started`
- `task.completed`
- `task.failed`

### Execution

- `execution.started`
- `execution.completed`
- `execution.failed`

### Tooling

- `tool.requested`
- `tool.started`
- `tool.completed`
- `tool.failed`

### Verification / Quality

- `verification.started`
- `verification.completed`
- `verification.failed`

### Conversation

- `conversation.started`
- `conversation.message.received`
- `conversation.response.generated`
- `conversation.completed`
- `conversation.failed`

### LLM

- `llm.started`
- `llm.chunk`
- `llm.completed`
- `llm.failed`

### Runtime / Debug

- `runtime.started`
- `runtime.stopped`
- `runtime.error`
- `debug.event`

## Compatibility Principle

Existing event names may remain in current systems.

During migration, adapters are responsible for translating legacy event streams into RuntimeEvents.

## Persistence Principle

All RuntimeEvents may be persisted into `runtime_events` for tracing and replay.
```

---

## A3. phase2-migration-checklist.md

Create this file:

```text
docs/refactoring/phase2-migration-checklist.md
```

Use the following content:

```md
# PonyBunny Phase-2 Migration Checklist

## Stage 0 — Documentation

- [ ] Add phase2-runtime-architecture.md
- [ ] Add phase2-event-protocol.md
- [ ] Add phase2-migration-checklist.md
- [ ] Commit docs-only baseline

## Stage 1 — Runtime Event Bus

- [ ] Add RuntimeEvent type
- [ ] Add EventBus interface
- [ ] Add MemoryEventBus implementation
- [ ] Add temporary runtimeEventBus singleton
- [ ] No behavior change
- [ ] Build passes
- [ ] Commit

## Stage 2 — Event Adapters

- [ ] Add gateway event adapter
- [ ] Add scheduler event adapter
- [ ] Add debug event adapter
- [ ] Existing event flow preserved
- [ ] Runtime events emitted in parallel
- [ ] Build passes
- [ ] Commit

## Stage 3 — Runtime Event Store

- [ ] Add `runtime_events` schema
- [ ] Add RuntimeEventStore
n- [ ] Persist emitted runtime events
- [ ] Avoid blocking scheduler hot path
- [ ] Build passes
- [ ] Commit

## Stage 4 — Event Inspection CLI

- [ ] Add `pb events tail`
- [ ] Add `pb events replay <goalId>` skeleton
- [ ] Validate readable output
- [ ] Build passes
- [ ] Commit

## Stage 5 — Execution Worker Extraction

- [ ] Add ExecutionWorker abstraction
- [ ] Scheduler emits `task.ready`
- [ ] ExecutionWorker subscribes to `task.ready`
- [ ] Preserve old execution behavior until fully switched
- [ ] Build passes
- [ ] Commit

## Stage 6 — Tool Worker Extraction

- [ ] Add ToolWorker abstraction
- [ ] Emit `tool.requested`
- [ ] ToolWorker handles tool execution path
- [ ] Preserve old behavior with adapter layer if needed
- [ ] Build passes
- [ ] Commit

## Stage 7 — Conversation / Quality Workers

- [ ] Add ConversationWorker
- [ ] Add QualityWorker
- [ ] Normalize verification events
- [ ] Reduce scheduler responsibilities
- [ ] Build passes
- [ ] Commit
```

---

# Part B — Step-by-Step Codex Sessions

Each stage below is designed to fit into a separate Codex session.

---

## Session 1 — Create In-Repo Refactor Docs

### What you ask Codex to do

```text
Use the working rules below.

Task:
Create the following documentation files in the repository under docs/refactoring/:

- phase2-runtime-architecture.md
- phase2-event-protocol.md
- phase2-migration-checklist.md

Use the exact content I provide below.
Do not modify any code.
Do not infer extra content.
Just create the files exactly as requested.

[PASTE the three file contents from Part A]
```

### What you do after Codex finishes

Run:

```bash
git diff -- docs/refactoring/
```

Then commit:

```bash
git add docs/refactoring/
git commit -m "docs: add phase2 refactor architecture and migration runbook"
```

---

## Session 2 — Introduce Runtime Event Bus

### Goal

Add the internal event abstraction without changing runtime behavior.

### Prompt for Codex

```text
Use the working rules below.

Task:
Introduce the first version of a runtime event abstraction.

Scope is limited to creating new files only, plus any safe exports needed.
Do not modify scheduler logic, gateway logic, execution logic, or IPC behavior.
Do not replace any existing event system yet.

Create:
- src/runtime/event-bus/runtime-event.ts
- src/runtime/event-bus/event-bus.ts
- src/runtime/event-bus/memory-event-bus.ts
- src/runtime/event-bus/runtime-event-bus.ts
- optionally src/runtime/event-bus/index.ts

Requirements:
1. Define RuntimeEvent:
   - id: string
   - type: string
   - taskId?: string
   - goalId?: string
   - runId?: string
   - source: string
   - timestamp: number
   - payload?: unknown

2. Define EventHandler and EventBus interface:
   - publish(event): Promise<void>
   - subscribe(type, handler): void

3. Implement MemoryEventBus using Node EventEmitter.
   Requirements:
   - support multiple subscribers
   - support event-type subscription
   - publish must never throw because of one subscriber
   - async handlers should be awaited safely per subscriber
   - keep implementation small and conservative

4. Create runtimeEventBus singleton as a temporary compatibility step.

5. Add minimal architecture comments where useful.

Do not change existing behavior.
Do not wire anything yet.

At the end, summarize exactly which files were added.
```

### Validate after session

Run:

```bash
npm build
# or your actual build command
```

Then commit:

```bash
git add src/runtime/event-bus
git commit -m "refactor: add runtime event bus foundation"
```

---

## Session 3 — Bridge Gateway Events

### Goal

Mirror selected Gateway events into RuntimeEventBus.

### Prompt for Codex

```text
Use the working rules below.

Task:
Add a Gateway-to-RuntimeEventBus adapter.

Scope:
- add adapter files under src/runtime/event-bus/adapters/
- make only the minimum safe integration needed
- do not remove or replace existing gateway events
- existing Gateway event behavior must remain unchanged

Create:
- src/runtime/event-bus/adapters/gateway-event-adapter.ts

Requirements:
1. Introduce a small adapter that listens to the existing Gateway event system and republishes selected events into runtimeEventBus.
2. Start with a small safe set of events:
   - goal.created
   - goal.started
   - goal.completed
   - goal.failed
   - workitem.started
   - workitem.completed
   - workitem.failed
   - run.started
   - run.completed
3. Map them into RuntimeEvent with:
   - type = same event name for now
   - source = "gateway"
   - timestamp = Date.now()
   - payload = original payload
   - include goalId/taskId/runId when available from payload
4. Add the smallest possible integration point so the adapter is activated when Gateway starts.
5. Do not alter any existing event payloads or subscriptions.
6. If integration location is ambiguous, choose the narrowest startup composition point.

At the end, summarize:
- files added
- files modified
- where the adapter is initialized
```

### Validate after session

Run:

```bash
npm run build
npm run test
# or your real commands
```

Start services and confirm nothing broke.

Then commit:

```bash
git add src/runtime/event-bus src/gateway
git commit -m "refactor: bridge gateway events into runtime event bus"
```

---

## Session 4 — Bridge Scheduler and Debug Events

### Goal

Extend mirrored event coverage.

### Prompt for Codex

```text
Use the working rules below.

Task:
Add scheduler and debug adapters that mirror existing events into runtimeEventBus.

Scope:
- add adapters only
- keep current scheduler/debug behavior unchanged
- do not redesign event producers

Create:
- src/runtime/event-bus/adapters/scheduler-event-adapter.ts
- src/runtime/event-bus/adapters/debug-event-adapter.ts

Requirements:
1. Scheduler adapter should mirror selected scheduler lifecycle events into RuntimeEvent.
   Start with:
   - workitem.started
   - workitem.in_progress
   - workitem.completed
   - workitem.failed
   - run.started
   - run.completed
   - verification.started
   - verification.completed
   - budget.warning
   - budget.exceeded
2. Debug adapter should mirror debugEmitter events into RuntimeEvent.
   Use:
   - type = `debug.<originalName>`
   - source = "debug"
3. Integrate adapters at the safest startup/composition points.
4. Preserve all current flows.
5. Do not rename legacy events yet.

At the end, summarize files added/changed and exact integration points.
```

### Validate after session

Run the normal service startup and inspect logs.

Commit:

```bash
git add src/runtime/event-bus src/scheduler src/scheduler-daemon src/debug src/gateway
git commit -m "refactor: bridge scheduler and debug events into runtime bus"
```

---

## Session 5 — Add Runtime Event Store

### Goal

Persist mirrored runtime events.

### Prompt for Codex

```text
Use the working rules below.

Task:
Add a RuntimeEventStore that persists RuntimeEvents into SQLite.

Scope:
- add schema extension
- add store implementation
- wire runtimeEventBus to persist events
- do not broadly refactor repository layer

Requirements:
1. Add a new table `runtime_events` with columns:
   - id TEXT PRIMARY KEY
   - type TEXT NOT NULL
   - task_id TEXT NULL
   - goal_id TEXT NULL
   - run_id TEXT NULL
   - source TEXT NOT NULL
   - timestamp INTEGER NOT NULL
   - payload_json TEXT NULL
2. Add a small store module:
   - src/runtime/event-bus/runtime-event-store.ts
3. The store should expose a narrow API like:
   - append(event)
   - listByGoal(goalId)
   - listRecent(limit)
4. Wire the runtimeEventBus so published events are persisted.
5. Keep integration conservative and safe.
6. Avoid blocking scheduler hot paths more than necessary.
7. Do not change existing tables except for adding runtime_events.

At the end, summarize files added/changed and where persistence is wired.
```

### Validate after session

Run build, start services, and verify table exists.

Quick manual check example:

```bash
sqlite3 ~/.ponybunny/pony.db '.schema runtime_events'
```

Commit:

```bash
git add src/runtime/event-bus src/infra/persistence
git commit -m "refactor: persist runtime events for tracing"
```

---

## Session 6 — Add `pb events tail`

### Goal

Add a small operator-facing view of runtime events.

### Prompt for Codex

```text
Use the working rules below.

Task:
Add a minimal CLI command:

pb events tail

Scope:
- add only a simple CLI surface
- do not build a full TUI
- do not change service semantics

Requirements:
1. Command should print runtime events in a readable line-based format.
2. Prefer reading from runtimeEventBus if attached to current process.
3. If that is not practical in current architecture, allow fallback to reading recent persisted events from runtime_events.
4. Output format:
   timestamp | type | goalId | taskId | source
5. Keep implementation conservative.
6. Register the command cleanly in existing CLI structure.

At the end, summarize files added/changed and whether implementation is live-stream or DB-tail based.
```

### Validate after session

Run:

```bash
pb events tail
```

Commit:

```bash
git add src/cli src/runtime/event-bus
git commit -m "feat: add runtime event tail command"
```

---

## Session 7 — Add Replay Skeleton

### Goal

Add a non-destructive replay surface.

### Prompt for Codex

```text
Use the working rules below.

Task:
Add a minimal replay inspection command:

pb events replay <goalId>

Scope:
- inspection only
- no actual re-execution
- no deterministic engine rewrite

Requirements:
1. Read runtime_events by goalId.
2. Print events sequentially in timestamp order.
3. Show enough payload summary to understand the event timeline.
4. Do not attempt to rebuild state automatically.
5. Keep implementation small.

At the end, summarize files changed and how replay output is formatted.
```

### Validate after session

Run:

```bash
pb events replay <some-goal-id>
```

Commit:

```bash
git add src/cli src/runtime/event-bus
git commit -m "feat: add runtime event replay skeleton"
```

---

# Part C — After the Foundation Is Done

Only after Sessions 1–7 are complete should you move on to worker extraction.

Recommended order:

1. ExecutionWorker
2. ToolWorker
3. QualityWorker
4. ConversationWorker

Do not ask Codex to extract more than one worker in one session.

---

## Session 8 — Design-Only for ExecutionWorker

Before changing code, ask Codex to write a design note in repo:

```text
Create docs/refactoring/execution-worker-extraction.md.

Document:
- current execution entry points
- proposed ExecutionWorker boundary
- events consumed
- events emitted
- migration risks
- compatibility plan

Do not change code.
```

Commit docs first.

---

# Part D — Recommended Human Review Checklist

Review these after every session:

## Safety

- Did Codex touch files outside the requested scope?
- Did it silently rewrite logic instead of adapting?
- Did it rename existing events unexpectedly?
- Did it change public contracts?

## Build Integrity

- Does the project still build?
- Do services still start?
- Does TUI still connect?
- Do goal submission and conversation still work?

## Architectural Integrity

- Was the change additive rather than invasive?
- Is the new code easy to remove or replace later?
- Did the change reduce ambiguity or add more hidden coupling?

---

# Part E — Recommended Commit Sequence

```bash
git commit -m "docs: add phase2 refactor architecture and runbook"
git commit -m "refactor: add runtime event bus foundation"
git commit -m "refactor: bridge gateway events into runtime event bus"
git commit -m "refactor: bridge scheduler and debug events into runtime bus"
git commit -m "refactor: persist runtime events for tracing"
git commit -m "feat: add runtime event tail command"
git commit -m "feat: add runtime event replay skeleton"
```

---

# Part F — What To Do If Codex Drifts

If Codex starts making large unrelated changes, stop and reset the scope.

Use this recovery prompt:

```text
Stop.
Your previous change went beyond scope.

Reset to this rule:
- only perform the explicitly requested task
- do not refactor adjacent systems
- do not rewrite logic
- do not rename public interfaces
- prefer wrappers/adapters

Now continue only with: [INSERT EXACT TASK]
```

---

# Part G — Practical Notes

1. Keep each Codex session narrow.
2. Start a fresh session for each stage.
3. Re-paste the working rules every time.
4. Always anchor Codex to exact file paths.
5. Prefer docs-first, then code.
6. Commit after every successful stage.
7. Do not let Codex “clean up” unrelated architecture during these steps.

---

# End State of This Playbook

If you follow this runbook, you will end up with:

- architecture docs checked into the repo
- a unified RuntimeEvent abstraction
- adapters from legacy event systems
- runtime event persistence
- basic trace/replay CLI surfaces
- a safe foundation for later worker extraction

That is the correct place to begin the real Phase-2 refactor.
