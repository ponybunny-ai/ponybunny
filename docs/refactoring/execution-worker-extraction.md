# ExecutionWorker Extraction

## Goal

Extract an `ExecutionWorker` boundary after Sessions 1-7 without rewriting the deterministic runtime, tool stack, or verification flow in the same step.

The first extraction should move execution behind an explicit worker boundary while preserving:

- Gateway RPC behavior
- Scheduler goal/work item orchestration behavior
- current `runs` / `work_items` persistence semantics
- current runtime event inspection and replay surface

## Current Execution Entry Points

### 1. Scheduler-driven execution

The main production path is:

1. `goal.submit` materializes a goal and initial work item in [src/gateway/rpc/handlers/goal-handlers.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/rpc/handlers/goal-handlers.ts)
2. Gateway forwards scheduler commands through IPC in [src/gateway/integration/ipc-bridge.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/ipc-bridge.ts)
3. `SchedulerDaemon` constructs `SchedulerCore` with `ExecutionEngineAdapter` in [src/scheduler-daemon/daemon.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts) and [src/gateway/integration/scheduler-factory.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/scheduler-factory.ts)
4. `SchedulerCore.startWorkItemExecution()` creates the run, updates work item state, emits scheduler events, then calls `executeWorkItem()` in [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts)
5. `SchedulerCore.executeWorkItem()` calls `deps.executionEngine.execute(...)`
6. `ExecutionEngineAdapter.execute()` adapts scheduler context into `ExecutionService.executeWorkItem(...)` in [src/gateway/integration/execution-engine-adapter.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/execution-engine-adapter.ts)
7. `ExecutionService` owns ReAct, tool registration, MCP initialization, skill lookup, run completion, and escalation creation in [src/app/lifecycle/execution/execution-service.ts](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts)

This is the critical extraction target.

### 2. Direct local execution paths

There are also direct callers that bypass `SchedulerCore`:

- `pb work` constructs `ExecutionService` directly in [src/cli/commands/work.ts](/Users/nickma/Develop/nick-ma/pony/src/cli/commands/work.ts)
- chat UI constructs `ExecutionService` directly in [src/cli/ui/chat-ui.tsx](/Users/nickma/Develop/nick-ma/pony/src/cli/ui/chat-ui.tsx)

These callers matter because a worker extraction that only updates scheduler paths would leave execution split across two architectures.

### 3. Agent tick special-case path

`ExecutionEngineAdapter` has a second branch for agent ticks:

- if a schema/custom runner exists, execution may bypass `ExecutionService`
- if no runner exists, the adapter falls back to `ExecutionService`

That branch must remain intact during Session 8/9-era migration. ExecutionWorker should not absorb agent-runner responsibilities yet.

## Proposed ExecutionWorker Boundary

### Recommendation

Introduce an in-process `ExecutionWorker` that owns:

- the execution request lifecycle
- invocation of existing `ExecutionService`
- execution-specific runtime event emission
- abort bookkeeping for active executions

Do not move tool execution, verification, or conversation logic into the worker yet.

### Boundary shape

The worker should accept a single execution command payload:

```ts
interface ExecutionRequest {
  goalId: string
  workItemId: string
  runId: string
  laneId: string
  selectedModel: string
  requestedBy: 'scheduler' | 'cli' | 'chat-ui'
  routeContext?: Record<string, unknown>
}
```

The worker should return a normalized execution outcome:

```ts
interface ExecutionOutcome {
  goalId: string
  workItemId: string
  runId: string
  success: boolean
  tokensUsed: number
  timeSeconds: number
  costUsd: number
  artifacts: string[]
  actualModel?: string
  endpointId?: string
  error?: { code: string; message: string; recoverable: boolean }
}
```

### Responsibility split

`SchedulerCore` should continue to own:

- goal selection
- work item readiness/dependency decisions
- lane selection
- run creation
- work item status transitions at orchestration level
- retry/escalation/verification policy

`ExecutionWorker` should own:

- turning an execution request into one concrete execution attempt
- calling `ExecutionService`
- emitting execution lifecycle events
- maintaining active execution handles for abort support

`ExecutionService` should remain the implementation engine behind the worker in the first migration step.

## Events Consumed

The target boundary should consume runtime events, even if the first implementation uses an adapter that turns direct method calls into local event dispatch.

Recommended consumed events:

- `execution.requested`
  - source of truth for a worker start request
  - payload should include `goalId`, `workItemId`, `runId`, `laneId`, `selectedModel`
- `execution.abort.requested`
  - requests cancellation of an active run
  - payload should include `runId`

Compatibility note:

- in the first extraction, `SchedulerCore` can still call an `ExecutionWorkerClient.execute(...)`
- that client may publish `execution.requested` internally and await a local response
- this preserves a gradual move to event-driven execution without forcing the scheduler to become asynchronous-message-only in one session

## Events Emitted

### New worker-facing runtime events

Recommended events emitted by `ExecutionWorker`:

- `execution.started`
- `execution.completed`
- `execution.failed`
- `execution.aborted`

Recommended payload fields:

- `goalId`
- `workItemId`
- `runId`
- `laneId`
- `selectedModel`
- `actualModel`
- `endpointId`
- `tokensUsed`
- `timeSeconds`
- `costUsd`
- `error`

### Compatibility event mapping

Existing observers still depend on current scheduler/gateway event families such as:

- `workitem.started`
- `run.started`
- `run.completed`
- `workitem.completed`
- `workitem.failed`

During migration, those should continue to exist. The simplest plan is:

1. keep current scheduler event emission unchanged initially
2. add worker-native runtime events in parallel
3. later decide whether scheduler events become derived views over runtime events

This avoids breaking TUI, Web UI, IPC fanout, debug surfaces, and `pb events replay`.

## Migration Risks

### 1. Split ownership of run lifecycle

Today both `SchedulerCore` and `ExecutionService` touch run lifecycle:

- `SchedulerCore` creates the run before dispatch
- `ExecutionService` may create and complete runs internally for approval/resource-selection failure paths

That is the highest-risk seam. Extraction must not accidentally create duplicate runs or change run sequencing.

### 2. Duplicate event emission

If `SchedulerCore` keeps emitting `run_started`/`run_completed` while `ExecutionWorker` emits `execution.started`/`execution.completed`, some surfaces may double-count unless adapters are explicit about which events are authoritative.

### 3. Abort semantics are incomplete today

`ExecutionEngineAdapter` tracks `AbortController`s, but `ExecutionService.executeWorkItem()` currently creates a fresh controller for `ReActIntegration` and does not accept an external signal. A worker boundary can expose this mismatch more clearly than the current adapter does.

### 4. Direct callers bypass the future boundary

`pb work` and chat UI directly construct `ExecutionService`. If those entry points remain untouched, the repo will have both worker-driven and non-worker-driven execution semantics.

### 5. Tool and MCP globals are still embedded in execution

`ExecutionService` initializes tool registries, allowlists, MCP tools, and skills internally. This is acceptable for the first worker extraction, but it means the worker is still carrying future `ToolWorker` responsibilities until the next session.

### 6. Agent tick path is not a normal work-item execution path

The adapter currently sometimes routes agent ticks to runner registry instead of `ExecutionService`. Folding that into ExecutionWorker too early would mix recurring agent orchestration with ordinary work-item execution.

## Compatibility Plan

### Phase 1: Wrap, do not rewrite

Create `ExecutionWorker` as a thin wrapper around `ExecutionService`.

- keep `ExecutionService` API and internals mostly unchanged
- move `activeExecutions` tracking out of `ExecutionEngineAdapter` into the worker
- keep `ExecutionEngineAdapter` as a compatibility adapter that delegates to the worker

### Phase 2: Introduce worker-native events

Publish worker lifecycle events alongside current scheduler/gateway events.

- do not remove existing scheduler events yet
- persist worker events into `runtime_events`
- verify that replay still shows a coherent timeline

### Phase 3: Move direct callers behind the worker client

Update direct callers to use the same boundary:

- `pb work`
- chat UI

This keeps execution semantics consistent even before ToolWorker extraction.

### Phase 4: Prepare next extractions

Once ExecutionWorker is stable:

- ToolWorker can take over tool-request/tool-result boundaries from inside `ExecutionService`
- QualityWorker can take over verification after `execution.completed`

That ordering matches the repo plan and avoids a multi-worker extraction in one session.

## Non-Goals For ExecutionWorker Session

The first extraction should explicitly avoid:

- rewriting `ReActIntegration`
- changing deterministic runtime rollout behavior
- moving verification out of scheduler in the same session
- redesigning IPC contracts
- making workers multi-process
- normalizing all legacy event names immediately

## Recommendation Summary

Use a conservative extraction:

1. keep scheduler as orchestration owner
2. add an in-process `ExecutionWorker` boundary around `ExecutionService`
3. let `ExecutionEngineAdapter` delegate to that worker
4. emit new execution runtime events without removing current scheduler events
5. migrate direct CLI/UI callers onto the same worker boundary before starting ToolWorker

This gives a real worker boundary with limited blast radius and keeps the next sessions small and sequenced.
