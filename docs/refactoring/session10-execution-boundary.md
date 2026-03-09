# Session 10: Execution Boundary

## What changed

This session introduces a stable local execution boundary under [src/runtime/execution-boundary/index.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/index.ts).

The new boundary defines:

- `ExecutionRequest`
- `ExecutionResult`
- `ExecutionPort`
- `LocalExecutionAdapter`

`ExecutionRequest` is keyed by the scheduler-owned `runId`. The scheduler still creates the run record first and remains the owner of run identity.

## Current dependency shape

After this refactor, the runtime path is:

`SchedulerCore -> ExecutionPort -> LocalExecutionAdapter -> ExecutionService`

Relevant modules:

- [src/scheduler/core/scheduler.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/scheduler.ts)
- [src/scheduler/core/types.ts](/Users/nickma/Develop/nick-ma/pony/src/scheduler/core/types.ts)
- [src/runtime/execution-boundary/local-execution-adapter.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts)
- [src/gateway/integration/scheduler-factory.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/scheduler-factory.ts)

`SchedulerCore` no longer depends on the older scheduler-specific execution adapter contract. It now depends on `ExecutionPort` and sends an `ExecutionRequest` containing:

- the scheduler-owned `runId`
- the `goalId`
- the canonical `workItemId`
- the `workItem`
- scheduler-selected execution metadata (`model`, `laneId`, `budgetRemaining`)

## Run ownership after this refactor

Run ownership is now centralized at the boundary contract:

- the scheduler creates the authoritative run record
- the scheduler passes that `runId` into `ExecutionRequest`
- the boundary returns `ExecutionResult` keyed to the same `runId` and `workItemId`
- the scheduler still completes its own run record after the port returns

This removes run identity ambiguity at the scheduler boundary.

## What still remains before worker extraction

The local compatibility adapter still delegates to the existing `ExecutionService`, and `ExecutionService` still creates and completes its own internal run lifecycle. That duplicate lifecycle is now explicitly hidden behind the new execution boundary, but it is not eliminated yet.

What remains for later sessions:

- remove the internal `ExecutionService` run creation/completion path
- move single-run completion ownership to one side only
- make abort propagate end-to-end instead of stopping at adapter-local tracking
- replace the direct local adapter with a worker-facing implementation when worker extraction begins

## Compatibility notes

- Runtime behavior remains local and awaited from the scheduler perspective.
- No gateway behavior changed.
- No IPC behavior changed.
- The legacy [src/gateway/integration/execution-engine-adapter.ts](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/execution-engine-adapter.ts) remains as a compatibility wrapper for older call sites and tests, but it is no longer the primary scheduler dependency.
