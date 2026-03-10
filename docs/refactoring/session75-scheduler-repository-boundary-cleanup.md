# Session 75: Scheduler Repository Boundary Cleanup

## Seam Reviewed

This session reviewed only the remaining scheduler/gateway seam directly adjacent to the default scheduler composition path:

- `src/scheduler/composition/default-scheduler.ts`
- `src/gateway/integration/scheduler-repository-adapter.ts`
- `src/gateway/integration/scheduler-factory.ts`
- gateway export surfaces that still re-export the scheduler repository adapter

The focused question was whether scheduler-owned entry points still depended on gateway-named repository or integration surfaces after Session 74.

The live remaining dependency was narrow and concrete:

- `src/scheduler/composition/default-scheduler.ts` still imported `SchedulerRepositoryAdapter` from `src/gateway/integration/scheduler-repository-adapter.ts`

No additional scheduler-owned entry points were found importing gateway-named integration files for repository assembly after the Session 74 composition-root move. The remaining issue was concentrated in this one adapter seam and its compatibility re-exports.

## Decision

`SchedulerRepositoryAdapter` is scheduler-owned in responsibility and semantics, not a genuinely shared cross-boundary integration surface.

Code reality supporting that decision:

- the adapter exists only to satisfy `ISchedulerRepository`, which is defined by `src/scheduler/core/types.ts`
- its constructor accepts `IWorkOrderRepository` and adapts that dependency specifically for `SchedulerCore`
- the only live construction site was the scheduler-owned default composition entry point in `src/scheduler/composition/default-scheduler.ts`
- gateway surfaces only re-exported it; they did not own its behavior or lifecycle

Because the adapter was plainly scheduler-owned in usage and meaning, this session chose **Path A**:

- introduce a scheduler-owned repository adapter boundary
- route scheduler-owned code through it
- retain gateway compatibility shims for existing import surfaces

## What Moved Or Was Re-Routed

The concrete adapter implementation moved to a scheduler-owned path:

- `src/scheduler/composition/scheduler-repository-adapter.ts`

The scheduler-owned default composition path now imports the adapter from that scheduler-owned file:

- `src/scheduler/composition/default-scheduler.ts`

The scheduler composition barrel now exports the adapter:

- `src/scheduler/composition/index.ts`

The scheduler public barrel also re-exports it:

- `src/scheduler/index.ts`

The historical gateway file was reduced to a compatibility shim:

- `src/gateway/integration/scheduler-repository-adapter.ts`

That shim now re-exports the scheduler-owned implementation instead of owning the class directly.

## Compatibility Surfaces That Remain

These compatibility surfaces intentionally remain after this session:

- `src/gateway/integration/scheduler-repository-adapter.ts`
- `src/gateway/integration/index.ts` re-export of `SchedulerRepositoryAdapter`
- `src/gateway/index.ts` re-export of `SchedulerRepositoryAdapter`
- `src/gateway/integration/scheduler-factory.ts` compatibility shim introduced in Session 74

They were preserved to avoid widening this session into a broader gateway namespace cleanup.

## What Was Intentionally Left Unchanged

This session did not change:

- `SchedulerRepository` read/write behavior
- `LocalExecutionAdapter` behavior or defaulting
- `runtimeEventBus` defaulting or ownership
- `WorkItemManager` and `EscalationHandler` behavior
- `QualityGateRunner` behavior
- daemon runtime behavior
- scheduler CLI behavior
- replay behavior
- persistence semantics
- scheduling semantics
- continuation ownership
- stream/event ownership lines
- Session 72 conversation bootstrap ownership
- Session 74 scheduler-owned composition entry point shape

The adapter implementation itself also kept its existing method behavior, including the current `getWorkItemsForGoal(...)` ready-item-only behavior. This session corrected ownership placement only.

## Redundant Indirection Removed

The only redundant indirection removed was ownership-local:

- the concrete adapter class no longer sits behind a gateway-named implementation file for scheduler-owned code

No deeper repository assembly logic was collapsed or redesigned.

## Next Likely RF-034 Target

After this session, the most likely remaining RF-034 target is the small set of gateway compatibility export surfaces that still expose scheduler-owned composition and adapter boundaries under `src/gateway/integration/`.

That should remain a later cleanup only if it can be done without reopening:

- transport ownership
- daemon lifecycle ownership
- execution or recovery seams
- broader namespace cleanup across unrelated modules

## Validation

Validated in this session:

- `npx jest test/scheduler/composition/scheduler-repository-adapter.test.ts`
- `npm run build`

Additional check run:

- `npx jest test/gateway/integration/scheduler-factory.test.ts`

That broader legacy factory test still fails its existing evented-execution assertion because the fixture does not currently observe the expected `task.ready` publication on this path. This session did not widen into scheduler evented-behavior debugging because the adapter move preserved the existing adapter implementation and the seam-specific regression coverage above already validates the ownership correction landed here.
