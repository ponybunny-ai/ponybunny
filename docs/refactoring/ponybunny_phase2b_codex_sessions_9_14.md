# PonyBunny Phase-2B Codex Sessions 9–14

This document continues the earlier playbook and covers the next stage after the event spine is complete.

Current milestone status:

- Phase 2A complete: runtime event spine established
- Existing services still run
- Runtime events are persisted and observable
- `pb events tail` and replay skeleton exist

Next objective:

> Extract the execution boundary so that `SchedulerCore` no longer directly depends on `ExecutionService` in the target path.

This stage is **not** a rewrite.

It is a **controlled boundary extraction**.

---

## Global rules for every Codex session in this stage

Paste this block at the start of **every** new Codex session.

```text
You are working on a controlled architectural refactor of PonyBunny.

Current state:
- Phase 2A event spine is complete
- runtime event bus exists
- runtime event log exists
- pb events tail exists
- replay skeleton exists

Current refactor goal:
- begin Phase 2B: Execution Boundary Extraction
- move toward event-driven execution workers
- do not rewrite the system
- do not broaden scope

Hard rules:
- preserve current functionality
- keep the repo buildable after each change
- keep all existing services runnable after each change
- do not change gateway RPC protocol
- do not change IPC protocol unless explicitly requested in the current session
- do not change business behavior unless explicitly requested in the current session
- do not refactor unrelated files
- do not mix multiple planned sessions into one
- if you find extra issues, record them in notes instead of fixing them unless required for the current task

Required output style:
- first explain the exact files you plan to change
- then implement only the requested scope
- then provide a short summary of what changed
- then list exact validation steps
```

---

## Session 9 — Completion report and direct call inventory

### Session goal

Produce documentation only.

Do not change runtime behavior.
Do not modify architecture yet.
Do not refactor code yet.

### What this session must produce

Create:

- `docs/refactoring/phase2a-completion-report.md`
- `docs/refactoring/direct-call-boundaries.md`

### What `phase2a-completion-report.md` must contain

1. What was added during Phase 2A
   - runtime event bus modules
   - adapters added
   - runtime event persistence
   - CLI commands added
2. Which current runtime paths now emit runtime events
3. Which important runtime paths still do not emit enough events
4. What remains risky or incomplete
5. Recommended next extraction target

### What `direct-call-boundaries.md` must contain

Identify and document all important remaining synchronous call chains, especially:

- `SchedulerCore -> ExecutionService`
- execution path internal call graph
- conversation path that directly creates goals/tasks
- any scheduler-owned completion logic tightly coupled to execution results

For each boundary document:

- caller
- callee
- file paths
- sync/async/evented
- why it is a coupling problem
- recommended future extraction strategy

### Prompt to paste into Codex for Session 9

```text
[Paste the Global Rules block first]

Current session objective:
Create documentation only for the next refactor stage.

Tasks:
1. Inspect the current Phase 2A code state.
2. Create `docs/refactoring/phase2a-completion-report.md`.
3. Create `docs/refactoring/direct-call-boundaries.md`.

Requirements:
- do not change runtime code unless a tiny documentation-related fix is absolutely necessary
- do not refactor behavior
- focus on execution-boundary extraction readiness
- explicitly identify the strongest remaining synchronous couplings
- end the session with a short recommendation for the first code extraction step

Output expected from you:
- files created
- summary of findings
- no code redesign yet
```

### Expected commit

```bash
git add docs/refactoring/phase2a-completion-report.md docs/refactoring/direct-call-boundaries.md
git commit -m "docs: add phase2a completion report and direct call inventory"
```

---

## Session 10 — Introduce ExecutionPort abstraction

### Session goal

Create a narrow boundary between scheduler and execution.

This session is still **behavior-preserving**.

The scheduler may still execute work directly after this session.

### What this session must do

Introduce an abstraction such as:

- `ExecutionPort`
- `ExecutionRequest`
- `ExecutionResult`

Recommended location:

- `src/runtime/execution-port/` or `src/app/ports/execution/`

Choose one location and keep it consistent.

### Required outcome

- `SchedulerCore` no longer depends on the concrete execution service type directly
- `SchedulerCore` depends on an interface/port
- existing direct execution path still works
- no event-driven switch yet

### Suggested files to create

- `execution-port.ts`
- `execution-types.ts`
- `direct-execution-adapter.ts`

### Design rules

The port should represent only the minimum contract needed by scheduler.

Avoid leaking tool, prompt, MCP, or gateway details into the port.

The port should look conceptually like:

```ts
interface ExecutionPort {
  execute(request: ExecutionRequest): Promise<ExecutionResult>
}
```

### Prompt to paste into Codex for Session 10

```text
[Paste the Global Rules block first]

Current session objective:
Introduce an execution boundary abstraction between SchedulerCore and the current concrete execution implementation.

Tasks:
1. Create a minimal `ExecutionPort` abstraction and related types.
2. Add a direct adapter that wraps the current execution path.
3. Refactor SchedulerCore to depend on the port instead of the concrete execution service.
4. Preserve all existing behavior.

Constraints:
- no event-driven execution switch yet
- no worker implementation yet
- no gateway changes
- no IPC changes
- no database schema changes
- do not redesign execution internals

Deliverables:
- new execution port files
- scheduler updated to use the port
- direct adapter wired in
- short summary of exact files changed
- validation steps
```

### Expected commit

```bash
git add .
git commit -m "refactor: introduce execution port boundary"
```

---

## Session 11 — Add LocalExecutionWorker skeleton

### Session goal

Introduce the first execution worker skeleton **without switching scheduler over to it**.

This means the worker exists and can subscribe to runtime events, but the main scheduler path still uses direct execution.

### What this session must do

Create:

- `LocalExecutionWorker`

Responsibilities:

- subscribe to `task.ready`
- map event payload to execution request
- call existing execution through an adapter or port
- emit:
  - `execution.started`
  - `execution.completed`
  - `execution.failed`

### Important

This session does **not** make the worker authoritative yet.

It is allowed to exist in parallel with the direct scheduler path.

### Suggested files

- `src/runtime/workers/execution/local-execution-worker.ts`
- optional worker bootstrap/wiring module

### Prompt to paste into Codex for Session 11

```text
[Paste the Global Rules block first]

Current session objective:
Add a local execution worker skeleton that listens for runtime events, but do not switch the main scheduler path to it yet.

Tasks:
1. Create `LocalExecutionWorker`.
2. Subscribe it to `task.ready`.
3. Have it emit `execution.started`, `execution.completed`, and `execution.failed`.
4. Reuse the current execution boundary/adapter rather than duplicating execution logic.
5. Add minimal runtime wiring so the worker can be started in-process.

Constraints:
- scheduler still keeps current direct execution path
- no feature flag switch yet
- no removal of old logic
- no tool worker extraction yet
- no conversation worker extraction yet

Deliverables:
- worker skeleton added
- event mapping implemented
- minimal runtime wiring added
- short validation plan
```

### Expected commit

```bash
git add .
git commit -m "feat: add local execution worker skeleton"
```

---

## Session 12 — Add execution mode feature flag

### Session goal

Prepare safe dual-path execution.

Scheduler must be able to run in either:

- direct mode
- evented mode

### What this session must do

Add config flag, for example:

- `runtime.executionMode = "direct" | "evented"`

or equivalent location in existing config structure.

### Required behavior

- `direct` keeps old behavior
- `evented` causes scheduler to publish `task.ready` instead of directly invoking execution
- if evented mode is not fully wired, fail clearly rather than silently

### Prompt to paste into Codex for Session 12

```text
[Paste the Global Rules block first]

Current session objective:
Introduce a safe execution mode feature flag so the runtime can switch between direct scheduler execution and event-driven execution.

Tasks:
1. Add config support for `executionMode` with values `direct` and `evented`.
2. Wire scheduler execution startup to branch based on this mode.
3. In direct mode, preserve the old path exactly.
4. In evented mode, prepare the path to publish `task.ready`.
5. Keep the system buildable and safe.

Constraints:
- do not fully remove direct execution
- do not change execution semantics yet
- do not redesign config broadly
- keep defaults backward compatible

Deliverables:
- config wiring for execution mode
- scheduler branch in place
- summary of exact default behavior
- validation steps for both modes
```

### Expected commit

```bash
git add .
git commit -m "feat: add execution mode switch for scheduler"
```

---

## Session 13 — Switch scheduler evented path to publish `task.ready`

### Session goal

This is the first real boundary cut.

In `evented` mode, `SchedulerCore` must stop directly invoking execution.

Instead it should:

- prepare execution state
- create/update run metadata as needed
- publish `task.ready`

Then `LocalExecutionWorker` performs the actual execution.

### What this session must do

Change only the `evented` mode path.

Direct mode must remain intact.

### Required outcome

In evented mode:

- scheduler publishes `task.ready`
- worker receives event
- worker emits execution result events
- runtime remains functional

### Prompt to paste into Codex for Session 13

```text
[Paste the Global Rules block first]

Current session objective:
Activate the evented execution path.

Tasks:
1. Update SchedulerCore so that in `evented` mode it does not directly call the execution adapter.
2. Instead publish a `task.ready` runtime event with the minimum execution payload needed by the worker.
3. Ensure `LocalExecutionWorker` consumes that event and performs execution.
4. Keep `direct` mode fully working.
5. Preserve existing repository state updates as much as possible.

Constraints:
- do not redesign the entire scheduler
- do not remove direct mode
- do not extract tool execution yet
- do not change gateway or IPC protocol
- do not broaden scope into conversation flows

Deliverables:
- evented scheduler path active
- worker-driven execution active in evented mode
- explicit summary of which files own execution start vs execution run vs execution completion
- validation steps for direct mode and evented mode
```

### Expected commit

```bash
git add .
git commit -m "refactor: route evented scheduler execution through local worker"
```

---

## Session 14 — Execution completion handling cleanup

### Session goal

Now that evented execution exists, clean up the return path.

The key task is to define clearly how `execution.completed` and `execution.failed` are handled.

### What this session must do

Introduce a clear completion-handling flow.

This may be a dedicated handler/component such as:

- `ExecutionResultHandler`
- `ExecutionCompletionCoordinator`
- or equivalent

Responsibilities:

- consume `execution.completed`
- consume `execution.failed`
- update run / task / goal state as needed
- trigger verification / quality gate as appropriate
- emit follow-up events consistently

### Important

This session is about **clarity and ownership**.

Today some of this likely still lives in scheduler-centered logic.

The goal is not perfection; the goal is to establish a visible completion boundary.

### Prompt to paste into Codex for Session 14

```text
[Paste the Global Rules block first]

Current session objective:
Clean up the execution completion return path so evented execution has a clear result-handling boundary.

Tasks:
1. Identify where execution-completed and execution-failed handling currently lives.
2. Introduce a dedicated result-handling component or clearly bounded handler flow.
3. Route `execution.completed` and `execution.failed` through that boundary.
4. Preserve existing verification / quality-gate behavior.
5. Keep direct mode functioning.

Constraints:
- do not attempt tool worker extraction yet
- do not attempt conversation worker extraction yet
- do not remove existing verification behavior unless moved intact
- do not do a broad cleanup outside this boundary

Deliverables:
- clear execution completion handling boundary
- event-driven result handling path documented in code comments or docs
- summary of ownership after this change
- validation steps
```

### Expected commit

```bash
git add .
git commit -m "refactor: establish execution completion handling boundary"
```

---

## Recommended validation after each session

Run the smallest useful checks after every session.

At minimum:

```bash
pnpm build
pnpm test
```

If your repo uses different commands, substitute your real ones.

Runtime checks after Sessions 11–14:

```bash
pb service start all
pb events tail
pb work "test runtime execution"
```

If execution mode is configurable, test both:

```bash
# direct mode
pb work "test direct mode"

# evented mode
pb work "test evented mode"
```

Also verify:

- goals still materialize
- runs still persist
- runtime events still persist
- no duplicate execution occurs in evented mode
- no silent task stall occurs when worker is active

---

## What not to do yet

Do not attempt these in Sessions 9–14:

- full ToolWorker extraction
- full ConversationWorker extraction
- multi-process worker model
- repo split
- NATS / Redis / RabbitMQ
- large-scale import-cycle cleanup
- replacing all singletons at once

These come later.

---

## Exit criteria for Sessions 9–14

At the end of Session 14, Phase 2B should be considered successful if all of the following are true:

1. `SchedulerCore` has a visible execution boundary abstraction.
2. A local execution worker exists.
3. Evented execution mode exists.
4. In evented mode, scheduler publishes `task.ready` instead of directly invoking execution.
5. Execution results come back through an explicit handling path.
6. Direct mode still works.
7. Existing runtime functionality still basically works.

If all seven are true, you are ready for the next stage:

> Phase 2C — Tool Boundary Extraction

