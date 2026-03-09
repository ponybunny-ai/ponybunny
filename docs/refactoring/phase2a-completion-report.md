# Phase 2A Completion Report

## Scope

This report documents the current code state after Phase 2A.

Phase 2A delivered a runtime event spine, persistence for mirrored runtime events, and basic CLI inspection surfaces. It did not yet extract the execution boundary.

## What Phase 2A Added

### 1. Runtime event bus modules

Phase 2A introduced a dedicated runtime event layer in `src/runtime/event-bus/`:

- `src/runtime/event-bus/runtime-event.ts`
- `src/runtime/event-bus/event-bus.ts`
- `src/runtime/event-bus/memory-event-bus.ts`
- `src/runtime/event-bus/runtime-event-bus.ts`
- `src/runtime/event-bus/index.ts`

This created a temporary in-process `runtimeEventBus` singleton and a normalized `RuntimeEvent` envelope with `goalId`, `taskId`, `runId`, `source`, `timestamp`, and `payload`.

### 2. Adapters added

Phase 2A added three mirror adapters:

- `src/runtime/event-bus/adapters/gateway-event-adapter.ts`
- `src/runtime/event-bus/adapters/scheduler-event-adapter.ts`
- `src/runtime/event-bus/adapters/debug-event-adapter.ts`

The adapters are wired in `src/gateway/gateway-server.ts` and start alongside the gateway runtime. Runtime event persistence is attached in the same file through `attachRuntimeEventStore(runtimeEventBus, this.runtimeEventStore)` and backed by `RuntimeEventStore` in `src/runtime/event-bus/runtime-event-store.ts`.

### 3. Runtime event persistence

Phase 2A added SQLite-backed runtime event persistence:

- `src/runtime/event-bus/runtime-event-store.ts`
- `runtime_events` table in `src/infra/persistence/schema.sql`

Persistence is intentionally buffered off the publish stack with `setImmediate` so mirrored events do not synchronously slow adapter publishers.

### 4. CLI commands added

Phase 2A added the first inspection surfaces in `src/cli/commands/events.ts`:

- `pb events tail`
- `pb events replay <goalId>`

`tail` reads persisted events and also subscribes to the in-process runtime bus when available. `replay` is inspection-only and prints a goal-scoped timeline from the persisted `runtime_events` table.

## Current Runtime Paths That Emit Runtime Events

### Gateway-mirrored paths

`GatewayEventAdapter` currently mirrors the following gateway events into `runtimeEventBus`:

- `goal.created`
- `goal.started`
- `goal.completed`
- `goal.failed`
- `workitem.started`
- `workitem.completed`
- `workitem.failed`
- `run.started`
- `run.completed`

This covers the RPC goal submission path and any other gateway-side emission of those event names.

### Scheduler-mirrored paths

When `SchedulerEventAdapter` is directly connected to a `SchedulerCore`, it mirrors:

- `workitem.started`
- `workitem.in_progress`
- `workitem.completed`
- `workitem.failed`
- `run.started`
- `run.completed`
- `verification.started`
- `verification.completed`
- `budget.warning`
- `budget.exceeded`

This is the richest runtime-event path, but it depends on a direct scheduler-to-gateway connection.

### Debug-mirrored paths

`DebugEventAdapter` mirrors all `debugEmitter` traffic as `debug.*` runtime events. This gives Phase 2A broad observability coverage for instrumented code paths without changing business logic.

### Persisted and inspectable paths

Once the gateway is running, mirrored runtime events are persisted through `RuntimeEventStore` and are inspectable via:

- `pb events tail`
- `pb events replay <goalId>`

## Important Runtime Paths That Still Do Not Emit Enough Events

### 1. Conversation lifecycle is not mirrored into the runtime event bus

`conversation.new`, `conversation.message.started`, `conversation.message.succeeded`, `conversation.response`, `conversation.archived`, and related events are broadcast through the gateway, but `GatewayEventAdapter` does not forward any `conversation.*` events into `runtimeEventBus`.

Result: session-first execution remains visible to clients, but not fully visible in the normalized runtime event timeline.

### 2. Goal/task materialization is still under-instrumented

The current session-first path creates goals and initial work items directly in `SchedulerTaskBridge.createGoalFromConversation()` inside `src/scheduler-daemon/session-intake.ts`. The daemon IPC `materialize_goal` path in `src/scheduler-daemon/daemon.ts` also creates goals and initial work items directly.

Neither path emits a dedicated normalized runtime event for:

- goal materialization requested
- goal materialized
- initial work item materialized

In practice, some goal creation becomes visible later through `goal.created` on the gateway path, but the materialization boundary itself is not explicit.

### 3. Verification and budget events are topology-dependent

`SchedulerEventAdapter` forwards verification and budget events, but in the normal scheduler-daemon topology scheduler events first arrive through IPC and are re-emitted on the gateway `EventBus`. `GatewayEventAdapter` does not forward `verification.*`, `budget.*`, or `workitem.in_progress`.

Result: the persisted runtime event stream is richer when the gateway is directly connected to a local `SchedulerCore` than when it is connected to the scheduler daemon over IPC.

### 4. Execution internals are mostly only visible as debug events

The execution path inside `ExecutionService` and `ReActIntegration` still exposes most of its internal lifecycle through repository side effects and `debug.*` traces rather than stable runtime event types. That includes:

- LLM request/response cadence
- tool-call request/result cadence
- approval gate decisions
- resource-selection narrowing
- local fallback vs native tool path

These are observable enough for debugging, but not yet normalized enough for worker extraction.

### 5. Retry, block, and requeue transitions are not explicit runtime events

`SchedulerCore.handleExecutionFailure()` mutates work item state for retry, block, and terminal failure, but there is no dedicated runtime event for:

- retry requested
- work item requeued
- work item blocked
- goal blocked

The result is that the event spine shows terminal outcomes better than mid-flight recovery decisions.

## Risky or Incomplete Areas

### 1. The execution boundary still has dual run ownership

`SchedulerCore.startWorkItemExecution()` creates a run before dispatch. `ExecutionService.executeWorkItem()` also creates and completes its own run. `SchedulerCore.executeWorkItem()` then completes the scheduler-owned run using the returned result.

This means the target path still has overlapping ownership of:

- run creation
- run completion
- goal spending updates

That is the strongest sign that the execution boundary is not yet extracted.

### 2. Abort is not yet an end-to-end execution boundary

`ExecutionEngineAdapter` tracks a temporary pending run id and does not propagate the scheduler-created run id or abort signal into `ExecutionService`. `SchedulerCore.stop()` and `cancelGoal()` therefore do not yet have a clean end-to-end abort contract across the target execution path.

### 3. Runtime event fidelity depends on deployment topology

Direct scheduler connection yields richer runtime events than daemon-through-IPC mode. That means the current runtime spine is useful, but not yet architecture-grade as a single source of truth.

### 4. Replay remains a read-only inspection surface

`pb events replay` is a timeline printer. It does not yet define a re-executable worker contract or an execution-command log that can drive extracted workers.

## Recommended Next Extraction Target

The next extraction target should be the execution dispatch boundary between:

- `src/scheduler/core/scheduler.ts`
- `src/gateway/integration/execution-engine-adapter.ts`
- `src/app/lifecycle/execution/execution-service.ts`

## Recommended First Code Extraction Step

Add a small execution request/result boundary without changing the existing business flow:

1. Define an internal execution request envelope keyed by the scheduler-owned `run.id`.
2. Make `SchedulerCore` publish that request instead of directly awaiting `executionEngine.execute(...)`.
3. Keep the existing `ExecutionService` behind a compatibility worker/adapter that consumes the request and emits completion/failure with the same `runId`.
4. Move run completion ownership to one side only before any broader worker split.

This is the smallest extraction that removes the direct `SchedulerCore -> ExecutionService` dependency from the target path without rewriting the runtime.
