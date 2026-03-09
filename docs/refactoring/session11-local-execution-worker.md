# Session 11: Local Execution Worker Skeleton

## What changed

This session adds a new local worker module at [src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts).

`LocalExecutionWorker` is a thin runtime-event subscriber that lives alongside the existing direct scheduler execution path. It does not replace the scheduler call path yet.

The worker expects `task.ready` runtime events whose `payload` is the normalized Session 10 `ExecutionRequest` shape:

```ts
type TaskReadyEventPayload = ExecutionRequest;
```

That keeps the future evented handoff aligned with the existing execution boundary instead of introducing another command contract.

## Events consumed and emitted

The worker subscribes to:

- `task.ready`

When a valid `task.ready` event is received, the worker:

1. publishes `execution.started`
2. calls `ExecutionPort.execute(request)`
3. publishes `execution.completed` when `ExecutionPort` returns `success: true`
4. publishes `execution.failed` when `ExecutionPort` returns `success: false` or throws

All emitted execution events include:

- `runId`
- `goalId`
- `workItemId`
- `source: "local-execution-worker"`

The emitted payloads keep the original `ExecutionRequest` attached so downstream consumers can inspect the request that was executed.

## Runtime wiring

The worker is started in [src/scheduler-daemon/daemon.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts) during daemon composition.

The daemon now:

- creates a `LocalExecutionAdapter`
- starts `LocalExecutionWorker` with that `ExecutionPort`
- passes the same `ExecutionPort` into `createScheduler(...)`

This keeps the worker and the current scheduler direct path pointed at the same execution boundary implementation without making `SchedulerCore` depend on the worker.

## Why this is not the main path yet

The scheduler still directly calls `ExecutionPort.execute(...)` inside [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts).

This session intentionally does **not**:

- make the scheduler publish `task.ready`
- add an execution mode switch
- change gateway behavior
- change IPC
- remove the direct execution path

As a result, the worker is wired and runnable, but it remains dormant unless something explicitly publishes `task.ready`.

## Minimal duplicate protection

`LocalExecutionWorker` keeps an in-memory `processedRunIds` set and ignores repeated `task.ready` events for the same `runId` within the same process lifetime.

This is intentionally local in scope for Session 11 and is only meant to avoid accidental duplicate execution while the evented path is being introduced.

## What remains for the next sessions

Before `task.ready` can become the primary execution trigger, the runtime still needs:

- an execution mode switch so direct and evented paths can coexist safely
- scheduler support for publishing `task.ready` instead of directly invoking `ExecutionPort`
- clear ownership of run lifecycle and completion across scheduler and execution layers
- validation of end-to-end event ordering once the scheduler cutover happens
