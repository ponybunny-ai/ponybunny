# Session 93: Remaining Mixed Service-Wiring Review and Landing

## Summary

This session continued `RF-061` by reviewing the remaining mixed service-wiring pressure inside and immediately adjacent to `GatewayServer`, then extracting the highest-value next cluster without changing runtime behavior.

The selected cluster was the gateway admin/runtime RPC control-plane wiring that was still assembled inline in `GatewayServer.registerHandlers()`:

- `system.status` and related gateway status/reporting hooks
- runtime rollout metrics exposure and rollout forwarding hooks
- scheduler model-override forwarding and local fallback reads
- channel admin update bridging
- realtime IPC metric exposure
- `internal.runtime.config` and dry-run rollout callback wiring

That wiring now lives in `src/gateway/runtime/gateway-runtime-rpc-surface.ts`. `GatewayServer` remains the steady-state runtime owner for WebSocket lifecycle, connection handling, scheduler/daemon attachment, and top-level runtime APIs, while the new helper owns the internal admin/control-plane graph assembly around `system.*` and `internal.runtime.*`.

## Reviewed Surfaces

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/gateway-server.ts` | mixed steady-state runtime owner plus remaining internal control-plane wiring | After Sessions 89-92, the largest remaining mixed area was the inline `system.*` / `internal.runtime.*` registration and coordination block inside `registerHandlers()`. |
| `src/gateway/runtime/gateway-runtime-rpc-surface.ts` | new explicit internal service-wiring / graph-assembly helper | Now owns the gateway-adjacent admin/runtime RPC assembly cluster that was still mixed into `GatewayServer`. |
| `src/gateway/rpc/handlers/system-handlers.ts` | true RPC handler-definition surface | Endpoint behavior, validation, config mutation semantics, and response shapes already lived here; this session did not redesign those handlers. |
| `src/gateway/rpc/handlers/internal-runtime-handlers.ts` | true RPC handler-definition surface | Deterministic-runtime inspection/replay/plan surfaces remain here; this session only changed who wires gateway dependencies into it. |
| `src/gateway/channels/gateway-channel-runtime.ts` | previously extracted internal runtime graph helper | Session 89 already isolated channel runtime ownership; intentionally not reopened. |
| `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts` | previously extracted internal rollout/rollback wiring helper | Session 90 already isolated rollout telemetry, threshold evaluation, rollback coordination, and rollout forwarding. |
| `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts` | previously extracted internal audit observation helper | Session 91 already isolated scheduler-event audit subscription wiring. |
| `src/gateway/runtime/gateway-tool-provider-runtime.ts` | previously extracted internal tool/provider wiring helper | Session 92 already isolated gateway-local tool/provider graph assembly. |
| `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` | startup/bootstrap helper already closed by `RF-060` | Reviewed only to confirm the remaining mixed concern was not startup sequencing. |
| gateway/daemon attachment, detach, and IPC transport helpers | transport-boundary concern already closed in Sessions 78-82 | Reviewed only as needed because the selected cluster still talks to `IPCBridge`, but transport ownership itself remained stable. |
| gateway/public compatibility surfaces | compatibility/public-surface concern already closed in Sessions 83-85 | No public exports, RPC payloads, or compatibility shims changed. |

## Role Classification

### True steady-state `GatewayServer` runtime-owned behavior

- WebSocket server lifecycle and connection handling
- direct connection/session/auth/message routing ownership
- daemon attachment and scheduler attachment APIs
- top-level server stats and runtime lifecycle delegation
- event bus ownership and runtime-owned component references

### True internal service wiring / graph assembly concern

- wiring the gateway-specific dependency bundle into `registerSystemHandlers(...)`
- wiring the gateway-specific dependency bundle into `registerInternalRuntimeHandlers(...)`
- bridging channel admin updates from system RPC down to `GatewayChannelRuntime`
- bridging rollout metrics/coverage and dry-run callbacks between handlers and `GatewayRuntimeRolloutCoordinator`
- bridging scheduler model-override reads/writes between handlers and `IPCBridge`, including local fallback reads from runtime config
- assembling gateway status snapshots from attachment/scheduler bridge state for handler consumption

### Already-closed adjacent concerns not reopened

- startup/bootstrap sequencing in `RF-060`
- gateway/daemon transport-boundary work from Sessions 78-82
- compatibility/public-surface work from Sessions 83-85
- channel runtime extraction from Session 89
- rollout telemetry / rollback extraction from Session 90
- scheduler-event audit extraction from Session 91
- tool/provider extraction from Session 92

## Selected Cluster and Why

The highest-value remaining mixed cluster was the admin/runtime RPC control-plane assembly around `system.*` and `internal.runtime.*`.

It was chosen because:

- it was still materially mixed into `GatewayServer.registerHandlers()` after the larger obvious runtime families had already been extracted
- it bundled several distinct gateway-adjacent coordination paths in one inline block: status reporting, rollout coordination, model override forwarding, channel admin updates, realtime IPC metrics, and internal runtime config exposure
- it was service-wiring pressure rather than true live runtime behavior
- it could be extracted cleanly without reopening startup, transport, compatibility, scheduler semantics, daemon semantics, replay semantics, or worker ownership

This was a better Session 93 target than trying to force a closure judgment or extracting another runtime family for symmetry. The remaining ambiguity was primarily about who owns the control-plane dependency assembly, not about who owns the handler implementations or core runtime behavior.

## What Changed

### New helper

Added `src/gateway/runtime/gateway-runtime-rpc-surface.ts`.

It now owns:

- registration of `system.*` handlers against gateway-local dependencies
- registration of `internal.runtime.*` handlers against gateway-local dependencies
- gateway status snapshot assembly for handler/reporting consumers
- channel admin update bridging into `GatewayChannelRuntime`
- rollout metrics/coverage exposure and dry-run callback wiring into `GatewayRuntimeRolloutCoordinator`
- scheduler model-override IPC forwarding plus disconnected fallback reads from runtime config
- realtime IPC metrics exposure for `system.status`

### `GatewayServer` after the extraction

`GatewayServer` now:

- constructs one `GatewayRuntimeRpcSurface`
- delegates the mixed control-plane handler registration cluster through `this.runtimeRpcSurface.register()`
- reuses `this.runtimeRpcSurface.getGatewayStatusSnapshot()` for its own `getStats()` path
- continues to own live server lifecycle, connection handling, scheduler/daemon attach APIs, runtime lifecycle delegation, and the simpler top-level RPC registrations that are truly server-local

### What moved / what was re-routed / what was clarified

- The inline `registerSystemHandlers(...)` dependency bundle moved out of `GatewayServer`.
- The inline `registerInternalRuntimeHandlers(...)` dependency bundle moved out of `GatewayServer`.
- The gateway status snapshot assembly logic moved behind the new helper.
- The gateway-side model-override IPC bridge/fallback logic moved behind the new helper.
- The channel admin update bridge and rollout dry-run callback wiring moved behind the new helper.
- `GatewayServer` still owns the underlying runtime collaborators; the new helper only makes the mixed control-plane assembly explicit.

No RPC method names, payloads, validation behavior, scheduler behavior, daemon behavior, attach/detach semantics, runtime event-bus ownership, persistence semantics, or public runtime behavior changed.

## Adjacent Extracted Surfaces Intentionally Left Untouched

- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
  - startup/shutdown sequencing was already extracted and remains the correct boundary
- `src/gateway/channels/gateway-channel-runtime.ts`
  - Session 89 already isolated channel runtime ownership; this session only reused its existing APIs
- `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts`
  - Session 90 already isolated rollout telemetry/rollback logic; Session 93 only routes existing callbacks to it
- `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts`
  - Session 91 already isolated scheduler-event audit observation
- `src/gateway/runtime/gateway-tool-provider-runtime.ts`
  - Session 92 already isolated tool/provider graph assembly
- gateway/daemon attachment, detach, and IPC transport modules
  - Sessions 78-82 already established the transport ownership lines
- compatibility/public barrels and historical shims
  - Sessions 83-85 already closed that public-surface block

These surfaces were reviewed for adjacency only. They were intentionally kept stable so Session 93 stayed on one remaining mixed service-wiring objective.

## Intentionally Postponed

Still deferred after this session:

- any additional pruning of `GatewayServer.registerHandlers()` beyond the control-plane cluster landed here
- any review of whether the remaining goal/work-item/escalation/debug/audit/conversation registration calls are true runtime-owned API surface or another future wiring cluster
- any simplification inside `system-handlers.ts` or `internal-runtime-handlers.ts` themselves
- any broader runtime-core or package-architecture cleanup outside `GatewayServer` adjacency
- any closure judgment for `RF-061`

`RF-061` looks closer to closure than it did in Session 92 because the remaining mixed control-plane assembly knot is now explicit. It still looks multi-session, though, because `GatewayServer` retains a few remaining inline registration and coordination surfaces that need one more focused review before a credible closure decision.

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
- scheduler-event audit extraction established in Session 91
- tool/provider extraction established in Session 92
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

- `npx jest test/gateway/gateway-runtime-rpc-surface-ownership.test.ts test/gateway/rpc/system-handlers.test.ts test/gateway/rpc/internal-runtime-handlers.test.ts`
- `npm run build`

Results:

- the new ownership characterization test passed
- existing `system-handlers` and `internal-runtime-handlers` suites remained green after the extraction
- full project TypeScript build passed
- no runtime-semantics changes were introduced in the touched control-plane wiring paths

## Recommended Next Session

Stay in `RF-061`, but do not force closure yet. Review the remaining inline `GatewayServer` registration/coordination surfaces and determine whether one last cohesive cluster still represents internal service wiring rather than true steady-state runtime ownership.

The best next candidate appears to be one of:

- the remaining non-control-plane RPC registration family, if a real internal wiring seam still exists there
- or an explicit decision that the residual `GatewayServer` surface is now mostly true runtime ownership, backed by one closure-review session rather than another extraction
