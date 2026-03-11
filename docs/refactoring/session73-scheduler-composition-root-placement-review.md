# Session 73: Scheduler Composition-Root Placement Review

## Scope

This session is design/documentation only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution/recovery
- redesign `ToolWorker`
- redesign `ConversationWorker`
- redesign provider-selection, endpoint health, or fallback semantics
- redesign streaming callback semantics
- perform broad module moves or renames

The goal is to identify the single highest-value remaining `RF-034` target after Session 72 extracted the default conversation bootstrap boundary from `SchedulerSessionIntake`.

## Current Post-Session-72 State

Session 72 removed the biggest live scheduler-side conversation bootstrap knot from [`src/scheduler-daemon/session-intake.ts`](../../src/scheduler-daemon/session-intake.ts) by introducing [`src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`](../../src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts).

That leaves the main remaining `RF-034` pressure in the scheduler composition-root area:

- [`src/scheduler-daemon/daemon.ts`](../../src/scheduler-daemon/daemon.ts) still constructs scheduler-local execution worker state and then imports `createScheduler(...)` from [`src/gateway/integration/scheduler-factory.ts`](../../src/gateway/integration/scheduler-factory.ts)
- [`src/cli/commands/scheduler-daemon.ts`](../../src/cli/commands/scheduler-daemon.ts) also imports the same gateway-named factory for replay/local scheduler assembly
- the factory itself still assembles a wide scheduler graph: repository adapter, execution-port defaulting, runtime event bus defaulting, model/lane/budget/retry services, work-item manager, escalation handler, and quality-gate wiring

## Is The Gateway-Named Scheduler Factory Area Now The Best Next Target?

Yes.

After Session 72, the currently gateway-named scheduler factory area is now the single highest-value remaining `RF-034` target because it is the clearest still-live composition-root placement mismatch that also creates a real dependency-direction smell on active scheduler-owned entry paths.

The relevant current code is:

- [`src/scheduler-daemon/daemon.ts:18`](../../src/scheduler-daemon/daemon.ts#L18)
- [`src/scheduler-daemon/daemon.ts:196`](../../src/scheduler-daemon/daemon.ts#L196)
- [`src/cli/commands/scheduler-daemon.ts:17`](../../src/cli/commands/scheduler-daemon.ts#L17)
- [`src/cli/commands/scheduler-daemon.ts:608`](../../src/cli/commands/scheduler-daemon.ts#L608)
- [`src/gateway/integration/scheduler-factory.ts:58`](../../src/gateway/integration/scheduler-factory.ts#L58)
- [`src/gateway/index.ts:64`](../../src/gateway/index.ts#L64)

This target is now higher value than reopening `SchedulerSessionIntake`, because the intake-side conversation bootstrap pressure has already been narrowed behind the extracted scheduler-owned boundary from Session 72.

## The Exact Narrow Problem

The narrow problem is not one vague "layering issue." It is four separate things that currently overlap in one place.

### 1. Naming And Placement Problem

`createScheduler(...)` lives under `src/gateway/integration/` and is re-exported from `src/gateway/index.ts`, but its actual job is scheduler-core composition for scheduler-owned entry points.

That is now a code-placement mismatch:

- the scheduler daemon is the active runtime consumer
- the scheduler replay CLI is another active runtime consumer
- the factory is not actually performing gateway transport integration work

This is a real naming/placement problem even if behavior stays correct.

### 2. Actual Dependency-Direction Problem

There is also a real dependency-direction smell, not just bad naming.

`SchedulerDaemon` and the scheduler CLI currently depend on a gateway-named module to assemble scheduler-local core state:

- `src/scheduler-daemon/daemon.ts` imports `../gateway/integration/scheduler-factory.js`
- `src/cli/commands/scheduler-daemon.ts` imports `../../gateway/integration/scheduler-factory.js`

This is not a literal import cycle in the reviewed files, and it is not the same class of bug as the Session 70 `infra -> gateway` stream-publication back-edge.

But it is still a true ownership-direction inversion:

- scheduler-owned composition is placed under a gateway namespace
- scheduler-owned runtime entry points must reach "up" through that namespace to build their own core

So the problem is:

- not a true import cycle
- yes a true dependency-direction smell

### 3. Constructor And Composition Pressure

The same file also remains a non-trivial constructor/composition hub.

`src/gateway/integration/scheduler-factory.ts` currently:

- creates a `SchedulerRepositoryAdapter`
- defaults `executionPort` by constructing `LocalExecutionAdapter`
- defaults `runtimeEventBus` to the process-global `runtimeEventBus`
- constructs `ModelSelector`, `LaneSelector`, `BudgetTracker`, and scheduler `RetryHandler`
- builds inline repository adapter shapes for `WorkItemManager` and `EscalationHandler`
- constructs `QualityGateRunner`, `DefaultCommandExecutor`, and an `ILLMReviewer` adapter
- assembles the full `SchedulerDependencies` object
- normalizes the final `SchedulerConfig`

That is still a meaningful composition-pressure knot, even if the logic is understandable and currently stable.

### 4. What This Is Not

This is not primarily:

- a transport ownership bug
- a worker seam bug
- an execution/recovery redesign bug

Those lines should remain closed in this session.

## Why This Matters Architecturally Now

This matters now because Session 72 removed the more immediate conversation-bootstrap pressure point, so the next highest-value `RF-034` step should address the remaining active composition-root mismatch rather than casually reopening already-stabilized seams.

If left untouched, this area keeps sending the wrong architectural signal:

- scheduler composition still appears gateway-owned in module layout
- scheduler-local entry points keep depending on gateway placement for their own core assembly
- later gateway/daemon seam cleanup becomes easier to broaden accidentally, because code placement and runtime ownership are still misaligned

The practical risk is not that behavior is currently broken. The risk is that later narrow work becomes harder to keep narrow because composition-root ownership is still encoded in the wrong namespace.

## What Established Seam Or Invariant It Could Threaten If Left Untouched

If this remains the default composition location, the main thing it threatens is not a worker seam directly. It threatens the ability to preserve outer ownership lines cleanly during future cleanup.

Specifically, it could pressure:

- outer transport ownership lines, because future daemon/gateway cleanup will keep encountering scheduler-core assembly under a gateway path
- durable ownership lines, because composition-root cleanup can become entangled with storage/lifecycle choices if the assembly home stays ambiguous
- scheduler-owned run identity and execution/recovery invariants, because future changes near scheduler construction are more likely to widen into execution wiring changes when the root is still a large mixed composition site

This is a containment problem more than an active behavior defect.

## Distinguishing The Problem Categories

### Naming/Placement Problems

- `src/gateway/integration/scheduler-factory.ts` is named and placed as gateway integration code
- active consumers are scheduler-owned runtime entry points
- `src/gateway/index.ts` re-exports scheduler composition as gateway surface

### Actual Dependency-Direction Problems

- `SchedulerDaemon` depends on a gateway-named factory for scheduler-core assembly
- the scheduler CLI depends on the same gateway-named factory
- this is a real dependency-direction inversion even though it is not a literal import cycle

### Constructor/Composition Pressure

- the factory still owns a wide set of default scheduler collaborator construction
- it also hides lifecycle defaults like `runtimeEventBus` and `LocalExecutionAdapter`
- that means later changes are still likely to accrete in this one file

### Transport Ownership Issues

Transport ownership is adjacent, but it is not the immediate thing to change next.

The current problem is not that `createScheduler(...)` publishes IPC messages or owns gateway routing. It does not.

The real transport risk is indirect:

- future transport cleanup could get mixed into scheduler composition cleanup because the composition root is under a gateway namespace

That means transport ownership is a threatened invariant here, not the immediate extraction target.

### Worker Seam Issues

This area does not currently justify reopening worker seams.

The factory composes scheduler support services and execution-port defaults, but it does not show a new narrow problem statement in:

- `ToolWorker`
- `ConversationWorker`
- the extracted conversation bootstrap boundary

Those seams should remain untouched.

## What Should Explicitly Stay Closed

The following stabilized lines should not be casually reopened by `RF-034` from this point:

### RF-033 Execution/Runtime Line

Sessions 60-68 already closed the execution/runtime import-pressure line as stable enough to pause. The remaining scheduler composition-root issue is above that seam, not a reason to reopen `ExecutionService`, `ExecutionRunner`, or runtime-cycle ownership.

### ToolWorker Seam

The local-authoritative `ToolWorker` line was already paused as stable enough in Session 45. There is no new tool-dispatch problem statement here; the current issue is scheduler composition-root placement.

### ConversationWorker Seam

The local-authoritative `ConversationWorker` line was already paused as stable enough in Session 53. Session 72 extracted the conversation bootstrap above it, so reopening the worker itself would blur a clean boundary that was just stabilized.

### LLM Stream Event Sink Boundary

Session 70 already removed the concrete provider-manager streaming back-edge with `LLMStreamEventSink`. Nothing in the current scheduler-factory pressure requires reopening that sink boundary.

### Extracted Conversation Bootstrap Boundary

Session 72 just moved default conversation graph assembly behind [`src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`](../../src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts). Reopening that boundary immediately would be churn unless a new narrow problem statement appears inside that bootstrap path itself. The current highest-value remaining pressure is elsewhere.

## Single Highest-Value First RF-034 Target Now

The single highest-value first `RF-034` target now is:

the scheduler composition-root placement mismatch centered on [`src/gateway/integration/scheduler-factory.ts`](../../src/gateway/integration/scheduler-factory.ts) and its use by scheduler-owned entry points.

Why this one should be first:

- it is now the clearest remaining live ownership-direction smell after Session 72
- it affects active scheduler-owned composition roots in both daemon and scheduler CLI paths
- it can be addressed narrowly without reopening worker seams, transport behavior, or execution/recovery semantics
- it reduces the chance that later gateway/daemon seam work widens into a mixed transport/composition rewrite

## Safest First Cleanup Model

The safest first cleanup model is:

introduce a scheduler-owned scheduler-composition boundary and reduce the gateway-named file to a compatibility shim or wrapper.

### Boundary To Introduce, Tighten, Rename, Or Reposition

Introduce one narrow scheduler-owned composition entry point in a scheduler-owned namespace, for example under:

- `src/scheduler-daemon/...`
- or `src/scheduler/...`

Its responsibility should be only:

- compose the default `SchedulerCore` dependency graph
- normalize config defaults
- return the assembled `SchedulerCore`

The key design point is ownership and placement, not a behavior rewrite.

### What Should Be Extracted

Extract only the scheduler-core composition responsibility currently in `createScheduler(...)`:

- scheduler support service construction
- scheduler dependency-object assembly
- config normalization for the scheduler core

This is the narrowest practical cleanup because it moves the composition root without reopening runtime behavior.

### What Should Stay In Place

Keep these concrete collaborators and semantics unchanged in the first cleanup:

- `SchedulerRepositoryAdapter`
- `LocalExecutionAdapter` defaulting behavior
- `runtimeEventBus` defaulting behavior
- `WorkItemManager` and `EscalationHandler` adapter shapes
- `QualityGateRunner` assembly behavior
- scheduler config defaults and semantics
- daemon-owned `LocalExecutionWorker` startup in `SchedulerDaemon`
- replay CLI use of the same scheduler composition behavior

### What Should Not Be Touched Yet

- no scheduler behavior changes
- no IPC or gateway event changes
- no execution-mode redesign
- no event-bus ownership migration
- no replay workflow redesign
- no `SchedulerSessionIntake` semantic reopening
- no broad `gateway/integration` namespace cleanup
- no broad file renames or multi-module moves

## Invariants That Must Be Preserved

Any Session 74 cleanup should explicitly preserve:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` local-authoritative seam invariants
- `ConversationWorker` local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `LLMStreamEventSink` ownership direction
- extracted conversation bootstrap ownership
- outer transport ownership lines
- durable ownership lines

Concretely, that means:

- `SchedulerDaemon` still owns daemon startup, IPC attachment, event forwarding, and worker startup
- `SchedulerTaskBridge` remains scheduler-authoritative for goal/work-item materialization
- `SchedulerSessionIntake` remains the outer conversation facade
- `ConversationWorker` remains the local-authoritative message seam
- `LocalToolWorker` remains the local-authoritative tool seam
- no change to direct vs evented result semantics
- no change to persistence authority or durable run-event ownership

## Recommended Session 74

Session 74 should be one narrow coding session that introduces a scheduler-owned scheduler-composition entry point and makes the current gateway-named scheduler factory a compatibility wrapper.

Brief rationale:

- it addresses the highest-value remaining live ownership-direction smell
- it is narrow enough to preserve behavior
- it avoids reopening transport, worker, and execution/recovery lines
- it prepares later RF-034 cleanup by aligning code placement with actual scheduler ownership

## What RF-034 Should Not Do Next

The next step should not become any of the following:

- a broad scheduler-factory rewrite that also changes collaborator behavior
- transport ownership migration between gateway and daemon
- broad namespace or module relocation across `src/gateway`, `src/scheduler-daemon`, and `src/scheduler`
- worker seam redesign
- reopening `SchedulerSessionIntake` semantics after Session 72
- reopening the extracted conversation bootstrap boundary without a new narrow problem statement
- reopening the `LLMStreamEventSink` line
- reopening the RF-033 execution/runtime line
- changing replay CLI behavior while touching scheduler composition placement
- changing `runtimeEventBus` ownership in the same step

Those are tempting because the target sits near process-boundary and lifecycle concerns, but they would broaden scope beyond the narrow composition-root placement problem actually identified in the current codebase.

## Short Roadmap For The Next RF-034 Sub-Phase

1. Introduce one scheduler-owned scheduler-composition entry point and route daemon/CLI call sites through it while preserving the current gateway-named export as a shim.
2. Reassess whether the remaining pressure is then only naming/placement debt or whether one smaller hidden lifecycle default still needs isolation.
3. Only after that reassessment, decide whether a second narrow cleanup is justified around scheduler composition defaults such as event-bus ownership or adapter placement.

## Summary

After Session 72, the best next `RF-034` target is no longer conversation bootstrap. It is the scheduler composition-root placement mismatch around the currently gateway-named scheduler factory.

The key distinction is:

- yes, there is a naming/placement problem
- yes, there is a real dependency-direction smell
- yes, there is still constructor/composition pressure
- no, this is not yet a transport migration task
- no, this is not a worker-seam redesign task

The safest next move is therefore a narrow scheduler-owned composition-root extraction with a compatibility shim, not a broad scheduler-factory rewrite.
