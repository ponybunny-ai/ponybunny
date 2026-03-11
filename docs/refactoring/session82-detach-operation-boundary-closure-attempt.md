# Session 82: Detach Operation Boundary Closure Attempt

## Reviewed Surfaces

This session reviewed only the daemon-attachment detach-facing area needed to choose one closure-oriented consolidation cluster:

- `src/gateway/gateway-server.ts`
- `src/gateway/integration/gateway-daemon-attachment.ts`
- `src/gateway/integration/gateway-daemon-lifecycle.ts`
- `src/gateway/integration/daemon-event-forwarding.ts`
- `src/gateway/integration/daemon-bridge.ts`
- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`
- targeted detach-adjacent tests under `test/gateway/integration/`

The review stayed constrained to attachment composition, lifecycle bookkeeping, detach-facing operational shape, forwarding/reporting, and the minimum compatibility/public-surface layer touching that seam.

## Ownership Classification

| Surface | Classification | Decision |
|---|---|---|
| `src/gateway/integration/gateway-daemon-attachment.ts` | true gateway-owned attachment/lifecycle boundary | Keep as the live boundary and make it the explicit owner of both attachment status and detach-facing operational state. |
| `src/gateway/integration/gateway-daemon-lifecycle.ts` | true gateway-owned lifecycle bookkeeping | Keep as the holder of the attached daemon reference plus derived attachment snapshot. |
| `src/gateway/integration/gateway-daemon-detach-operations.ts` | true gateway-owned detach-facing operational boundary | Introduce as the explicit home for current detach-facing state, derived from gateway lifecycle state without changing detach behavior. |
| `src/gateway/integration/daemon-event-forwarding.ts` | true gateway-owned forwarding / translation concern | Keep unchanged as the daemon-runtime-event to gateway-event-bus mapping layer. |
| `src/gateway/gateway-server.ts` | true gateway-owned composition/reporting consumer | Keep as a consumer of attachment-owned operation state, not the owner of detach-facing mechanics. |
| `src/autonomy/daemon-event-emitter.ts` | true daemon-owned runtime concern | Leave unchanged; callback ownership and runtime event emission remain daemon-owned. |
| `src/gateway/integration/daemon-bridge.ts` | compatibility shell / legacy public surface | Keep as a thin import-preserving shell over attach/status/emit only; do not give it the new detach-facing surface. |
| `src/gateway/integration/index.ts` | compatibility/public export surface adjacent to the live boundary | Keep, but export the live detach-facing types from the attachment boundary rather than from the compatibility shell. |
| `src/gateway/index.ts` | broader public gateway export surface with compatibility burden | Keep, but expose the new live detach-facing types alongside the intended attachment surface. |
| implicit detach-facing reads from raw status booleans | mixed / ambiguous detach-facing operational helper | Replace with attachment-owned operation-state reads where the gateway composes daemon status internally. |

## Selected Cleanup Cluster

The highest-value closure-oriented cluster was:

- introduce one gateway-owned detach-facing operation-state module adjacent to `GatewayDaemonAttachment`
- make `GatewayDaemonAttachment` expose that detach-facing state as part of the live attachment boundary
- route `GatewayServer` internal daemon status reads through attachment-owned operation state rather than raw status alone
- keep `DaemonBridge` intentionally narrower so the detach-facing surface is clearly live-boundary-only instead of compatibility-owned

This was chosen because the remaining ambiguity was no longer who owns attachment lifecycle bookkeeping. Session 81 already localized that in `GatewayDaemonLifecycle`. The remaining ambiguity was that detach-facing structure still had no explicit operational home, so the code still implied that future detach work would be discovered from attachment status and compatibility surfaces rather than from a deliberate gateway-owned operation boundary.

## What Moved, What Was Re-Routed, What Was Made Explicit

### New detach-facing operation boundary

Added `src/gateway/integration/gateway-daemon-detach-operations.ts`.

It now owns:

- `GatewayDaemonDetachPhase`
- `GatewayDaemonDetachStatus`
- `GatewayDaemonOperationState`
- `GatewayDaemonDetachSurface`
- the pure derivation from gateway lifecycle state to current detach-facing operational state

Current semantics are represented explicitly as descriptive state:

- detached attachment -> `phase: 'idle'`
- attached attachment -> `phase: 'attached-awaiting-daemon-unsubscribe'`
- `detachSupported: false`
- `unsubscribeSupported: false`

That is intentionally structural only. It does not add detach behavior or lifecycle reset behavior.

### Live attachment boundary reroute

`src/gateway/integration/gateway-daemon-attachment.ts` remains the live gateway-owned attachment boundary, but it now exposes:

- `getDetachStatus()`
- `getOperationState()`

and implements the new `GatewayDaemonDetachSurface`.

This makes the live boundary own:

- connect-time forwarding registration
- attachment lifecycle/status reads
- explicit detach-facing operational shape
- direct gateway event-bus emission

in one gateway-owned place.

### Gateway composition reroute

`src/gateway/gateway-server.ts` now derives its internal daemon attachment snapshot from:

- `this.daemonAttachment.getOperationState()`

instead of reading only the attachment status directly.

The public behavior remains unchanged:

- gateway stats still expose the same `daemonConnected` boolean
- system status still consumes the same daemon-attachment status shape
- no public RPC response shape changed

### Public export split

`src/gateway/integration/index.ts` and `src/gateway/index.ts` now export the new live detach-facing types from `GatewayDaemonAttachment`.

That makes the intended live surface explicit without expanding `DaemonBridge`.

## Compatibility Surfaces That Remain And Why

- `src/gateway/integration/daemon-bridge.ts`
  - retained because historical imports may still target `DaemonBridge`
  - remains attach/status/emit compatibility only
  - intentionally does not expose the new detach-facing surface, so it no longer looks like a candidate owner of future detach work
- `src/gateway/integration/index.ts`
  - retained as the integration/public barrel
- `src/gateway/index.ts`
  - retained as the broader public gateway barrel
- `GatewayDaemonAttachment.isConnected()`
  - retained as a boolean compatibility helper over attachment-owned state
- public `system.status.gateway.daemonConnected`
  - retained because changing public RPC shape is outside this session

## What Was Intentionally Postponed

This session intentionally did not:

- add daemon unsubscribe hooks
- add a gateway-side `disconnectDaemon(...)`
- change lifecycle reset behavior
- change daemon startup or attach/connect behavior
- change daemon detach/unsubscribe behavior
- change scheduler behavior
- change replay behavior
- change gateway event payloads or IPC semantics
- broaden into unrelated gateway cleanup

## Block-Completion Judgment

The current daemon-attachment transport-boundary refactor block is structurally complete.

Reason:

- the live gateway-owned attachment boundary is explicit
- lifecycle bookkeeping has an explicit local home
- detach-facing operational shape now has an explicit local home
- forwarding/translation remains clearly separated
- daemon-owned runtime callback ownership remains outside gateway
- `DaemonBridge` is now only a compatibility shell and no longer a plausible owner of detach-facing work

The remaining gap is semantic unsubscribe/detach capability in the daemon event-source contract. That is not a structural ownership ambiguity inside the current transport-boundary refactor block, so it should not keep this block open.

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

- `npx jest test/gateway/integration/gateway-daemon-detach-operations.test.ts test/gateway/integration/gateway-daemon-lifecycle.test.ts test/gateway/integration/gateway-daemon-attachment.test.ts test/gateway/integration/daemon-bridge.test.ts test/gateway/rpc/system-handlers.test.ts`
- `npm run build`

Validation observations:

- all targeted Jest suites passed
- TypeScript build passed
- Jest still emitted the pre-existing Node warning about `--localstorage-file` without a valid path; this session did not change that environment behavior
