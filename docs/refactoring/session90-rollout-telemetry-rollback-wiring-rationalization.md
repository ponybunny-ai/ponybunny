# Session 90: Rollout Telemetry / Rollback Wiring Rationalization

## Summary

This session continued `RF-061` by reviewing the rollout telemetry and rollback-related service wiring still living inside and immediately adjacent to `GatewayServer`, then extracting one cohesive internal helper without changing runtime semantics.

The selected consolidation cluster was the rollout telemetry plus rollback coordination path:

- event-bus telemetry subscription wiring for rollout metrics
- session-first threshold evaluation
- rollback-to-legacy runtime-config mutation
- scheduler-daemon rollout forwarding used by rollback and RPC updates
- dry-run failure handling routed from internal runtime handlers

`GatewayServer` remains the steady-state runtime owner. The new helper makes the observation/recovery-coordination role explicit instead of leaving that graph mixed into the server alongside live runtime APIs.

## Reviewed Surfaces

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/gateway-server.ts` | mixed steady-state runtime owner plus internal telemetry/recovery wiring | Still owns live gateway runtime state, but Session 89 left rollout telemetry/rollback coordination inline here. |
| `src/gateway/channels/gateway-channel-runtime.ts` | previously extracted internal runtime graph helper | Session 89 already isolated the channel family; intentionally not reopened. |
| `src/gateway/runtime/runtime-rollout-telemetry.ts` | true internal telemetry primitive | Counter/aggregation primitive was already separate, but its event subscription and rollback use remained mixed into `GatewayServer`. |
| new `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts` | explicit internal telemetry / rollback coordination helper | Now owns event-driven telemetry wiring, threshold checks, rollback-to-legacy mutation, and scheduler rollout forwarding for this concern. |
| `src/gateway/rpc/handlers/system-handlers.ts` rollout hooks | mixed runtime API plus internal coordination callback seam | Public `system.runtime.rollout.*` surface stays unchanged; `GatewayServer` now satisfies it through the helper instead of inline logic. |
| `src/gateway/rpc/handlers/internal-runtime-handlers.ts` dry-run callback hook | internal recovery/observation hook | Still the right seam for dry-run completion notification; now routed into the new helper. |
| `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` | startup/bootstrap helper already closed by `RF-060` | Startup/shutdown sequencing was reviewed only to confirm it is not part of this cluster. |
| gateway/daemon attachment and IPC transport helpers | transport-boundary concern already closed in Sessions 78-82 | No transport-boundary redesign was needed; the helper only uses the existing scheduler-daemon rollout transport seam. |
| compatibility/public export surfaces | compatibility/public-surface concern already closed in Sessions 83-85 | No public API change or compatibility rerouting was required. |
| scheduler-event audit wiring in `GatewayServer` | separate internal observation wiring concern | Reviewed as adjacent, but intentionally postponed so this session stays within one rollout/rollback objective. |

## Selected Consolidation Cluster

The highest-value next cluster after Session 89 was the rollout telemetry / rollback path because it still blurred two different roles inside `GatewayServer`:

- steady-state runtime ownership that should remain in the live server
- internal observation and rollback/recovery coordination wiring that does not need to stay inline there

This cluster was chosen over scheduler-event audit wiring because:

- it already crossed constructor event subscriptions, dry-run hooks, runtime-config mutation, and scheduler-daemon rollout forwarding
- it was directly tied to rollout/rollback ownership, which the session specifically targeted
- it could be extracted as one cohesive multi-file unit without reopening startup/bootstrap, transport, compatibility, or execution semantics

## What Changed

### New internal helper

Added `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts`.

It now owns:

- subscription to rollout telemetry events on the gateway event bus
- aggregation through `RuntimeRolloutTelemetry`
- session-goal coverage collection from the repository
- threshold evaluation for conversation success, run success, and goal/session coverage
- rollback-to-legacy config mutation when rollback-on-failure is enabled
- scheduler-daemon rollout forwarding for rollback and system rollout updates
- failed dry-run handling routed from `registerInternalRuntimeHandlers(...)`

### `GatewayServer` after the extraction

`GatewayServer` now:

- constructs one `GatewayRuntimeRolloutCoordinator`
- delegates `system.runtime.rollout.*` metrics/coverage/apply hooks through that helper
- delegates internal dry-run completion handling through that helper
- keeps live runtime ownership of the event bus, IPC bridge, scheduler connection, RPC registration, channel runtime, and lifecycle sequencing

The resulting distinction is clearer:

- `GatewayServer`: steady-state runtime owner and public/runtime API surface
- `GatewayRuntimeRolloutCoordinator`: gateway-internal rollout observation and rollback coordination wiring

## Adjacent Surfaces Intentionally Left Untouched

- `src/gateway/channels/gateway-channel-runtime.ts`
  - channel runtime extraction from Session 89 is already the correct boundary
- `src/gateway/bootstrap/default-gateway-runtime.ts`
  - startup/bootstrap composition-root work was already closed by `RF-060`
- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
  - startup/shutdown sequencing remains intentionally separate from runtime graph cleanup
- gateway/daemon attachment, detach, and transport helpers
  - Sessions 78-82 already established those ownership lines
- compatibility/public surfaces and historical shims
  - Sessions 83-85 already closed that block
- scheduler behavior, daemon behavior, replay, workers, execution/recovery semantics
  - all out of scope for this session
- scheduler-event audit hook ownership
  - still adjacent, but postponed so this session remains one rollout/rollback cluster

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

## Postponed Items

Intentionally postponed after this session:

- scheduler-event audit wiring still inside `GatewayServer`
- gateway tool-registry / global tool-provider wiring and adjacent singleton pressure
- any broader GatewayServer-adjacent runtime-core cleanup outside rollout telemetry / rollback wiring

`RF-061` still clearly looks like a multi-session block after this session. Session 90 removed one meaningful mixed rollout/rollback cluster, but `GatewayServer` still has at least one additional internal observation/wiring family worth addressing separately.

## Validation Summary

Validated with:

- `npx jest test/gateway/runtime/gateway-runtime-rollout-coordinator.test.ts test/gateway/runtime/runtime-rollout-telemetry.test.ts test/gateway/rpc/system-handlers.test.ts test/gateway/gateway-startup-runtime-ownership.test.ts test/gateway/gateway-rollout-runtime-ownership.test.ts`
- `npx tsc --noEmit`

Results:

- all focused Jest suites passed
- full TypeScript check passed
- one expected test-run console warning was emitted by the new helper during threshold-trigger coverage; it reflects the preserved rollback path rather than a failure

## Recommended Next Session

Stay in `RF-061` and review the next GatewayServer-adjacent mixed observation/wiring family, most likely scheduler-event audit hook ownership. That should remain a separate bounded session and should not reopen startup/bootstrap, transport, compatibility, or broader runtime-core structure.
