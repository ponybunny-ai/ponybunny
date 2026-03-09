# Session 13: Evented Execution Result Handoff

## What changed

Evented execution mode now closes the scheduler-side execution loop on runtime result events instead of leaving completion ownership on the old direct call path.

`SchedulerCore` now subscribes to runtime events and, when `scheduler.executionMode === "evented"`, consumes:

- `execution.completed`
- `execution.failed`

The scheduler correlates those events by the scheduler-owned `runId` already stored in `activeExecutions`. No second completion identifier was introduced.

When a matching worker result arrives in evented mode, the scheduler now performs scheduler-owned completion work in this order:

1. record run usage/bookkeeping
2. complete the run record in the repository
3. emit `run_completed`
4. clear `activeExecutions[runId]`
5. decrement lane occupancy and refresh lane availability
6. continue into the existing scheduler success/failure continuation

This makes `execution.completed` / `execution.failed` the authoritative execution result signals for evented mode.

## Scheduler state now cleaned up in evented mode

After a worker publishes a matching result event, evented mode now cleans up:

- the scheduler's in-memory active execution entry for that `runId`
- lane occupancy via `laneSelector.decrementActive(laneId)`
- lane availability state via `updateLaneStatus(laneId)`

Before this session, evented mode could publish `task.ready` and allow the worker to run, but the scheduler could still retain active execution state and lane usage because only the direct execution path owned that cleanup.

## What remains in the old direct path

Direct mode is still the safe default and still owns direct execution dispatch:

- `SchedulerCore.dispatchExecution(...)` still calls `ExecutionPort.execute(...)` directly in `direct` mode
- direct mode still reaches completion through `executeWorkItem(...)`

The bookkeeping and post-result continuation are now shared through a narrow internal helper so both modes converge on the same scheduler-owned logic after an execution result exists.

This means the old direct completion path now begins at synchronous execution dispatch, not at run bookkeeping itself.

## Verification handoff status

Verification continuation is now effectively handed off for evented mode because `execution.completed` leads into the existing scheduler success continuation, which still:

- marks the work item `verify`
- runs `qualityGateRunner.runVerification(...)`
- marks the work item `done` on success
- routes verification failures back through the existing failure/retry path

This session did not redesign verification architecture. It only moved evented mode onto the same scheduler-owned continuation entry point after the worker result is received.

## What did not change

- Gateway behavior
- IPC behavior
- legacy event names such as `task.ready`
- tool worker or conversation worker architecture
- direct mode as the default/safe path

## Remaining risks before evented mode is production-ready

- `execution.failed` currently carries only worker error data, not a full `ExecutionResult`, so evented failure bookkeeping completes the run with zeroed usage values unless richer failure payloads are added later.
- Evented mode still depends on in-process runtime event delivery. This session did not harden recovery for missed result events or process restarts.
- Abort/cancellation semantics outside the active execution window were not redesigned here.
- The broader worker architecture is still mid-migration; this session only closes the execution result handoff loop for the local evented execution path.

## Validation focus for this session

Focused tests were added around:

- evented `execution.completed` causing scheduler cleanup and continuation
- evented `execution.failed` causing scheduler cleanup and lane release
- existing direct-mode execution tests remaining in place unchanged
