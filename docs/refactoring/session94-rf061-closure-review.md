# Session 94: RF-061 Closure Review

## Summary

This session performed the explicit closure review for `RF-061` by inspecting the remaining inline registration, coordination, and state surfaces inside and immediately adjacent to `GatewayServer`.

Closure path chosen: `Path 1 — Close RF-061 now`.

The review found that the large internal wiring families previously mixed into `GatewayServer` have already been extracted in Sessions 89-93. The remaining inline surfaces are now either:

- true steady-state `GatewayServer` runtime ownership
- intentionally stable extracted helper boundaries
- concerns already closed by earlier blocks (`RF-060`, Sessions 78-85)

No final small extraction was justified by the current code structure. Forcing one more helper would mostly repackage live gateway ownership rather than clarify a real residual graph-assembly concern.

## Reviewed Remaining Surfaces

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/gateway-server.ts` constructor-time event wiring to `GatewayChannelRuntime` | acceptable steady-state runtime ownership | The server owns the event bus and connection lifecycle; routing authenticated/disconnected and fanout events into the already-extracted channel runtime is part of live gateway runtime ownership, not a separate composition-root concern. |
| `src/gateway/gateway-server.ts` `registerHandlers()` non-control-plane registrations | true runtime/public API ownership | The remaining registrations are direct gateway RPC surface assembly for goal, work item, escalation, approval, debug, conversation, audit, plus three trivial `system.*` methods. After Session 93 removed the mixed control-plane dependency bundle, this remaining method is mostly the server exposing its public runtime API. |
| `src/gateway/gateway-server.ts` config-watch change handling | acceptable steady-state runtime ownership | Emitting `config.changed` and optionally triggering gateway restart is a live gateway runtime reaction to file-watch events. It is adjacent to startup/bootstrap, but not startup-only sequencing and not a reusable internal graph-assembly family. |
| `src/gateway/gateway-server.ts` `start()` / `stop()` / `restartServer()` | true runtime-owned lifecycle surface | Session 88 already extracted startup/shutdown sequencing into `gateway-server-runtime-lifecycle.ts`. The remaining methods are the server's own runtime lifecycle API around `WebSocketServer` creation and shutdown. |
| `src/gateway/gateway-server.ts` `connectDaemon()` / `connectScheduler()` / `disconnectScheduler()` / `getStats()` | true runtime-owned gateway attachment/status behavior | These are live gateway APIs over already-extracted transport/helper boundaries and do not represent residual internal graph assembly. |
| `src/gateway/gateway-server.ts` `buildRuntimeLifecycleDependencies()` | acceptable runtime-owned delegation seam | This is a narrow dependency bundle from the live server into the already-closed startup/runtime lifecycle helper. It does not justify reopening `RF-060`. |
| `src/gateway/channels/gateway-channel-runtime.ts` | already-extracted RF-061 helper | Session 89 already isolated channel runtime assembly, persistence helpers, adapter coordination, and event capture. |
| `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts` | already-extracted RF-061 helper | Session 90 already isolated rollout telemetry subscription, threshold evaluation, rollback coordination, and scheduler rollout forwarding. |
| `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts` | already-extracted RF-061 helper | Session 91 already isolated scheduler-event audit subscription ownership and teardown. |
| `src/gateway/runtime/gateway-tool-provider-runtime.ts` | already-extracted RF-061 helper | Session 92 already isolated gateway-local tool/provider graph assembly and legacy global mirror wiring. |
| `src/gateway/runtime/gateway-runtime-rpc-surface.ts` | already-extracted RF-061 helper | Session 93 already isolated mixed admin/runtime control-plane dependency assembly. |
| `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` | startup/bootstrap helper already closed by `RF-060` | Reviewed only to confirm the remaining `GatewayServer` methods do not warrant reopening startup/bootstrap ownership. |
| gateway/daemon attachment + IPC transport modules | transport-boundary concern already closed in Sessions 78-82 | Reviewed only as adjacent collaborators. Ownership lines remain correct and intentionally stable. |
| gateway/public compatibility surfaces | compatibility/public-surface concern already closed in Sessions 83-85 | No compatibility or export reshaping was justified here. |

## Closure Judgment

`RF-061` can be closed now.

The key judgment is that the remaining inline `GatewayServer` surfaces are no longer hiding one more cohesive internal wiring family. The residual code falls into two categories:

1. live gateway runtime ownership
2. thin delegation into already-extracted helpers

The strongest candidates for "one last extraction" were reviewed and rejected:

- constructor-time channel event subscriptions
  - rejected because they express the server's ownership of the event bus and connection/session lifecycle while delegating channel-specific behavior into the extracted channel runtime
- remaining handler registration calls
  - rejected because these are now mostly direct public RPC surface exposure, not a mixed dependency-assembly knot like the Session 93 control-plane cluster
- config-watch restart coordination
  - rejected because it is a small runtime reaction owned by the gateway, not a reusable service family or graph-assembly seam
- lifecycle dependency bundling for the startup helper
  - rejected because reopening it would widen back into `RF-060` for negligible structural gain

No residual concern remained that was:

- clearly smaller than Sessions 89-93
- still genuinely internal graph assembly rather than runtime ownership
- safe and worthwhile to extract without symbolic churn

Because that standard was not met, the correct end state is closure, not another extraction.

## What Changed

No production runtime code changed in this session.

Updated in this session:

- this closure-review document
- the `RF-061` task-list row
- one stale ownership characterization test so focused validation matched the post-Session-93 helper split

Nothing moved in the live gateway runtime, no dependencies were rerouted, and no runtime behavior changed.

## Adjacent Extracted Surfaces Intentionally Left Untouched

- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
  - startup/shutdown sequencing remains the correct `RF-060` boundary
- `src/gateway/channels/gateway-channel-runtime.ts`
  - channel runtime extraction from Session 89 remains correct and sufficient
- `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts`
  - rollout/rollback coordination remains the correct Session 90 boundary
- `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts`
  - scheduler-event audit observation remains the correct Session 91 boundary
- `src/gateway/runtime/gateway-tool-provider-runtime.ts`
  - tool/provider graph assembly remains the correct Session 92 boundary
- `src/gateway/runtime/gateway-runtime-rpc-surface.ts`
  - control-plane dependency assembly remains the correct Session 93 boundary
- gateway/daemon attachment, detach, and IPC transport helpers
  - Sessions 78-82 already closed those transport ownership lines
- compatibility/public barrels and historical shims
  - Sessions 83-85 already closed that surface-rationalization block

These boundaries were reviewed only to confirm that no remaining `GatewayServer` pressure required reopening them.

## Preserved Invariants

This closure review preserves:

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
- runtime RPC surface extraction established in Session 93
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

- focused source review of:
  - `src/gateway/gateway-server.ts`
  - `src/gateway/channels/gateway-channel-runtime.ts`
  - `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts`
  - `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts`
  - `src/gateway/runtime/gateway-tool-provider-runtime.ts`
  - `src/gateway/runtime/gateway-runtime-rpc-surface.ts`
  - `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
  - `src/gateway/integration/gateway-daemon-attachment.ts`
  - `src/gateway/integration/scheduler-bridge.ts`
  - `src/gateway/config/config-watcher.ts`
  - the remaining gateway RPC registration modules used directly by `GatewayServer`
- focused import/usage scan for remaining inline `GatewayServer` responsibilities and extracted-helper usage
- `npx jest test/gateway/gateway-startup-runtime-ownership.test.ts test/gateway/gateway-rollout-runtime-ownership.test.ts test/gateway/gateway-scheduler-audit-runtime-ownership.test.ts test/gateway/gateway-tool-provider-runtime-ownership.test.ts test/gateway/gateway-runtime-rpc-surface-ownership.test.ts`

Results:

- the reviewed code supports `Path 1` closure: no materially justified final extraction remains
- the focused ownership characterization tests passed after updating one stale rollout test expectation to reflect the already-landed Session 93 control-plane extraction
- no production runtime code changed, so no additional build or runtime validation was required for this session's bounded closure review scope

## Result

`RF-061` is closed.

Resulting distinction:

- `GatewayServer` remains the steady-state runtime owner for WebSocket lifecycle, connection/auth/message routing, gateway-facing runtime APIs, gateway-local config-watch reaction, daemon/scheduler attachment APIs, and top-level status/lifecycle delegation.
- extracted helpers own the bounded internal graph/service-wiring families that previously blurred that ownership line:
  - channel runtime
  - rollout telemetry / rollback coordination
  - scheduler-event audit observation
  - tool/provider graph assembly
  - runtime/control-plane RPC wiring

No tiny explicit remainder is needed.
