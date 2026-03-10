# Session 77: RF-034 Closure Attempt

## Closure Review Scope

This session reviewed the remaining gateway-side surfaces still relevant to scheduler-owned composition or adapter concerns after Sessions 74-76:

- `src/gateway/integration/scheduler-compatibility.ts`
- `src/gateway/integration/scheduler-factory.ts`
- `src/gateway/integration/scheduler-repository-adapter.ts`
- `src/gateway/integration/execution-engine-adapter.ts`
- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`
- `src/gateway/integration/scheduler-bridge.ts`

The review question was whether any of these still represented live scheduler-owned runtime dependency direction through gateway-named modules, or whether they had become either true gateway boundaries or intentional compatibility-only surfaces.

## Reviewed Surfaces And Classification

| Surface | Classification | Decision |
|---|---|---|
| `src/gateway/integration/scheduler-compatibility.ts` | keep as minimal compatibility shim | Keep. This is now the single intentional gateway-side compatibility surface for historical scheduler composition and adapter imports. |
| `src/gateway/integration/scheduler-factory.ts` | keep as minimal compatibility shim | Keep. It preserves the historical direct factory import path, but now only re-exports from `scheduler-compatibility.ts`. |
| `src/gateway/integration/scheduler-repository-adapter.ts` | keep as minimal compatibility shim | Keep. It preserves the historical adapter path, but now only re-exports from `scheduler-compatibility.ts`. |
| `src/gateway/integration/execution-engine-adapter.ts` | keep as minimal compatibility shim | Keep. It preserves the historical adapter path, but now only re-exports from `scheduler-compatibility.ts`. |
| `src/gateway/integration/index.ts` | keep as minimal compatibility shim | Keep. It remains an integration-level barrel for existing callers, but its scheduler-owned exports now route only through the intentional compatibility module. |
| `src/gateway/index.ts` | true gateway-owned boundary | Keep. It is the public gateway barrel; its scheduler-related exports now point at the intentional compatibility module instead of implying direct gateway ownership of scheduler composition. |
| `src/gateway/integration/scheduler-bridge.ts` | true gateway-owned boundary | Keep unchanged. It is still the real gateway-owned scheduler-to-event-bus bridge. |

## Consolidation Implemented

This session consolidated the remaining scheduler-related gateway compatibility exports into one explicit file:

- `src/gateway/integration/scheduler-compatibility.ts`

That file now owns the only gateway-side compatibility definitions for:

- `createScheduler(...)`
- `ExecutionEngineAdapter`
- `SchedulerRepositoryAdapter`
- `LocalExecutionAdapter`
- factory compatibility types

The historical direct import paths remain, but are now intentionally thin shells:

- `src/gateway/integration/scheduler-factory.ts`
- `src/gateway/integration/scheduler-repository-adapter.ts`
- `src/gateway/integration/execution-engine-adapter.ts`

The gateway barrels were also narrowed so their scheduler-related exports point at that one compatibility surface:

- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`

No scheduler-owned runtime path was moved back behind gateway naming. Scheduler-owned entry points still compose directly from scheduler/runtime-owned namespaces such as:

- `src/scheduler/composition/index.ts`
- `src/runtime/execution-boundary/index.ts`

## Remaining Compatibility Surfaces

The intentional RF-034-compatible remainder after this session is:

- `src/gateway/integration/scheduler-compatibility.ts`
  - the single documented compatibility layer for historical gateway-named scheduler composition/adapter imports
- `src/gateway/integration/scheduler-factory.ts`
  - direct historical import-path shim
- `src/gateway/integration/scheduler-repository-adapter.ts`
  - direct historical import-path shim
- `src/gateway/integration/execution-engine-adapter.ts`
  - direct historical import-path shim
- `src/gateway/integration/index.ts`
  - compatibility barrel for existing integration imports
- `src/gateway/index.ts`
  - true public gateway boundary that re-exports the compatibility layer

These remaining surfaces do not block RF-034 closure because:

- scheduler-owned runtime paths no longer depend on them for scheduler-owned concerns
- the compatibility layer is now explicit and minimal instead of being spread across multiple gateway-local ownership signals
- the only non-compatibility gateway surface in this review set is the real gateway-owned `SchedulerBridge`

## RF-034 End-State Decision

`RF-034` is closed.

Justification:

- The original live ownership-direction issue was that scheduler-owned composition and adapter concerns were still presented through gateway-named modules as if gateway owned them.
- Sessions 72, 74, 75, and 76 already moved the concrete conversation bootstrap, default scheduler composition, repository adapter, and execution adapter into scheduler/runtime-owned namespaces.
- This session reduced the leftover gateway surfaces to one intentional compatibility layer plus thin import-preserving shells and true gateway boundaries.
- A further deletion-first pass would mostly be public-surface cleanup for external callers, not remaining RF-034 blocker work.

Any future narrowing of historical gateway import paths is now out-of-scope cleanup, not unfinished RF-034 ownership work.

## Preserved Invariants

This session preserved:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` local-authoritative seam invariants
- `ConversationWorker` local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `LLMStreamEventSink` ownership direction
- extracted conversation bootstrap ownership
- outer transport ownership lines
- durable ownership lines
- current `SchedulerRepository` persistence semantics
- current daemon and scheduler CLI behavior
- current replay behavior
- current scheduling semantics
- current `LocalExecutionAdapter` semantics
- current `runtimeEventBus` semantics and ownership

## Validation Summary

Validated in this session:

- `npx jest test/gateway/integration/execution-engine-adapter.test.ts`
- `npx jest test/scheduler/composition/scheduler-repository-adapter.test.ts`
- `npx jest test/scheduler/composition/execution-engine-adapter.test.ts`
- import scan confirming no current imports from `src/scheduler`, `src/runtime`, or `src/scheduler-daemon` back into:
  - `src/gateway/integration/scheduler-factory.ts`
  - `src/gateway/integration/scheduler-repository-adapter.ts`
  - `src/gateway/integration/execution-engine-adapter.ts`
  - `src/gateway/index.ts`

Targeted suite run with a pre-existing failure:

- `npx jest test/gateway/integration/scheduler-factory.test.ts`
  - the existing `should wire evented execution mode through the factory` assertion still fails because `mockRuntimeEventBus.publish(...)` is not called on the unchanged `createDefaultScheduler(...)` path
  - this session did not modify `src/scheduler/composition/default-scheduler.ts` or scheduler evented behavior

## Runtime Behavior Change Check

Runtime behavior remained unchanged because this session only:

- centralized re-export/alias ownership for compatibility imports
- preserved all historical import paths
- left scheduler composition, runtime execution boundaries, transport, replay, daemon lifecycle, and worker logic untouched
