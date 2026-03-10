# Session 78: Gateway/Daemon Transport Boundary Cleanup

## Reviewed Surfaces

This session reviewed only the gateway/daemon transport-boundary area adjacent to real event forwarding and daemon attachment:

- `src/gateway/integration/scheduler-bridge.ts`
- `src/gateway/integration/daemon-bridge.ts`
- `src/gateway/gateway-server.ts`
- `src/gateway/integration/index.ts`
- `src/gateway/index.ts`
- `src/autonomy/daemon.ts`
- `src/index.ts`
- targeted import/usage scans for:
  - `DaemonBridge`
  - `IDaemonEventEmitter`
  - `DaemonEventEmitterMixin`
  - `connectDaemon(...)`

The review question was which surfaces are true gateway-owned outer transport/event-forwarding boundaries, which are daemon-owned runtime/lifecycle boundaries, and which still blur those ownership lines.

## Ownership Classification

| Surface | Classification | Decision |
|---|---|---|
| `src/gateway/integration/scheduler-bridge.ts` | true gateway-owned outer transport boundary | Keep unchanged. It only translates scheduler events into gateway event-bus broadcasts. |
| `src/gateway/integration/daemon-bridge.ts` | mixed surface: true gateway bridge plus daemon-owned callback contract/mixin | Split ownership. Keep `DaemonBridge` in place, move the event-source contract and callback registry out of the gateway-owned file. |
| `src/gateway/gateway-server.ts` | true gateway-owned transport attachment point | Keep in gateway. Retarget it to consume the daemon-owned event-source type directly. |
| `src/gateway/integration/index.ts` | compatibility/public-surface barrel | Keep as a compatibility shell. It can continue re-exporting the historical daemon surface without owning the implementation. |
| `src/gateway/index.ts` | true public gateway boundary with compatibility concerns | Keep. It remains a public gateway barrel, but historical daemon event-source exports should resolve to daemon-owned code through thin compatibility re-exports. |
| `src/autonomy/daemon.ts` | true daemon-owned runtime/lifecycle surface | Keep unchanged. It remains runtime-owned and was reviewed only to confirm the event-source contract belongs on the daemon side rather than inside gateway transport code. |
| `src/index.ts` | public root compatibility/public-surface concern | Expose the daemon-owned event-source module from the root package so the ownership-correct import path exists without relying on gateway naming. |

## Selected Cleanup Cluster

The first highest-value cleanup cluster was:

- extract the daemon event-source contract and callback-registry mixin from `src/gateway/integration/daemon-bridge.ts`
- re-home them under a daemon-owned module
- keep `DaemonBridge` as the gateway-owned event-forwarding bridge
- preserve historical gateway exports as thin compatibility re-exports
- retarget gateway internals to the daemon-owned type so the live dependency direction is clearer

This was chosen first because it removes a real mixed-ownership signal, not just a naming issue:

- the callback registration surface is about daemon/runtime lifecycle emission, not gateway transport
- keeping that logic in a gateway-named bridge made it look like gateway owned the daemon event source itself
- the bridge still legitimately belongs in gateway because event translation and outer event-bus forwarding are transport concerns

This cluster is larger than a cosmetic single-file edit, but still bounded to one architectural objective.

## What Moved, What Was Re-Routed, And What Remained

### Moved

The daemon-owned event-source surface now lives at:

- `src/autonomy/daemon-event-emitter.ts`

That file now owns:

- `IDaemonEventEmitter`
- `DaemonEventEmitterMixin`

### Re-routed

Gateway-owned code now depends on the daemon-owned event-source contract instead of defining it:

- `src/gateway/gateway-server.ts` now imports `IDaemonEventEmitter` from `src/autonomy/daemon-event-emitter.ts`

The root package also exposes the ownership-correct surface:

- `src/index.ts` now re-exports `DaemonEventEmitterMixin` and `IDaemonEventEmitter` from `src/autonomy/daemon-event-emitter.ts`

### Remained

The following remained in place intentionally:

- `src/gateway/integration/daemon-bridge.ts`
  - still owns only the gateway-facing event forwarding logic in `DaemonBridge`
  - still re-exports the moved daemon types as a compatibility shell for historical imports
- `src/gateway/integration/index.ts`
  - still re-exports the daemon bridge compatibility surface
- `src/gateway/index.ts`
  - still re-exports the daemon bridge compatibility surface as part of the public gateway barrel
- `src/gateway/integration/scheduler-bridge.ts`
  - unchanged because it is already a true gateway transport boundary

## Compatibility Surfaces That Remain

The intentional compatibility surfaces after this session are:

- `src/gateway/integration/daemon-bridge.ts`
  - needed because callers may still import `DaemonEventEmitterMixin` or `IDaemonEventEmitter` from the historical gateway path
  - now acts as a thin compatibility shell for those daemon-owned exports
- `src/gateway/integration/index.ts`
  - needed to preserve the integration barrel contract
- `src/gateway/index.ts`
  - needed to preserve the public gateway barrel contract

These remain acceptable because they no longer imply that gateway owns the daemon-side callback registry implementation.

## What Was Intentionally Postponed

This session intentionally did not:

- redesign `DaemonBridge` registration or add unsubscribe semantics
- change daemon startup or scheduler startup behavior
- move or redesign `scheduler-bridge.ts`
- collapse gateway barrels further
- touch IPC protocol, replay workflow, execution/recovery behavior, worker internals, or persistence semantics
- revisit scheduler composition cleanup from `RF-034`

The remaining deferred items in this new block are:

- decide whether `DaemonBridge` should later gain a narrower daemon event-source interface with explicit detach/unsubscribe behavior, if that can be done without changing runtime semantics
- review whether any remaining daemon lifecycle attachment or runtime-event forwarding helpers near `GatewayServer.connectDaemon(...)` still blur gateway transport ownership versus daemon runtime ownership
- assess whether the historical gateway compatibility exports for daemon event-source types can eventually be reduced further after callers move to autonomy-owned imports

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

## Validation Summary

Validated in this session:

- `npx jest test/gateway/integration/daemon-bridge.test.ts`
- `npx jest test/autonomy/daemon-event-emitter.test.ts`
- `npm run build`

Focused ownership confirmation:

- import scan confirmed `src/gateway/gateway-server.ts` now imports `IDaemonEventEmitter` from `src/autonomy/daemon-event-emitter.ts`
- no runtime-owned code imports the daemon event-source contract from a gateway-named file on the touched path
- the historical gateway barrels still expose compatibility re-exports for existing callers

Observed non-blocking environment note:

- both Jest runs emitted the existing Node warning about `--localstorage-file` being provided without a valid path; the tests still passed and this session did not touch that area

## Recommended Next Session

The next session in this new gateway/daemon transport-boundary block should stay in the same seam and review the next highest-value mixed ownership around daemon attachment or event-forwarding adjacency, most likely:

- either narrowing `DaemonBridge` attachment semantics if there is a safe behavior-preserving unsubscribe/detach cleanup
- or tightening any remaining routing/pass-through layer around gateway-side daemon attachment in `GatewayServer` if it still mixes transport and runtime concerns

The important constraint is to keep the next step inside the gateway/daemon transport boundary rather than reopening scheduler composition or broader gateway cleanup.
