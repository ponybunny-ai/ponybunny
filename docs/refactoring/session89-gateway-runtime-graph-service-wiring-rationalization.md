# Session 89: Gateway Runtime Graph / Service-Wiring Rationalization

## Summary

This session started the next post-`RF-060` refactor block by reviewing the remaining internal runtime graph assembly inside and immediately adjacent to `GatewayServer`, then implementing one substantial first consolidation cluster without changing gateway runtime semantics.

The selected cluster was the gateway channel runtime family:

- channel session override persistence
- channel event archival/enrichment
- channel adapter config state
- channel adapter fanout and status/event emission

Those concerns were still gateway-owned, but they were primarily internal graph assembly and service wiring rather than `GatewayServer` steady-state API ownership. Session 89 extracted that family behind an explicit gateway-owned `GatewayChannelRuntime` helper while keeping `GatewayServer` as the live runtime owner and preserving the existing startup lifecycle boundary, transport boundary, RPC surface, and runtime behavior.

## Reviewed Surfaces

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/gateway-server.ts` | mixed runtime owner + internal graph assembly | Still the live gateway runtime owner, but constructor wiring and event-hook setup mixed true runtime APIs with internal channel/runtime service assembly. |
| `src/gateway/bootstrap/default-gateway-runtime.ts` | startup/bootstrap helper already closed by `RF-060` | Default persistence and live gateway construction remain explicit startup composition; not reopened. |
| `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` | startup/shutdown sequencing helper already closed by `RF-060` | Runtime activation/deactivation sequencing remains intentionally separate from constructor-time graph assembly. |
| `src/gateway/events/broadcast-manager.ts` | true steady-state runtime-owned behavior | Live client broadcast behavior still belongs to the runtime owner; not extracted for symmetry. |
| `src/gateway/integration/gateway-daemon-attachment.ts` and adjacent transport helpers | transport-boundary concern already closed in Sessions 78-82 | Attachment/detach and daemon-facing operation state remain stable and intentionally untouched. |
| `src/gateway/integration/*compatibility*`, `src/gateway/integration/index.ts`, root export surfaces | compatibility/public-surface concern already closed in Sessions 83-85 | No public-surface or compatibility rerouting was needed for this session. |
| `src/gateway/channels/channel-router.ts` | true runtime behavior primitive | Routing policy and enabled-channel state remain live runtime behavior used by broadcast and RPC surfaces. |
| `src/gateway/channels/channel-adapter-manager.ts` | internal service family primitive | Adapter lifecycle/retry/publication logic is runtime-owned, but composition and higher-level orchestration were previously too entangled with `GatewayServer`. |
| `src/gateway/channels/channel-session-store.ts`, `channel-event-store.ts`, `channel-event-enricher.ts`, `channel-adapter-config-store.ts` | internal graph/service-wiring concerns | Persistence/enrichment helpers were being constructed and driven inline from `GatewayServer`. |
| channel-related `system.channels.*` registration in `src/gateway/rpc/handlers/system-handlers.ts` | mixed/ambiguous runtime graph concern | Public RPC surface is correct, but the mutation path previously assumed direct `GatewayServer` ownership of router/config plumbing. |
| gateway tool registry / global tool provider wiring | mixed runtime-core singleton/tooling concern, intentionally postponed | Session 88 already noted this as a different concern from startup/bootstrap; still deferred. |
| rollout telemetry and scheduler-audit event hooks in `GatewayServer` | mixed runtime-owned observation concern, intentionally postponed | Still inside `GatewayServer`; not part of the selected channel-runtime cluster. |

## Selected Consolidation Cluster

The highest-value first cluster was the channel runtime wiring family because it had the clearest mismatch between real ownership and current placement:

- `GatewayServer` should still own live runtime behavior, status reporting, and RPC exposure.
- The inline construction and orchestration of channel stores, enrichment, adapter config persistence, adapter fanout, and connection-driven session override persistence were internal graph assembly details.
- The same family crossed constructor assembly, event subscriptions, channel config mutation callbacks, and stored-event access, which made the constructor look more like an open-ended composition root than a runtime owner.

This was a better first target than rollout, tooling, or audit cleanup because:

- it was fully adjacent to `GatewayServer`
- it avoided reopening startup/bootstrap, transport, or compatibility boundaries
- it delivered one cohesive multi-file extraction instead of several disconnected helper moves

## What Changed

### New internal runtime helper

Added `src/gateway/channels/gateway-channel-runtime.ts` as an explicit gateway-owned internal runtime helper.

It now owns:

- default channel-family assembly (`ChannelRouter`, `ChannelAdapterManager`, stores, enricher)
- loading adapter config and stored channel-event state
- session-channel persistence on connection auth/disconnect events
- channel event capture/enrichment/persistence
- adapter delivery fanout selection
- adapter config updates and related status/config event emission
- enabled-channel adapter activation for channel-toggle flows

### `GatewayServer` after the extraction

`GatewayServer` now:

- composes one `GatewayChannelRuntime`
- keeps `ChannelRouter` as a live runtime dependency for `BroadcastManager` and RPC/status surfaces
- delegates channel auth/disconnect handling to the helper
- delegates channel event archival/fanout to the helper
- delegates channel update application from `system.channels.update` to the helper
- keeps startup/shutdown lifecycle delegation in `gateway-server-runtime-lifecycle.ts`

This makes the distinction clearer:

- `GatewayServer`: live runtime owner and public runtime API surface
- `GatewayChannelRuntime`: gateway-internal channel graph assembly and service wiring

### `system.channels.update` clarification

`registerSystemHandlers(...)` gained an optional `applyChannelUpdate(...)` hook so the live runtime owner can route the full channel update through its internal helper instead of having the handler assume direct knowledge of `GatewayServer`’s internal channel state ownership.

The public RPC method names, payload shapes, validation, and returned status shape remain unchanged.

## Adjacent Surfaces Intentionally Left Untouched

The following were reviewed and intentionally not reopened:

- `src/gateway/bootstrap/default-gateway-runtime.ts`
  - true startup/bootstrap assembly already closed in `RF-060`
- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
  - startup/shutdown sequencing boundary already extracted and still correct
- gateway/daemon attachment, detach, and transport helpers
  - transport-boundary work already closed in Sessions 78-82
- compatibility/public export surfaces
  - already closed in Sessions 83-85
- scheduler behavior, replay flow, execution/recovery, ToolWorker, ConversationWorker
  - out of scope for this block
- gateway tooling/global singleton cleanup
  - still a separate runtime-core concern, not this channel-runtime cluster

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
- current runtime event bus semantics and ownership
- current persistence semantics
- current public runtime behavior
- current attach/connect and detach/unsubscribe semantics
- current direct vs evented execution semantics
- current gateway, daemon, scheduler, and replay behavior

## Validation Summary

Validated with:

- `npx jest test/gateway/channels/gateway-channel-runtime.test.ts test/gateway/rpc/system-handlers.test.ts test/gateway/integration/london-cross-channel-fanout.test.ts test/gateway/bootstrap/gateway-server-runtime-lifecycle.test.ts`
- `npx tsc --noEmit`

Results:

- all four focused Jest suites passed
- full TypeScript check passed
- no runtime-semantics regressions were found in the touched channel/lifecycle/RPC paths

## Postponed Items

Intentionally postponed for later sessions in this new block:

- rollout telemetry and rollback helper pressure still inside `GatewayServer`
- scheduler-event audit hook ownership still inside `GatewayServer`
- gateway tool-registry / global-tool-provider wiring and adjacent singleton cleanup
- any broader runtime-core cleanup outside GatewayServer-adjacent ownership clarification

## Block Outlook

This now looks like a multi-session block, not a one-session closure.

Session 89 removed one meaningful constructor/event-wiring cluster, but `GatewayServer` still contains other mixed runtime-observation/service-wiring areas that should be reviewed separately instead of folded into this session.

## Recommended Next Session

Stay in the same block and review the next highest-value mixed `GatewayServer` runtime graph concern after the channel extraction, most likely one of:

- rollout telemetry / rollback ownership
- scheduler-event audit wiring ownership
- gateway-adjacent tooling/runtime singleton wiring if it can be isolated without reopening broader runtime-core cleanup

The next session should again choose one cohesive cluster only.
