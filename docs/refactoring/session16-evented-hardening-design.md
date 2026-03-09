# Session 16: Evented Execution Hardening Design

## Session scope

This session is documentation-only.

It does not change:

- gateway behavior
- IPC behavior
- direct vs evented execution mode semantics
- tool worker architecture
- conversation worker architecture
- recovery, reconciliation, or restart implementation

It analyzes the current evented execution path after Sessions 10-15 and defines the minimum hardening work required before evented mode could reasonably become the default.

## Current execution topology

In evented mode today, the scheduler still owns dispatch setup and post-result continuation, but it no longer executes the work item inline:

1. `SchedulerCore.startWorkItemExecution(...)` creates a durable `runs` row, marks the work item `in_progress`, increments lane occupancy, and stores an in-memory execution context in `activeExecutions` ([src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L432), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L469), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L476)).
2. In evented mode, the scheduler publishes `task.ready` onto the runtime event bus instead of calling `ExecutionPort.execute(...)` directly ([src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L517), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L541)).
3. `LocalExecutionWorker` subscribes to `task.ready`, suppresses duplicate `runId`s only within its own process lifetime, executes the request, and publishes `execution.completed` or `execution.failed` ([src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts#L27), [src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts#L45), [src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts#L62), [src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts#L133)).
4. `SchedulerCore` subscribes to the same runtime bus and treats `execution.completed` / `execution.failed` as the authoritative result signals in evented mode, correlating them only through `activeExecutions[runId]` ([src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L585), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L595), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L610)).
5. After a result is accepted, the scheduler completes the `runs` row, releases lane occupancy, and continues through the existing scheduler-owned success/failure continuation ([src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L784), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L850)).

Important current boundary:

- the runtime bus is a process-local `MemoryEventBus` singleton, not a durable queue ([src/runtime/event-bus/memory-event-bus.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/event-bus/memory-event-bus.ts#L10), [src/runtime/event-bus/runtime-event-bus.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/event-bus/runtime-event-bus.ts#L1))
- the scheduler daemon starts the worker and scheduler in the same process using that local bus ([src/scheduler-daemon/daemon.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts#L204))

## Authoritative state holders today

### Run lifecycle

Authoritative durable state holder:

- `runs` table, especially `status`, `completed_at`, usage, and error fields ([src/infra/persistence/schema.sql](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/schema.sql#L94), [src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts#L505), [src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts#L551))

Operational owner during in-flight execution:

- `SchedulerCore.activeExecutions`, keyed by `runId` ([src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L56), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L469))

### Work item lifecycle

Authoritative durable state holder:

- `work_items.status` in SQLite ([src/infra/persistence/schema.sql](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/schema.sql#L50), [src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts#L454))

Transition logic owner:

- `WorkItemManager.updateStatus(...)` validates transitions, but the final persisted truth is still the `work_items` row ([src/scheduler/work-item-manager/work-item-manager.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/work-item-manager/work-item-manager.ts#L107))

### Lane occupancy

Authoritative runtime holder:

- `LaneSelector.statuses[laneId].activeCount` in memory ([src/scheduler/lane-selector/lane-selector.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/lane-selector/lane-selector.ts#L13), [src/scheduler/lane-selector/lane-selector.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/lane-selector/lane-selector.ts#L221))

Mirrored scheduler view:

- `SchedulerState.lanes[*].isAvailable` is derived from lane selector capacity, not an independent durable source ([src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L73), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L943))

There is no durable lane occupancy record.

### Active execution tracking

Authoritative holder:

- `SchedulerCore.activeExecutions`

This is the only place that currently binds together:

- `runId`
- work item
- goal
- selected lane
- selected model
- execution start timestamp

If it is lost, scheduler-side result correlation is lost with it.

### Retry / escalation continuation

Authoritative durable outputs:

- work item status updates (`queued`, `blocked`, `failed`)
- escalation rows when created
- run completion row state

Authoritative continuation logic:

- scheduler-owned `continueAfterExecutionResult(...)`
- `handleExecutionSuccess(...)`
- `handleExecutionFailure(...)`

([src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L784), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L862), [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L929))

The durable result of that continuation is reconstructable only partially from database rows; the fact that a particular in-flight run still needs continuation is not durably marked today.

## Durability and reconstructability matrix

### Durable

- `goals` row status and spending ([src/infra/persistence/schema.sql](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/schema.sql#L9))
- `work_items` row status ([src/infra/persistence/schema.sql](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/schema.sql#L50))
- `runs` row creation and completion state ([src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts#L505), [src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts#L551))
- escalations once created

### In-memory only

- runtime event delivery on `MemoryEventBus`
- `SchedulerCore.activeExecutions`
- `SchedulerCore.goalStates`
- `LaneSelector` active counts and availability
- `LocalExecutionWorker.processedRunIds`
- any subscriber progress between publish and consume

### Eventually reconstructable

- a likely orphaned execution can be inferred from `runs.status = "running"` together with `work_items.status = "in_progress"`
- a likely lane can often be inferred from run context or work item/goal lane-selection inputs, but not with hard certainty unless the selected lane was persisted in run context for that run
- some recent runtime events can be reconstructed only if they were actually persisted into `runtime_events`

### Not reconstructable after restart

- whether a published `task.ready` was delivered to a worker
- whether a worker finished after the scheduler lost `activeExecutions`
- exact in-flight lane occupancy counts
- whether a result event was already consumed but continuation failed mid-way before all durable writes completed
- duplicate-suppression memory in `LocalExecutionWorker.processedRunIds`

## Failure analysis

### A. Missed result event

Scenario:

- worker emits `execution.completed` or `execution.failed`
- scheduler does not consume it

Possible causes:

- subscriber was absent because the scheduler restarted or stopped
- event bus delivery failed because this is in-memory only
- scheduler consumed neither result because `activeExecutions` no longer held the `runId`
- result was emitted after the scheduler daemon process crashed

Current consequences:

- `runs.status` remains `running`
- `work_items.status` remains `in_progress`
- lane occupancy stays incremented until process exit, or is lost silently on restart
- retry/escalation continuation never runs
- verification never runs on success
- the system has no current reconciliation pass to notice the orphaned run

Current detection ability:

- only indirect, by later inspecting a stuck `running` run / `in_progress` work item
- not through authoritative event replay

Why this is serious:

- evented mode currently treats the result event as authoritative for continuation, but delivery is not durable and correlation depends on volatile `activeExecutions`

### B. Scheduler / daemon restart during in-flight execution

What in-memory state is lost:

- `activeExecutions`
- lane selector active counts
- goal execution state
- worker duplicate-suppression memory
- runtime bus subscriptions and any not-yet-delivered events

What durable state remains:

- `runs` row with `status = "running"`
- `work_items.status = "in_progress"`
- goal row and prior spending
- possibly selected model in `runs.context`

What inconsistencies can appear:

- worker may have already finished, but the scheduler no longer knows that
- worker may still be executing, but the restarted scheduler has no attachment to it
- a restarted scheduler can see durable `running` / `in_progress` state but cannot tell whether the work is truly live, already finished, or permanently lost
- lane occupancy is reset to zero after restart even though a run may still exist externally or logically

Current behavior:

- there is no startup reconciliation for `runs.status = "running"` or `work_items.status = "in_progress"`
- no scheduler-side reattachment exists
- no timeout-based orphan handling exists

### C. Worker restart or worker crash during execution

Current worker behavior:

- `LocalExecutionWorker` suppresses duplicate `task.ready` only with an in-memory `processedRunIds` set ([src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts#L30), [src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts#L62))
- it does not persist an accepted/started marker before execution
- it does not persist a completed marker

If the worker crashes before publishing a result:

- the run can become orphaned
- the scheduler keeps waiting indefinitely unless the whole daemon exits, in which case the in-memory wait state disappears too
- durable state still says `running` / `in_progress`

If the worker process restarts and `task.ready` is not republished:

- the run remains orphaned forever under current logic

If `task.ready` is later redelivered after a worker restart:

- the worker may execute the same run again because duplicate suppression did not survive restart

So yes, current runs and work items can become orphaned.

### D. Duplicate delivery

#### `task.ready` published more than once

Current assumptions:

- duplicate suppression is best-effort only and local to one worker process lifetime
- there is no durable claim or accepted marker for a run

Consequences:

- same run may be executed more than once after restart, republish, or multiple workers on the same bus
- duplicate result events could be produced

#### `execution.completed` / `execution.failed` processed more than once

Current assumptions:

- scheduler treats `activeExecutions[runId]` presence as the main guard
- once `continueAfterExecutionResult(...)` runs with `cleanupBeforeContinuation: true`, `cleanupExecutionContext(...)` removes the `runId`, so a later duplicate result for the same run is ignored because correlation fails

This gives some accidental idempotency, but only while:

- the first processing path reached cleanup
- the process did not restart beforehand

Missing idempotency guarantees:

- no durable “result already applied” marker on the run
- `completeRun(...)` is a plain update, not a guarded compare-and-set
- no check that a terminal run should reject later result application

Net assessment:

- duplicate result handling is partially benign in-process, but not robust enough to be considered an intentional idempotency design

### E. `runtime_events` vs authoritative scheduler state

What `runtime_events` can currently be trusted for:

- inspection and audit only, when the relevant process actually attached a `RuntimeEventStore`
- CLI tail/replay against persisted events already written

What `runtime_events` cannot currently be trusted for:

- authoritative recovery of scheduler-daemon evented execution
- proof that a scheduler consumed a worker result
- proof that a worker accepted a `task.ready`
- proof that a result event even existed if it was emitted only on the scheduler daemon’s local runtime bus

Important current limitation:

- `RuntimeEventStore` is attached in the gateway process on the gateway’s local runtime bus ([src/gateway/gateway-server.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/gateway-server.ts#L418), [src/gateway/gateway-server.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/gateway-server.ts#L696))
- the scheduler daemon starts evented execution on its own process-local runtime bus and does not attach a `RuntimeEventStore` there ([src/scheduler-daemon/daemon.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts#L204))

That means the evented scheduler/worker spine is not currently producing a durable scheduler-daemon event log through `runtime_events`.

Conclusion:

- `runtime_events` is audit-only today
- it is not recovery-capable for evented execution in the current topology

Additional invariants required before `runtime_events` could support recovery use:

- the evented scheduler/worker path must durably persist the relevant runtime events from the scheduler daemon process
- event persistence must be complete enough to cover at least `task.ready`, worker start/acceptance, and worker result
- recovery logic must know which persisted event transitions are authoritative versus informational
- event persistence must have a monotonic correlation story per `runId`
- the scheduler must durably mark when result continuation was applied, not merely when a result event existed

## Main reliability gaps

1. Authoritative result handling depends on volatile event delivery and volatile `activeExecutions`.
2. There is no startup reconciliation for `running` runs or `in_progress` work items.
3. Worker duplicate suppression is not restart-safe.
4. Lane occupancy is purely in-memory and silently resets after restart.
5. `runtime_events` does not currently provide a durable event spine for the scheduler-daemon evented path.
6. No timeout or reattachment policy exists for in-flight evented executions.

## Minimal hardening roadmap

The goal here is not a broad redesign. It is the smallest ordered set of hardening steps that makes evented mode survivable enough to consider as a future default.

### Step 1: Startup reconciliation scan for orphaned evented runs

Purpose:

- detect runs left in `running` and work items left in `in_progress` at scheduler-daemon startup
- classify them as needing reattachment, timeout waiting, or recovery handling

Likely code areas:

- [src/scheduler-daemon/daemon.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts)
- [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts)
- repository queries in [src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts)

Risk level:

- medium

Before evented mode can be production-ready:

- yes

Notes:

- the first version can be detection-only plus explicit classification, without attempting aggressive automatic recovery
- this is the minimum visibility layer for every other hardening step

### Step 2: Durable in-flight marker / checkpoint for scheduler-owned evented dispatch

Purpose:

- make it durable that a run entered evented dispatch and still awaits authoritative result continuation
- avoid relying solely on `activeExecutions`

Likely code areas:

- `runs.context` usage in [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L434)
- [src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts)

Risk level:

- medium

Before evented mode can be production-ready:

- yes

Notes:

- this does not require changing execution semantics
- a minimal checkpoint could record evented dispatch state, selected lane, and whether result continuation has been applied

### Step 3: Worker-result idempotency guard on the scheduler side

Purpose:

- ensure duplicate `execution.completed` / `execution.failed` cannot reapply completion after restart or partial progress

Likely code areas:

- [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts#L610)
- [src/infra/persistence/work-order-repository.ts](/Users/nickma/Develop/nick-ma/pony/src/infra/persistence/work-order-repository.ts#L551)

Risk level:

- low to medium

Before evented mode can be production-ready:

- yes

Notes:

- the durable guard should be based on run terminality or an explicit “result applied” marker, not only on `activeExecutions`

### Step 4: Scheduler-side in-flight timeout handling

Purpose:

- stop indefinite hangs when a worker result never arrives
- give reconciliation a safe policy boundary for orphaned runs

Likely code areas:

- [src/scheduler-daemon/daemon.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts)
- [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts)
- possibly monitoring helpers already concerned with stuck `in_progress` items

Risk level:

- medium

Before evented mode can be production-ready:

- yes

Notes:

- the first version can be conservative: detect and surface timed-out in-flight runs, then move them into a scheduler-owned failure/recovery queue rather than silently retrying

### Step 5: Worker acceptance / duplicate-execution guard

Purpose:

- prevent the same `runId` from executing twice across worker restart or duplicate `task.ready` delivery

Likely code areas:

- [src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts)
- repository persistence surface if a durable claim marker is added

Risk level:

- medium

Before evented mode can be production-ready:

- yes

Notes:

- this is the minimal idempotency counterpart to Step 3
- without it, any future republish or reconciliation path risks duplicate execution

### Step 6: Durable scheduler-daemon runtime event persistence for the evented spine

Purpose:

- make `task.ready`, worker-start, and worker-result events available for audit and future recovery tooling

Likely code areas:

- scheduler-daemon startup wiring
- [src/runtime/event-bus/runtime-event-store.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/event-bus/runtime-event-store.ts)

Risk level:

- medium

Before evented mode can be production-ready:

- recommended but not strictly the first blocker if Steps 1-5 add direct durable checkpoints

Notes:

- this is highly valuable, but evented default does not have to wait for full replay-driven recovery if run-level checkpoints already make orphan detection and idempotent result application reliable

### Step 7: Reattachment logic for clearly recoverable in-flight executions

Purpose:

- allow a restarted scheduler to resume waiting on a still-live execution instead of pessimistically failing everything

Likely code areas:

- scheduler-daemon startup / scheduler bootstrap
- active execution reconstruction in scheduler core

Risk level:

- high

Before evented mode can be production-ready:

- not necessarily

Notes:

- this is useful but more complex than orphan detection plus timeout handling
- it can wait if the system can safely detect ambiguous in-flight runs and route them into conservative failure handling

## Minimum pre-default hardening set

Before evented mode could reasonably become the default, the minimum set is:

1. startup reconciliation scan for orphaned `running` runs / `in_progress` work items
2. durable evented in-flight checkpoint on the run
3. scheduler-side durable idempotency guard for worker results
4. worker-side durable duplicate-execution guard for `task.ready`
5. scheduler-side timeout/orphan handling for runs that never produce a consumable result

Why this is the minimum:

- together, these steps make missed result events and restarts survivable
- they do not require changing gateway behavior, IPC, or execution mode semantics
- they allow the system to prefer conservative recovery decisions over silent indefinite hangs

## What can wait until later

These should not block evented mode from eventually becoming the default if the minimum set above is already in place:

- full runtime-event replay-based recovery
- scheduler reattachment to truly live external executions
- broader lane-state persistence beyond what is needed for safe restart
- broader cancellation/abort redesign outside the current active execution window
- worker extraction or broader multi-worker topology changes

## Recommended next implementation session

The single best next coding step is:

- implement startup reconciliation for evented in-flight runs, backed by a minimal durable run checkpoint

Why this is the best next step:

- it directly addresses the largest operational gap: orphaned `running` / `in_progress` state after restart or missed result delivery
- it creates the durable basis needed for later timeout handling and idempotent result application
- it stays within current architecture and does not require gateway or IPC changes

Recommended concrete target for the next session:

1. add a narrow repository query for non-terminal runs that still look evented/in-flight
2. add a scheduler-daemon startup reconciliation pass that inspects those runs
3. classify each run into clear buckets such as `reattachable`, `timed_out_or_orphaned`, or `awaiting_policy`
4. do not yet implement automatic retry or replay; only establish durable detection and scheduler-visible handling boundaries

## Final assessment

Evented mode is functional, but it is not restart-safe and not delivery-safe enough to become the default yet.

The central issue is not raw execution correctness. It is missing ownership continuity across failures:

- scheduler continuation authority currently depends on volatile in-memory correlation
- worker deduplication currently depends on volatile in-memory memory
- runtime event persistence is not wired to the scheduler-daemon evented spine

That is why the next work should focus on reconciliation, durable checkpoints, and idempotency guards before any broader recovery or replay implementation.
