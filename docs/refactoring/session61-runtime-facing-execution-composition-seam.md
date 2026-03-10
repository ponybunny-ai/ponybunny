# Session 61: Runtime-Facing Execution Composition Seam

## Scope

This session continues `RF-033` with one narrow cleanup immediately behind the runtime-owned `ExecutionRunner` boundary added in Session 60.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery behavior
- redesign `ToolWorker`
- redesign `ConversationWorker`
- redesign `ReActIntegration` continuation ownership
- move broad execution/runtime composition wholesale out of `ExecutionService`
- change transport or durable ownership lines

## What narrow seam was introduced

A new runtime-owned execution cycle seam now lives at:

- `src/runtime/execution-boundary/execution-cycle-runner.ts`

Its default local implementation lives at:

- `src/runtime/execution-boundary/local-execution-cycle-runner.ts`

The new seam is intentionally small:

- `ExecutionCycleRunner`
- `ExecutionCycleRequest`
- `ExecutionCycleResult`

It represents only the local execution-cycle work that `ExecutionService` needs after it has already done run creation, policy gating, and persistence-owned setup.

## Which broader dependency it reduces

Before this session, `ExecutionService` directly constructed and retained the concrete local execution-cycle stack:

- `ReActIntegration`
- `LocalToolAdapter`
- `LocalToolWorker`
- the runtime-tooling handoff used to feed that stack

That meant the concrete implementation behind `ExecutionRunner` still depended directly on broad runtime execution composition details even though Session 60 had already removed the scheduler-facing runtime-to-app contract back-edge.

After this session:

- `ExecutionService` depends on the narrow `ExecutionCycleRunner` seam
- `LocalExecutionCycleRunner` owns the default local `ReActIntegration` composition behind that seam

This reduces direct dependence on the broader concrete execution-cycle construction details without introducing a general service container or changing ownership lines.

## What runtime-owned path now depends on the new seam

The rewired path is:

- `LocalExecutionAdapter`
- `ExecutionRunner`
- `ExecutionService`
- `ExecutionCycleRunner`

More specifically, `ExecutionService.executeWorkItem(...)` now delegates the actual local execution cycle through `ExecutionCycleRunner.executeCycle(...)` after:

- route-context normalization
- approval/resource-policy gating
- run creation

Run persistence, retry classification, escalation behavior, and completion accounting remain in `ExecutionService`.

## What intentionally remains unchanged

The following remain unchanged in this session:

- `ExecutionService` is still the concrete implementation behind `ExecutionRunner`
- scheduler-owned run identity stays unchanged
- direct and evented execution semantics stay unchanged
- execution and recovery behavior stay unchanged
- `ReActIntegration` still owns post-tool continuation
- `ToolWorker` remains the same local-authoritative tool seam
- `ConversationWorker` remains unchanged
- transport ownership, IPC, and durable ownership lines remain unchanged

This session contains the composition knot slightly further; it does not solve the broader execution/runtime ownership graph.

## Focused validation

Focused tests cover:

- `ExecutionService` delegating runtime execution through the new `ExecutionCycleRunner` seam
- existing execution-boundary behavior continuing to pass through the runtime-owned `ExecutionRunner` path

Build validation was also run so the contained seam extraction remains type-safe and runnable.

## Next safest RF-033 step

The next safest cleanup step is another small composition-only extraction behind `ExecutionRunner`, most likely around the remaining root tool/policy/runtime-tooling assembly still retained directly inside `ExecutionService`.

That next step should stay narrow:

- keep `ExecutionService` as the concrete execution implementation
- avoid redesigning `ReActIntegration`
- avoid changing `ToolWorker` or `ConversationWorker`
- avoid changing scheduler protocols, transport ownership, or durable ownership

The goal should be to reduce one more direct concrete construction dependency, not to turn this path into a broad container or a wholesale execution-service rewrite.
