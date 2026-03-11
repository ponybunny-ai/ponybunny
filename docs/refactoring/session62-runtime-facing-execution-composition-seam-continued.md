# Session 62: Runtime-Facing Execution Composition Seam Continued

## Scope

This session continues `RF-033` with one more narrow execution/runtime composition cleanup immediately behind `ExecutionCycleRunner`.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery behavior
- redesign `ToolWorker`
- redesign `ConversationWorker`
- redesign `ReActIntegration` continuation ownership
- move prompt or tooling ownership wholesale out of `ExecutionService`
- change transport or durable ownership lines

## What narrow seam was introduced

A new runtime-facing composition seam now lives at:

- `src/runtime/execution-boundary/execution-cycle-runtime-factory.ts`

Its default local implementation lives at:

- `src/runtime/execution-boundary/local-execution-cycle-runtime-factory.ts`

The seam is intentionally small:

- `ExecutionCycleRuntimeFactory`
- `ExecutionCycleRuntimeFactoryParams`
- `ExecutionCycleRuntimeComposition`

It owns only the default local runtime-tooling handoff and local cycle-runner assembly that `ExecutionService` previously constructed directly in its constructor.

## Which composition pressure it reduces

Before this session, `ExecutionService` still directly assembled:

- `ToolProvider`
- `RuntimeToolingContext`
- `PromptProvider` creation for that context
- `LocalExecutionCycleRunner`

That left the concrete `ExecutionRunner` implementation holding one more direct runtime-tooling and local-cycle construction knot even after Session 61 moved the actual cycle execution behind `ExecutionCycleRunner`.

After this session:

- `ExecutionService` still owns the base local tool registry, allowlist, enforcer, and skill registry
- `ExecutionService` now depends on `ExecutionCycleRuntimeFactory` for the default runtime-tooling plus local-cycle composition immediately behind that
- `LocalExecutionCycleRuntimeFactory` performs the default local `RuntimeToolingContext` and `LocalExecutionCycleRunner` assembly

This keeps the extraction explicit and local. It is not a broad container and it does not replace `ExecutionService`.

## What ExecutionService depends on instead

`ExecutionService` now:

- creates the same baseline tool registry / allowlist / enforcer state it already owned
- passes those explicit dependencies into `ExecutionCycleRuntimeFactory.createExecutionCycleRuntime(...)`
- stores the returned `runtimeToolingContext`
- delegates cycle execution through the returned `executionCycleRunner` unless a test/runtime override is injected

The runtime-facing path is now:

- `LocalExecutionAdapter`
- `ExecutionRunner`
- `ExecutionService`
- `ExecutionCycleRuntimeFactory`
- `ExecutionCycleRunner`

## What intentionally remains unchanged

The following remain unchanged in this session:

- `ExecutionService` is still the concrete implementation behind `ExecutionRunner`
- scheduler-owned run identity remains unchanged
- approval gating, escalation behavior, retry classification, and run completion remain in `ExecutionService`
- direct and evented execution semantics remain unchanged
- execution and recovery semantics remain unchanged
- `ReActIntegration` still owns continuation after tool results resolve
- `ToolWorker` and `ConversationWorker` seams remain unchanged
- transport ownership, IPC, and durable ownership remain unchanged

## Focused validation

Focused tests cover:

- `ExecutionService` using the new factory seam to obtain runtime execution composition
- `ExecutionService` still delegating execution through `ExecutionCycleRunner`
- existing policy and tool-isolation behavior remaining unchanged on the same service path

Build validation was also run so the contained seam extraction remains type-safe and runnable.

## Next safest RF-033 step

The next safest cleanup step is another narrow extraction around the remaining per-work-item tool/policy preparation still retained inside `ExecutionService`, most likely by isolating the scoped tool-enforcer / policy-audit preparation that feeds the cycle path without changing policy semantics, worker seams, or execution/recovery behavior.
