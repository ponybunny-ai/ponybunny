# Session 79: GatewayServer Daemon Attachment Consolidation

## Reviewed Surfaces

This session reviewed only the `GatewayServer.connectDaemon(...)` attachment path and immediately adjacent bridge/barrel surfaces:

- `src/gateway/gateway-server.ts`
- `src/gateway/integration/daemon-bridge.ts`
- `src/autonomy/daemon-event-emitter.ts`
- `src/gateway/integration/gateway-daemon-attachment.ts` (new)
- `src/gateway/integration/daemon-event-forwarding.ts` (new)
- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`
- targeted tests/import usage for:
  - `GatewayServer.connectDaemon(...)`
  - `DaemonBridge`
  - `GatewayDaemonAttachment`
  - `IDaemonEventEmitter`
  - `DaemonEventEmitterMixin`

The review stayed scoped to whether gateway-owned daemon attachment and outward event forwarding were still mixed with daemon-owned runtime event-source concerns.

## Ownership Classification

| Surface | Classification | Decision |
|---|---|---|
| `src/gateway/gateway-server.ts` | true gateway-owned transport attachment point | Keep in gateway, but stop routing attachment through a mixed historical shell. |
| `src/gateway/integration/daemon-bridge.ts` | mixed historical bridge/facade plus compatibility shell | Reduce it to a thin compatibility wrapper around the explicit gateway-owned attachment boundary. |
| `src/gateway/integration/gateway-daemon-attachment.ts` | true gateway-owned attachment/composition concern | Introduce as the direct owner of daemon attachment state and connect-time registration. |
| `src/gateway/integration/daemon-event-forwarding.ts` | true gateway-owned event forwarding / translation concern | Introduce as the explicit registration point for daemon-event to gateway-event-bus forwarding. |
| `src/autonomy/daemon-event-emitter.ts` | true daemon-owned runtime event-source contract | Keep unchanged as the daemon-owned callback registry and event-emission contract. |
| `src/gateway/integration/index.ts` | compatibility/public-surface concern | Keep as a barrel, but point it at the ownership-correct gateway attachment module and the thin bridge wrapper. |
| `src/gateway/index.ts` | public gateway boundary with compatibility concerns | Keep, preserving historical gateway exports while exposing the explicit gateway-owned attachment boundary. |

## Selected Cleanup Cluster

The highest-value first cleanup cluster around `GatewayServer.connectDaemon(...)` was:

- introduce an explicit gateway-owned daemon attachment boundary
- move the event-forwarding registration block out of `DaemonBridge.connect(...)`
- retarget `GatewayServer` to the explicit gateway attachment boundary
- keep `DaemonBridge` only as a compatibility shell for historical gateway imports

This was chosen first because the real ambiguity was not daemon-owned runtime emission anymore; Session 78 already corrected that. The remaining ambiguity was that `GatewayServer` still attached through a legacy bridge class whose `connect(...)` method also contained the entire forwarding-registration block inline. That obscured the actual ownership line between:

- gateway-owned attachment/composition state
- gateway-owned outward event forwarding/translation
- daemon-owned runtime event-source contract

## What Moved, What Was Re-Routed, And What Remained

### Added

New gateway-owned boundary modules:

- `src/gateway/integration/gateway-daemon-attachment.ts`
  - owns daemon attachment state (`connected`)
  - owns `connect(...)`, `isConnected()`, and gateway-side direct emission
- `src/gateway/integration/daemon-event-forwarding.ts`
  - owns registration of daemon event callbacks to gateway event-bus emissions
  - keeps the transport/event translation mapping explicit and local to gateway

### Re-routed

- `src/gateway/gateway-server.ts`
  - now composes `GatewayDaemonAttachment` directly
  - `connectDaemon(...)` now delegates to the explicit gateway attachment boundary
  - gateway stats/health paths now read daemon connection state from the attachment boundary rather than the historical bridge shell

### Remained

- `src/autonomy/daemon-event-emitter.ts`
  - unchanged
  - remains the daemon-owned runtime event-source contract and callback registry
- `src/gateway/integration/daemon-bridge.ts`
  - remains only as a compatibility/public-surface shell
  - delegates to `GatewayDaemonAttachment`
- `src/gateway/integration/index.ts`
  - remains a barrel
- `src/gateway/index.ts`
  - remains a public gateway barrel

## Compatibility Surfaces That Remain And Why

- `src/gateway/integration/daemon-bridge.ts`
  - retained because historical callers may still import `DaemonBridge`, `DaemonEventEmitterMixin`, or `IDaemonEventEmitter` from the gateway integration path
  - now thin enough that it no longer owns the real attachment/forwarding implementation
- `src/gateway/integration/index.ts`
  - retained to preserve the integration barrel contract
- `src/gateway/index.ts`
  - retained to preserve the public gateway barrel contract

These shells remain acceptable because daemon-owned runtime emission stays in `src/autonomy/daemon-event-emitter.ts`, while gateway-owned attachment and forwarding now live behind gateway-owned module names.

## What Was Intentionally Postponed

This session intentionally did not:

- change daemon startup behavior
- change scheduler behavior
- redesign detach or unsubscribe semantics
- redesign IPC or message semantics
- change replay behavior
- redesign `ToolWorker`, `ConversationWorker`, or execution/recovery ownership
- perform broader gateway cleanup outside the daemon-attachment seam

Deferred items in this transport-boundary block:

- decide whether the historical `DaemonBridge` shell can eventually be reduced further after callers move to `GatewayDaemonAttachment` or autonomy-owned event-source imports
- review whether connection-state reporting and any future detach semantics should live on a narrower gateway-owned daemon-attachment interface without changing runtime behavior
- assess whether the forwarding map in `daemon-event-forwarding.ts` should later be normalized further without altering event names or payload semantics

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
- current unsubscribe/detach behavior

## Validation Summary

Validated in this session:

- `npx jest test/gateway/integration/gateway-daemon-attachment.test.ts test/gateway/integration/daemon-bridge.test.ts test/autonomy/daemon-event-emitter.test.ts`
- `npm run build`

Validation observations:

- all targeted tests passed
- the TypeScript build passed
- focused import/usage scan confirmed `GatewayServer` now uses `GatewayDaemonAttachment` directly and `DaemonBridge` is no longer the live attachment owner on the touched path
- Jest emitted the pre-existing Node warning about `--localstorage-file` without a valid path; this session did not touch that environment setup

## Recommended Next Session

The next session in this transport-boundary block should stay adjacent to this seam and choose one of:

- reduce the remaining public-shell weight of `DaemonBridge` if that can be done without breaking compatibility
- review whether a narrower gateway-owned daemon-attachment interface can contain connection-state and future detach concerns more explicitly without changing attach/detach behavior

The key constraint is to remain inside gateway/daemon attachment and forwarding ownership, not broaden into scheduler composition or broader gateway redesign.
