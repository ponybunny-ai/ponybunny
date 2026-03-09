# Session 12: Execution Mode Switch

## What changed

This session adds an explicit scheduler execution mode with two values:

- `direct`
- `evented`

The mode is configured in runtime config at `scheduler.executionMode` and is threaded through daemon startup into [src/gateway/integration/scheduler-factory.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/scheduler-factory.ts), which passes it into [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts).

Default behavior remains unchanged because the default mode is `direct`.

## Direct mode

In `direct` mode, `SchedulerCore` preserves the current authoritative path:

1. create the run
2. mark the work item in progress
3. call `ExecutionPort.execute(...)` directly
4. continue through the existing completion and verification handling

No gateway behavior, IPC behavior, or execution architecture changed for this mode.

## Evented mode

In `evented` mode, `SchedulerCore` still performs the pre-dispatch scheduler work:

1. create the run
2. update in-memory scheduler state
3. mark the work item in progress
4. emit the existing scheduler lifecycle events

But instead of calling `ExecutionPort.execute(...)` directly, it publishes a runtime event:

- `type: "task.ready"`
- `source: "scheduler"`

The event `payload` is the normalized `ExecutionRequest` shape already used by [src/runtime/workers/execution-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/execution-worker.ts), including:

- `runId`
- `goalId`
- `workItemId`
- `workItem`
- `model`
- `laneId`
- `budgetRemaining`

This keeps the evented trigger path compatible with `LocalExecutionWorker` without introducing a second execution command contract.

## Temporary asymmetry and remaining gaps

`evented` mode is intentionally incomplete in this session.

The scheduler now switches the trigger path, but completion ownership is still on the old direct path. `LocalExecutionWorker` can execute the request after `task.ready`, but `SchedulerCore` does not yet consume `execution.completed` or `execution.failed` as the authoritative completion signal.

That means evented mode currently has these known asymmetries:

- scheduler-side active execution cleanup still belongs to the direct completion path
- lane release still happens in the direct completion path
- run completion and verification continuation are not yet driven by worker result events

This is why `direct` remains the default and why evented mode should still be treated as a controlled migration mode rather than the new default behavior.

## Risks

- If `evented` mode is enabled broadly before completion handling moves to the event spine, scheduler-side active execution state can remain uncleared longer than intended.
- `LocalExecutionWorker` and `SchedulerCore` now share the trigger contract, but not yet the full execution lifecycle contract.
- The current implementation prevents double execution by making the scheduler publish `task.ready` instead of calling `ExecutionPort.execute(...)` when mode is `evented`; it does not yet solve the downstream completion-path split.

## What did not change

This session does not:

- change gateway behavior
- change IPC messages or routing
- change tool execution architecture
- move conversation worker or tool worker responsibilities
- rename `task.ready`
- perform the larger completion-path cleanup

## Validation focus

Focused tests were added/updated for:

- direct mode still calling `ExecutionPort.execute(...)`
- evented mode publishing `task.ready`
- evented mode not directly executing the work item
- runtime config parsing for `scheduler.executionMode`
