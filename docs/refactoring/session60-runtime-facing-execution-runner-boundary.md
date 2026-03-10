# Session 60: Runtime-Facing Execution Runner Boundary

## Scope

This session implements the first narrow `RF-033` dependency-direction cleanup identified in Session 59.

It is intentionally limited to the runtime execution boundary used by `LocalExecutionAdapter`.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution/recovery behavior
- redesign `ToolWorker`
- redesign `ConversationWorker`
- redesign `ReActIntegration` continuation ownership
- move broad execution/runtime composition out of `ExecutionService`

## What changed

A new runtime-owned execution runner contract now lives at:

- `src/runtime/execution-boundary/execution-runner.ts`

That contract introduces three narrow runtime-facing types:

- `ExecutionRunner`
- `ExecutionRunnerResult`
- `RuntimeExecutionRunSummary`

The interface is intentionally small:

- one method: `executeWorkItem(workItem)`
- one result shape containing only the fields `LocalExecutionAdapter` actually reads

`LocalExecutionAdapter` now depends on `ExecutionRunner` instead of importing `IExecutionService` from `src/app/lifecycle/stage-interfaces.ts`.

`ExecutionService` remains the concrete implementation and now explicitly satisfies the runtime-facing boundary without changing its behavior or constructor ownership.

## Dependency-direction problem fixed

Before this session:

- `src/runtime/execution-boundary/local-execution-adapter.ts` imported `IExecutionService` from `src/app/lifecycle/stage-interfaces.ts`

That meant the runtime execution boundary depended directly on app/lifecycle contract types as its source-of-truth dependency.

After this session:

- `LocalExecutionAdapter` depends on the runtime-owned `ExecutionRunner` boundary
- the app-layer `ExecutionService` conforms to that boundary structurally

This removes the direct runtime-to-app contract dependency at the narrow scheduler-facing execution seam while keeping the same concrete implementation behind it.

## What LocalExecutionAdapter depends on now

`LocalExecutionAdapter` now depends on:

- `ExecutionRunner` from `src/runtime/execution-boundary/execution-runner.ts`
- existing runtime execution request/result types from `src/runtime/execution-boundary/types.ts`
- existing agent runner registries for the already-established agent-tick path

It no longer uses app/lifecycle stage-interface execution contracts directly.

## What intentionally remains unchanged

The following lines are unchanged in this session:

- scheduler-owned run identity remains the boundary-level correlation key
- `ExecutionService` still performs the concrete local execution work
- `ExecutionService` still owns the current `ReActIntegration` and local tool composition path
- direct and evented execution modes remain unchanged
- execution/recovery semantics remain unchanged
- `ToolWorker` seam and `ConversationWorker` seam remain unchanged
- transport ownership and IPC remain unchanged
- durable ownership lines remain unchanged

This session contains the back-edge rather than solving the broader execution/runtime composition knot.

## Focused validation

Focused tests were added for:

- `LocalExecutionAdapter` executing against the new narrow `ExecutionRunner` boundary
- `ExecutionService` explicitly satisfying that boundary

Build validation was also run to ensure the rewired boundary still compiles.

## Next safest RF-033 step

The next safest cleanup step is still narrow:

- extract the next smallest runtime-facing execution composition dependency that sits immediately behind `ExecutionRunner`, likely by isolating a smaller runtime-owned execution composition seam around `ExecutionService` construction without changing execution/recovery semantics, worker seams, or `ReActIntegration` continuation ownership

The important constraint is to keep future work local and avoid broad redesign of tooling, transport, or scheduler protocols.
