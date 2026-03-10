# Session 74: Scheduler-Owned Composition Entrypoint

## Scope

This session performs only the narrow RF-034 cleanup selected in Session 73:

- introduce a scheduler-owned default `SchedulerCore` composition entry point
- retarget scheduler-owned entry paths to use that scheduler-owned boundary
- preserve the current gateway-named scheduler factory as a compatibility shim

This session does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery
- redesign `ToolWorker`
- redesign `ConversationWorker`
- redesign provider-selection, endpoint health, or fallback semantics
- redesign streaming callback semantics
- change replay workflow behavior
- change `runtimeEventBus` ownership semantics
- change `LocalExecutionWorker` startup ownership in `SchedulerDaemon`
- perform broad module moves or namespace cleanup

## What Moved

The default scheduler composition root moved from:

- `src/gateway/integration/scheduler-factory.ts`

to a scheduler-owned entry point:

- `src/scheduler/composition/default-scheduler.ts`

That new scheduler-owned boundary now owns the same default `SchedulerCore` assembly that `createScheduler(...)` previously handled inline:

- `SchedulerRepositoryAdapter` construction
- `LocalExecutionAdapter` defaulting when no `executionPort` is injected
- `runtimeEventBus` defaulting when no event bus is injected
- `ModelSelector`, `LaneSelector`, `BudgetTracker`, and `RetryHandler` construction
- `WorkItemManager` and `EscalationHandler` repository adapter construction
- `QualityGateRunner`, `DefaultCommandExecutor`, and `ILLMReviewer` assembly
- scheduler config normalization/defaulting before `SchedulerCore` creation

Scheduler-owned call sites now route through that scheduler-owned boundary:

- `src/scheduler-daemon/daemon.ts`
- `src/cli/commands/scheduler-daemon.ts`

## What Intentionally Stayed Unchanged

This was a placement and ownership cleanup, not a behavior rewrite.

The following invariants remain unchanged:

- scheduler-owned run identity and execution/recovery invariants remain owned by `SchedulerCore`
- `ReActIntegration` continuation ownership was not reopened
- `ToolWorker` local-authoritative seam invariants were not changed
- `ConversationWorker` local-authoritative seam invariants were not changed
- `RuntimeToolingContext` source-of-truth rules on migrated paths were not changed
- `LLMStreamEventSink` ownership direction was not changed
- the Session 72 extracted conversation bootstrap ownership remains intact
- outer transport ownership lines remain unchanged
- durable ownership lines remain unchanged
- `SchedulerRepositoryAdapter` usage remains the same
- `LocalExecutionAdapter` defaulting behavior remains the same
- `runtimeEventBus` defaulting behavior remains the same
- `WorkItemManager` and `EscalationHandler` adapter construction remain the same
- `QualityGateRunner` assembly remains the same
- scheduler config defaults remain the same
- daemon startup behavior and replay CLI behavior remain the same
- `LocalExecutionWorker` startup ownership remains in `SchedulerDaemon`

## Why The Gateway-Named Factory Still Exists

`src/gateway/integration/scheduler-factory.ts` still exists as a compatibility shim.

It keeps the existing `createScheduler(...)` export surface and associated types, but now delegates directly to the scheduler-owned `createDefaultScheduler(...)` entry point.

That preserves backward compatibility for any remaining gateway-surface consumers and keeps this session narrow:

- no broad export-surface cleanup
- no forced rename across unrelated modules
- no mixed composition-plus-transport rewrite

## Remaining Debt

This session fixed the main active ownership-direction smell: scheduler-owned runtime entry points no longer import the gateway-named scheduler factory to assemble default scheduler state.

What remains intentionally deferred:

- the gateway compatibility shim still exists
- the concrete `SchedulerRepositoryAdapter` implementation still lives under a gateway-named path even though the default composition root is now scheduler-owned
- broader gateway/daemon seam cleanup remains future work under RF-034 / RF-035

## Focused Validation

Validated in this session:

- `npm run build`
- `npx jest test/scheduler-daemon/session-intake.test.ts`

The build validates the moved scheduler composition path and the preserved gateway shim export surface. The targeted scheduler-daemon test provides a narrow regression check on the nearby scheduler-owned bootstrap path without broadening into unrelated behavior changes.
