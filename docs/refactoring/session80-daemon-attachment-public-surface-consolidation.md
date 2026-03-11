# Session 80: Daemon Attachment Public-Surface Consolidation

## Reviewed Surfaces

This session reviewed only the gateway-owned daemon-attachment public surface and the adjacent reporting/export layers needed to choose one bounded cleanup cluster:

- `src/gateway/gateway-server.ts`
- `src/gateway/integration/gateway-daemon-attachment.ts`
- `src/gateway/integration/daemon-event-forwarding.ts`
- `src/gateway/integration/daemon-bridge.ts`
- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- targeted tests covering the attachment boundary, compatibility shell, and system-status reporting

The review stayed constrained to attachment-facing exports, attachment/connection-state reporting, and the minimum detach-facing structural preparation that could be done without changing detach semantics.

## Ownership Classification

| Surface | Classification | Decision |
|---|---|---|
| `src/gateway/integration/gateway-daemon-attachment.ts` | true gateway-owned attachment boundary | Keep as the intended live surface and make attachment status first-class here instead of reporting it through scattered booleans. |
| `src/gateway/integration/daemon-event-forwarding.ts` | true gateway-owned forwarding/translation concern | Keep unchanged as the gateway-owned daemon-event to gateway-event-bus mapping layer. |
| `src/gateway/gateway-server.ts` | true gateway-owned composition/reporting consumer | Keep as composition root, but route gateway status reporting through attachment-owned status snapshots rather than direct boolean reads. |
| `src/gateway/rpc/handlers/system-handlers.ts` | gateway-owned reporting concern with mixed legacy input shape | Keep the external response unchanged, but allow the internal gateway-status provider to consume the attachment-owned status object when available. |
| `src/autonomy/daemon-event-emitter.ts` | true daemon-owned runtime concern | Leave unchanged as the daemon/runtime callback registry and event-source contract. |
| `src/gateway/integration/daemon-bridge.ts` | compatibility shell / legacy public surface | Keep only as a thin import-preserving wrapper over the live gateway-owned attachment surface. |
| `src/gateway/integration/index.ts` | attachment-adjacent public export surface | Keep, but separate intended live attachment exports from compatibility exports more explicitly. |
| `src/gateway/index.ts` | broader public gateway export surface with compatibility burden | Keep, but distinguish the intended live attachment surface from historical compatibility exports. |
| current boolean-only daemon connection checks | mixed / ambiguous attachment-facing API | Reduce their ownership weight by deriving them from `GatewayDaemonAttachmentStatus` instead of treating them as the primary source of truth. |
| future detach-facing shape | future detach-facing boundary candidate | Use the new attachment status phase/snapshot as the structural starting point for a later detach-focused cleanup, without adding detach behavior now. |

## Selected Cleanup Cluster

The highest-value first implementation cluster after Session 79 was:

- make the gateway-owned daemon attachment boundary expose an explicit status surface
- route gateway and RPC daemon-connection reporting through that attachment-owned status snapshot
- keep legacy boolean/public responses intact for compatibility
- make the live-vs-compatibility export split clearer in the gateway barrels

This was chosen first because the largest remaining ambiguity was no longer who performs attachment; Session 79 already clarified that. The ambiguity was that attachment state still escaped mainly as ad hoc booleans (`isConnected()` reads in `GatewayServer` and pass-through reporting in `system.status`), while the same public surface still mixed the intended live attachment boundary with the historical `DaemonBridge` shell.

That made the real ownership line harder to read:

- the live gateway-owned attachment boundary existed
- the public export surface still treated the compatibility shell almost equivalently
- reporting still depended on boolean pass-throughs rather than an attachment-owned snapshot

## What Moved, Re-Routed, Or Narrowed

### Attachment boundary

`src/gateway/integration/gateway-daemon-attachment.ts` now owns:

- `GatewayDaemonAttachmentStatus`
- `GatewayDaemonAttachmentPhase`
- `GatewayDaemonAttachmentSurface`
- `GatewayDaemonAttachment.getStatus()`

The attachment now records gateway-owned attachment state as:

- `phase: 'detached' | 'attached'`
- `connected: boolean`
- `connectedAt: number | null`

`isConnected()` remains, but only as a thin compatibility helper over the attachment-owned state.

### Reporting path

`src/gateway/gateway-server.ts` now builds one internal gateway status snapshot that includes:

- `daemonAttachment: GatewayDaemonAttachmentStatus`
- compatibility booleans derived from that snapshot

Both:

- `GatewayServer.getStats()`
- the `registerSystemHandlers(...)` gateway-status provider

now read daemon-attachment state through the same attachment-owned snapshot line.

`src/gateway/rpc/handlers/system-handlers.ts` still returns the existing public `daemonConnected` boolean, but it now prefers `daemonAttachment.connected` when the richer snapshot is provided. This keeps runtime behavior and RPC shape unchanged while aligning the internal reporting source of truth with attachment ownership.

### Compatibility/public exports

`src/gateway/integration/index.ts` and `src/gateway/index.ts` now expose the intended live attachment surface explicitly:

- `GatewayDaemonAttachment`
- `GatewayDaemonAttachmentPhase`
- `GatewayDaemonAttachmentStatus`
- `GatewayDaemonAttachmentSurface`

while the historical `DaemonBridge` export remains clearly grouped as a compatibility surface.

`src/gateway/integration/daemon-bridge.ts` remains a thin wrapper and now delegates `getStatus()` as well.

## Compatibility Surfaces That Remain

- `src/gateway/integration/daemon-bridge.ts`
  - retained because historical imports may still reference `DaemonBridge`
  - remains intentionally thin and no longer owns distinct attachment/reporting logic
- `src/gateway/integration/index.ts`
  - retained as a compatibility/public barrel
- `src/gateway/index.ts`
  - retained as the broader public gateway barrel
- `GatewayDaemonAttachment.isConnected()`
  - retained as a compatibility helper for boolean callers while the intended attachment-facing surface moves toward `getStatus()`
- `system.status.gateway.daemonConnected`
  - retained because changing the public RPC response shape is outside this session

## What Was Intentionally Postponed

This session intentionally did not:

- change attach semantics
- change detach or unsubscribe semantics
- add a gateway-side `disconnectDaemon(...)`
- redesign daemon startup or lifecycle ownership
- change scheduler behavior
- change replay behavior
- change daemon-event payload names or payload semantics
- move daemon-owned runtime logic back under gateway naming
- broaden into unrelated gateway cleanup

Deferred items in this transport-boundary block now are:

- introduce a detach-facing gateway boundary method or companion boundary when it can be done without semantic change
- decide whether `DaemonBridge` can be reduced further or removed from more public barrels after downstream callers migrate
- decide whether attachment reporting should eventually expose a richer public RPC shape, rather than only compatibility booleans

## Future Detach-Facing Cleanup Enabled

This session did not implement detach behavior, but it prepared the structure for it by making attachment state explicit and gateway-owned.

The most likely next safe detach-facing move is to keep future detach preparation on the same boundary line:

- `GatewayDaemonAttachment` as the live owner of attachment lifecycle state
- `DaemonBridge` as compatibility only
- reporting derived from attachment status snapshots instead of one-off booleans

That makes a later detach-focused session able to add a detach-facing structural boundary without first rediscovering where attachment state actually lives.

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

- `npx jest test/gateway/integration/gateway-daemon-attachment.test.ts test/gateway/integration/daemon-bridge.test.ts test/gateway/rpc/system-handlers.test.ts`
- `npm run build`
- focused import/export scan:
  - `GatewayServer` still composes `GatewayDaemonAttachment` directly
  - `system-handlers` now accepts attachment snapshots without changing the public status response shape
  - `DaemonBridge` remains only as a compatibility shell over the live gateway-owned attachment surface

Validation observations:

- targeted tests passed
- TypeScript build passed
- Jest still emitted the pre-existing Node warning about `--localstorage-file` without a valid path; this session did not change that environment behavior

## Recommended Next Session

The next session in this transport-boundary block should stay on the daemon-attachment public surface and choose one of:

- add a detach-facing gateway-owned structural boundary on top of `GatewayDaemonAttachment` without changing current detach semantics
- further reduce the remaining public-shell weight of `DaemonBridge` and any compatibility-only exports after confirming downstream import safety

The key constraint remains the same as this session: stay inside daemon-attachment surface ownership and reporting, not broader gateway redesign.
