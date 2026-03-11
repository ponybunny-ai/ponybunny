# Session 76: Gateway Compatibility Surface Consolidation

## Seam Reviewed

This session reviewed only the remaining gateway-named surfaces still relevant to scheduler-owned composition or adapter import paths after Sessions 74 and 75:

- `src/gateway/integration/scheduler-factory.ts`
- `src/gateway/integration/scheduler-repository-adapter.ts`
- `src/gateway/integration/execution-engine-adapter.ts`
- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`
- adjacent true gateway boundaries checked only for classification:
  - `src/gateway/integration/scheduler-bridge.ts`
  - `src/gateway/integration/daemon-bridge.ts`

The focused question was which of these still represented live scheduler/gateway ownership debt rather than real gateway integration boundaries.

## Reviewed Surfaces And Classification

| Surface | Classification | Decision |
|---|---|---|
| `src/gateway/integration/scheduler-factory.ts` | temporary compatibility shell | Keep. It preserves the historical `createScheduler(...)` surface, but scheduler-owned entry points already use `createDefaultScheduler(...)` directly. |
| `src/gateway/integration/scheduler-repository-adapter.ts` | temporary compatibility shell | Keep. Session 75 already moved the concrete adapter under `src/scheduler/composition/`; the gateway file remains only as a re-export shell. |
| `src/gateway/integration/execution-engine-adapter.ts` | misplaced scheduler-owned boundary | Re-home the concrete class under `src/scheduler/composition/` and reduce the gateway file to a shim. |
| `src/gateway/integration/index.ts` | redundant pass-through compatibility barrel for scheduler-owned concerns | Keep as a compatibility barrel, but retarget its scheduler-owned exports directly to scheduler/runtime-owned paths instead of gateway-local implementations. |
| `src/gateway/index.ts` | broad public compatibility barrel containing scheduler-owned exports | Keep for compatibility, but retarget scheduler-owned exports directly to scheduler/runtime-owned paths. |
| `src/gateway/integration/scheduler-bridge.ts` | true gateway-owned integration boundary | Keep unchanged. It translates scheduler events into gateway event-bus broadcasts. |
| `src/gateway/integration/daemon-bridge.ts` | true gateway-owned integration boundary | Keep unchanged. It adapts daemon event emission into gateway events. |

## Chosen Consolidation Cluster

This session implemented one tightly-coupled cluster:

- move the remaining legacy `ExecutionEngineAdapter` implementation into a scheduler-owned namespace
- reduce the historical gateway file to a thin compatibility shell
- retarget the gateway compatibility barrels so scheduler-owned concerns resolve straight to scheduler/runtime-owned targets instead of gateway-local wrappers

That cluster is larger than a single-file move, but it stays inside the same RF-034 seam-closure objective and does not alter transport, daemon lifecycle, worker ownership, replay, or runtime semantics.

## What Moved, Was Re-Routed, Or Was Removed

The concrete legacy execution adapter implementation now lives at:

- `src/scheduler/composition/execution-engine-adapter.ts`

Scheduler-owned export surfaces now expose it from scheduler-owned locations:

- `src/scheduler/composition/index.ts`
- `src/scheduler/index.ts`

The historical gateway file now exists only as a compatibility shim:

- `src/gateway/integration/execution-engine-adapter.ts`

The gateway compatibility barrels were tightened so their scheduler-owned exports point directly at scheduler/runtime-owned targets:

- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`

No runtime behavior was removed. The only deleted logic was duplicate ownership of the concrete `ExecutionEngineAdapter` implementation under a gateway-named path.

## Compatibility Shells That Remain And Why

The remaining deliberate compatibility shells after this session are:

- `src/gateway/integration/scheduler-factory.ts`
  - Keeps the historical `createScheduler(...)` surface for callers still using the gateway-named path.
- `src/gateway/integration/scheduler-repository-adapter.ts`
  - Keeps the historical repository-adapter import path while the concrete implementation lives under scheduler composition.
- `src/gateway/integration/execution-engine-adapter.ts`
  - Keeps the historical execution-adapter import path while the concrete implementation now lives under scheduler composition.
- `src/gateway/integration/index.ts`
  - Remains as a compatibility barrel for existing callers, but no longer owns scheduler adapter implementation.
- `src/gateway/index.ts`
  - Remains as the public gateway barrel for existing callers, but its scheduler-owned exports are now direct pass-throughs to scheduler/runtime-owned targets.

Scheduler-owned runtime paths do not depend on these gateway-named shells on the live default composition path.

## What Was Intentionally Postponed

This session intentionally did not:

- remove `createScheduler(...)` from gateway-named surfaces
- delete gateway barrels that may still serve external callers
- change `LocalExecutionAdapter` placement or semantics
- redesign transport, daemon lifecycle, execution/recovery, worker, replay, or event-bus ownership
- broaden into unrelated gateway integration cleanup

The remaining work is now mostly about whether the compatibility barrels themselves can eventually be narrowed further without breaking external callers.

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

- `npx jest test/scheduler/composition/execution-engine-adapter.test.ts`
- `npx jest test/gateway/integration/execution-engine-adapter.test.ts`
- `npx jest test/scheduler/composition/scheduler-repository-adapter.test.ts`
- `npm run build`

Additional focused confirmation:

- searched current imports to confirm scheduler-owned runtime entry points continue to resolve through `src/scheduler/composition/*` or `src/runtime/execution-boundary/*`, not gateway-named adapter files

## Recommended Next RF-034 Target

The next highest-value RF-034 follow-up is a narrow review of whether the remaining gateway barrels and factory shim can be consolidated into one intentionally documented compatibility layer for external callers, while keeping scheduler-owned runtime paths entirely on scheduler/runtime namespaces.
