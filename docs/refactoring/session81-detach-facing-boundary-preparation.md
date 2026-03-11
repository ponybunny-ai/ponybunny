# Session 81: Detach-Facing Boundary Preparation

## Reviewed Surfaces

This session reviewed only the daemon-attachment and detach-adjacent surfaces needed to choose one bounded consolidation cluster:

- `src/gateway/gateway-server.ts`
- `src/gateway/integration/gateway-daemon-attachment.ts`
- `src/gateway/integration/daemon-event-forwarding.ts`
- `src/gateway/integration/daemon-bridge.ts`
- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- targeted tests covering the gateway-owned attachment boundary and compatibility shell

The review stayed constrained to where attach/detach-facing lifecycle structure currently lives, where status/reporting reads come from, and which remaining surfaces are true lifecycle boundaries versus historical compatibility shells.

## Ownership Classification

| Surface | Classification | Decision |
|---|---|---|
| `src/gateway/integration/gateway-daemon-attachment.ts` | true gateway-owned attachment/lifecycle boundary | Keep as the live public boundary, but move daemon-binding lifecycle bookkeeping behind a dedicated helper so future detach work has a more explicit local home. |
| `src/gateway/integration/gateway-daemon-lifecycle.ts` | future detach implementation boundary candidate | Introduce as the gateway-owned holder of the current attached daemon reference plus derived lifecycle snapshot, without adding detach behavior. |
| `src/gateway/integration/daemon-event-forwarding.ts` | true gateway-owned forwarding/translation concern | Keep unchanged as the gateway-owned daemon-event to gateway-event-bus mapping layer. |
| `src/gateway/gateway-server.ts` | true gateway-owned composition/reporting consumer | Keep as the composition root and status consumer, not the owner of daemon-binding lifecycle state. |
| `src/gateway/rpc/handlers/system-handlers.ts` | true gateway-owned reporting concern | Keep unchanged as a consumer of the gateway status snapshot; do not move detach-facing structure here. |
| `src/autonomy/daemon-event-emitter.ts` | true daemon-owned runtime concern | Leave unchanged as the daemon/runtime callback registry and event-source contract. |
| `src/gateway/integration/daemon-bridge.ts` | compatibility shell / legacy public surface | Keep as a thin import-preserving wrapper over `GatewayDaemonAttachment`; do not let it regain lifecycle ownership. |
| `src/gateway/integration/index.ts` | attachment-adjacent public export surface | Keep unchanged; the live public line remains `GatewayDaemonAttachment`, not the new internal lifecycle helper. |
| `src/gateway/index.ts` | broader public gateway export surface with compatibility burden | Keep unchanged; preserve existing attachment exports and compatibility grouping. |
| current `daemonConnected` booleans and status reads | gateway-owned reporting concern derived from attachment state | Leave derived from attachment-owned snapshots; do not reintroduce server-owned daemon state. |

## Selected Cleanup Cluster

The highest-value consolidation cluster in this area was:

- extract daemon-binding lifecycle bookkeeping out of `GatewayDaemonAttachment` into a dedicated gateway-owned helper
- make that helper own the current attached daemon reference and derived attachment snapshot together
- keep `GatewayDaemonAttachment` as the live public attachment boundary that performs connect-time forwarding registration
- keep `GatewayServer`, status/reporting code, and `DaemonBridge` as callers over that boundary rather than owners of detach-facing structure

This was chosen first because Session 80 already made attachment status explicit, but the actual attach/detach-facing structure was still split awkwardly:

- `GatewayDaemonAttachment` exposed status, but stored lifecycle fields inline
- the currently attached daemon reference was not retained in one explicit lifecycle home
- `GatewayServer` and `DaemonBridge` still sat next to the seam where future detach cleanup will need to be localized

The missing structural piece was not detach behavior itself. It was the absence of a dedicated gateway-owned lifecycle module under the live attachment boundary.

## What Moved, What Was Re-Routed, What Was Narrowed

### New gateway-owned lifecycle helper

Added `src/gateway/integration/gateway-daemon-lifecycle.ts`.

It now owns:

- `GatewayDaemonAttachmentPhase`
- `GatewayDaemonAttachmentStatus`
- `GatewayDaemonLifecycleSnapshot`
- `GatewayDaemonLifecycle`

`GatewayDaemonLifecycle` keeps:

- the current attached daemon reference
- the derived attachment phase/connected snapshot
- the `connectedAt` timestamp

in one local gateway-owned module. This is the structural home intended for later detach-facing cleanup when unsubscribe/detach mechanics can be addressed safely.

### Attachment boundary reroute

`src/gateway/integration/gateway-daemon-attachment.ts` remains the intended live public boundary, but it no longer owns raw lifecycle fields directly.

It now:

- composes `GatewayDaemonLifecycle`
- checks duplicate attachment through `lifecycle.hasAttachedDaemon()`
- performs forwarding registration exactly as before
- marks the lifecycle helper attached after registration
- re-exports the status/phase types from the lifecycle helper

That narrows `GatewayDaemonAttachment` toward its actual role:

- gateway-owned attachment orchestration
- gateway-owned forwarding registration entry point
- public status surface over lifecycle-owned state

instead of also being the lowest-level lifecycle bookkeeping store.

### Compatibility shell

`src/gateway/integration/daemon-bridge.ts` was intentionally left thin.

It still:

- delegates `connect(...)`
- delegates `getStatus()`
- delegates `emit(...)`
- keeps `isConnected()` only as a compatibility helper over attachment-owned status

No daemon-binding lifecycle structure moved back into the compatibility shell.

## Compatibility Surfaces That Remain

- `src/gateway/integration/daemon-bridge.ts`
  - retained because historical imports may still reference `DaemonBridge`
  - remains compatibility-only and does not own attach/detach-facing state
- `src/gateway/integration/index.ts`
  - retained as the integration barrel for the live attachment boundary plus compatibility exports
- `src/gateway/index.ts`
  - retained as the broader public gateway barrel
- `GatewayDaemonAttachment.isConnected()`
  - retained as a boolean compatibility helper over lifecycle-owned state
- `system.status.gateway.daemonConnected`
  - retained because changing the public RPC response shape is outside this session

## What Was Intentionally Postponed

This session intentionally did not:

- add a `disconnectDaemon(...)` flow
- add unsubscribe hooks to the daemon event-source contract
- change detach or unsubscribe semantics
- change daemon startup behavior
- change scheduler behavior
- change replay behavior
- change daemon-event names or payload semantics
- move gateway status/reporting logic out of its current consumers
- reduce public barrels beyond what was necessary for this one lifecycle-bookkeeping consolidation

Deferred items in this transport-boundary block now are:

- decide whether a future session can add an explicit gateway-owned detach operation on top of the lifecycle helper without changing current semantics
- decide whether `IDaemonEventEmitter` should eventually grow unsubscribe/detach support, or whether detach will remain a gateway-side structural concept only
- further reduce `DaemonBridge` and related compatibility exports after downstream import safety is confirmed

## Future Detach-Facing Cleanup Enabled

This session did not change detach behavior, but it made future detach cleanup more local:

- the live public boundary remains `GatewayDaemonAttachment`
- lifecycle bookkeeping now has an explicit helper under that boundary
- the current attached daemon reference and attachment snapshot now live together in one gateway-owned place

That means a later detach-focused session can work inside the attachment/lifecycle pair instead of redistributing detach-facing structure across `GatewayServer`, `DaemonBridge`, and ad hoc status fields.

## Preserved Invariants

This session preserved:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` local-authoritative seam invariants
- `ConversationWorker` local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `LLMStreamEventSink` ownership direction
- extracted conversation bootstrap ownership
- scheduler composition ownership established during `RF-034`
- outer transport ownership lines
- durable ownership lines
- current scheduler behavior
- current daemon startup behavior
- current replay behavior
- current direct vs evented execution semantics
- current `runtimeEventBus` semantics and ownership
- current persistence semantics
- current daemon attach/connect behavior
- current daemon detach/unsubscribe behavior

## Validation Summary

Validated in this session:

- `npx jest test/gateway/integration/gateway-daemon-lifecycle.test.ts test/gateway/integration/gateway-daemon-attachment.test.ts test/gateway/integration/daemon-bridge.test.ts test/gateway/rpc/system-handlers.test.ts`
- `npm run build`
- focused import/usage scan confirming:
  - `GatewayServer` still composes `GatewayDaemonAttachment` directly
  - `GatewayDaemonAttachment` is still the live public boundary
  - `DaemonBridge` remains a compatibility shell
  - lifecycle bookkeeping is now local to the attachment layer rather than split inline in the attachment class

Validation notes:

- targeted Jest coverage and TypeScript build passed on the touched paths
- the pre-existing Node warning about `--localstorage-file` without a valid path still appeared under Jest; this session did not change that environment behavior

## Recommended Next Session

The next session in this transport-boundary block should stay on the same seam and choose one of:

- add a more explicit gateway-owned detach operation or detach-preparation API on top of `GatewayDaemonLifecycle` only if it can preserve current detach semantics
- narrow `DaemonBridge` or other compatibility exports further after confirming downstream callers no longer need them

The key constraint remains unchanged: keep the work inside daemon-attachment detach-facing structure, not broader gateway redesign.
