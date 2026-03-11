# Session 91: Scheduler-Event Audit Wiring Rationalization

## Summary

This session continued `RF-061` by reviewing the scheduler-event audit-related surfaces still living inside and immediately adjacent to `GatewayServer`, then extracting one cohesive internal observation/audit wiring helper without changing runtime semantics.

The selected consolidation cluster was the scheduler-event audit observation path:

- the set of scheduler-derived gateway event names audited by the gateway
- the event-bus subscription wiring for those events
- the unsubscribe bookkeeping for that observation graph
- the forwarding of audited event payloads into `AuditService`

`GatewayServer` remains the steady-state runtime owner. The new helper makes scheduler-event observation and audit persistence wiring explicit instead of leaving that concern mixed into the live server alongside runtime-owned APIs and state.

## Reviewed Surfaces

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/gateway-server.ts` | mixed steady-state runtime owner plus internal scheduler-event audit wiring | Still owns live gateway runtime state and public/runtime APIs, but Session 90 left scheduler-event audit subscriptions and unsubscribe bookkeeping inline here. |
| `src/gateway/channels/gateway-channel-runtime.ts` | previously extracted internal runtime graph helper | Session 89 already isolated channel runtime graph assembly; intentionally not reopened. |
| `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts` | previously extracted internal observation / rollback coordination helper | Session 90 already isolated rollout telemetry and rollback wiring; intentionally not reopened. |
| new `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts` | explicit internal scheduler-event observation / audit wiring helper | Now owns the scheduler-derived event subscription set, audit forwarding, and teardown bookkeeping for this concern. |
| `src/gateway/integration/scheduler-bridge.ts` | true event-observation translation boundary, but not an audit/persistence owner | Still converts scheduler events into gateway event-bus events for runtime consumers; not changed because transport/event translation ownership is already correct. |
| `src/gateway/integration/ipc-bridge.ts` scheduler-event routing | transport-boundary concern already closed in Sessions 78-82 | Reviewed only to confirm that daemon-delivered scheduler events continue to land on the same gateway event bus; not reopened. |
| `src/infra/audit/audit-service.ts` | true audit/persistence reporting primitive | Audit persistence API already existed and remains the audit sink used by the new helper. |
| `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` | startup/bootstrap helper already closed by `RF-060` | Startup/shutdown sequencing still calls setup/teardown hooks, but no startup-boundary redesign was required. |
| gateway/public compatibility surfaces | compatibility/public-surface concern already closed in Sessions 83-85 | No public exports or compatibility shims changed. |
| `SchedulerEventAdapter` and runtime event-bus wiring | true runtime-event-bus concern, intentionally untouched | Runtime event bus semantics and ownership stay separate from audit persistence wiring. |
| tool registry / global tool provider wiring | separate mixed runtime-core concern | Still deferred because it is not part of the scheduler-event audit cluster. |

## Selected Consolidation Cluster

The highest-value next cluster after Session 90 was the scheduler-event audit observation path because it still blurred two roles inside `GatewayServer`:

- steady-state runtime ownership that should remain in the live server
- internal observation/audit persistence wiring that does not need to stay inline there

This cluster was chosen because:

- it was directly adjacent to `GatewayServer`
- it mixed event-name policy, observation registration, and teardown bookkeeping into the live runtime owner
- it could be extracted cleanly without reopening startup/bootstrap, transport, compatibility, rollout, or scheduler behavior

This was a better Session 91 target than broader helper cleanup because it was a real runtime-graph ownership ambiguity rather than a naming-only issue.

## What Changed

### New internal helper

Added `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts`.

It now owns:

- the scheduler-derived gateway event set currently audited by the gateway
- event-bus subscription registration for those events
- filtering to object payloads before audit forwarding
- unsubscribe bookkeeping and teardown for that observation graph
- forwarding audited event payloads to `AuditService.logSchedulerEvent(...)`

### `GatewayServer` after the extraction

`GatewayServer` now:

- constructs one `GatewaySchedulerEventAuditObserver`
- keeps ownership of the event bus, scheduler bridge, scheduler-event adapter, RPC registration, lifecycle delegation, and audit service
- delegates startup/shutdown audit observation setup through the existing lifecycle callbacks

The resulting distinction is clearer:

- `GatewayServer`: steady-state runtime owner and public/runtime API surface
- `GatewaySchedulerEventAuditObserver`: gateway-internal scheduler-event observation and audit persistence wiring

### What was re-routed and what was clarified

- The inline scheduler-event list moved out of `GatewayServer`.
- The unsubscribe array and setup/teardown implementation moved out of `GatewayServer`.
- `gateway-server-runtime-lifecycle.ts` still invokes setup/teardown hooks, but those hooks now clearly target an internal audit-observation helper rather than hidden inline logic on the live server.

No scheduler events, audit payloads, RPC routes, transport messages, or runtime event-bus flows were changed.

## Adjacent Surfaces Intentionally Left Untouched

- `src/gateway/bootstrap/default-gateway-runtime.ts`
  - startup/bootstrap composition-root work was already closed by `RF-060`
- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
  - startup/shutdown sequencing remains the correct helper boundary; this session only rerouted its existing audit hooks
- `src/gateway/channels/gateway-channel-runtime.ts`
  - Session 89 already isolated the channel runtime family
- `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts`
  - Session 90 already isolated rollout telemetry / rollback wiring
- gateway/daemon attachment, detach, and IPC transport helpers
  - Sessions 78-82 already closed those transport-boundary ownership lines
- compatibility/public surfaces and historical shims
  - Sessions 83-85 already closed that block
- scheduler behavior, daemon behavior, replay, ToolWorker, ConversationWorker, execution/recovery semantics
  - all out of scope for this session
- runtime event-bus ownership and `SchedulerEventAdapter`
  - separate steady-state/runtime-event concerns, not audit-persistence wiring

## Intentionally Postponed

Intentionally postponed after this session:

- any remaining gateway-adjacent tool registry / global tool-provider wiring pressure
- any broader runtime-core cleanup outside the scheduler-event audit cluster
- any review of whether `SchedulerBridge` and `IPCBridge` should eventually share a deeper event normalization primitive, because that would broaden into transport/runtime-event concerns rather than audit wiring

`RF-061` still clearly looks like a multi-session block after this session. The largest scheduler-event audit knot is now explicit, but `GatewayServer` still has other adjacent internal graph/service-wiring concerns that should be treated separately.

## Preserved Invariants

This session preserved:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- ToolWorker local-authoritative seam invariants
- ConversationWorker local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `LLMStreamEventSink` ownership direction
- extracted conversation bootstrap ownership
- scheduler composition ownership established during `RF-034`
- gateway/daemon transport-boundary ownership established in Sessions 78-82
- compatibility/public-surface split established in Sessions 83-85
- startup/bootstrap ownership improvements established in Sessions 86-88
- channel runtime extraction established in Session 89
- rollout telemetry / rollback extraction established in Session 90
- outer transport ownership lines
- durable ownership lines
- current scheduler behavior
- current daemon startup behavior
- current gateway startup behavior
- current replay behavior
- current direct vs evented execution semantics
- current `runtimeEventBus` semantics and ownership
- current persistence semantics
- current public runtime behavior
- current attach/connect and detach/unsubscribe semantics

## Validation Summary

Validated with:

- `npx jest test/gateway/runtime/gateway-scheduler-event-audit-observer.test.ts test/gateway/gateway-scheduler-audit-runtime-ownership.test.ts test/gateway/gateway-rollout-runtime-ownership.test.ts test/gateway/gateway-startup-runtime-ownership.test.ts test/gateway/bootstrap/gateway-server-runtime-lifecycle.test.ts`
- `npx tsc --noEmit`

Results:

- focused Jest coverage passed
- ownership/lifecycle characterization tests passed
- full TypeScript check passed
- no runtime-semantics regressions were observed in the touched gateway/audit wiring paths

## Recommended Next Session

Stay in `RF-061`, but choose only one remaining GatewayServer-adjacent service-wiring cluster. The best next candidate appears to be the gateway tool-registry / global tool-provider wiring pressure, if it can be isolated without reopening broader runtime-core structure or public compatibility surfaces.
