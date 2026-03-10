# Session 85: Public/Root Export Closure Attempt

## Scope

This session attempted to close `RF-059` by reviewing the remaining mixed gateway/root public export routes and implementing one bounded root-export consolidation cluster.

Primary objective:

- make the distinction between intended live surfaces, true public package boundaries, intentional compatibility layers, and direct historical shims explicit
- preserve runtime behavior and historical import compatibility
- determine whether the compatibility/public-surface rationalization block can now be closed cleanly

## Reviewed surfaces and role classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/public.ts` | intended live ownership-correct surface / true public gateway boundary | Explicit live gateway API introduced in Session 83. |
| `src/gateway/compatibility.ts` | intentional compatibility layer / public compatibility boundary | Explicit public compatibility route for historical gateway-facing imports. |
| `src/gateway/index.ts` | direct historical mixed barrel | Still mixed by design, but now only as a thin compatibility-preserving delegate to explicit live and compatibility gateway surfaces. |
| `src/gateway/integration/boundaries.ts` | intended live ownership-correct surface | Live gateway-owned attachment and scheduler bridge seam. |
| `src/gateway/integration/compatibility.ts` | intentional compatibility layer | Explicit compatibility barrel for historical gateway integration imports. |
| `src/gateway/integration/daemon-compatibility.ts` | intentional compatibility layer | Explicit daemon-side compatibility home introduced in Session 84. |
| `src/gateway/integration/index.ts` | direct historical mixed barrel | Retained only to preserve older mixed integration imports through explicit routes. |
| `src/public.ts` | true public package boundary | New explicit live root package surface for the stable package-level exports that still make sense as current public entrypoints. |
| `src/compatibility.ts` | intentional public root compatibility layer | New explicit root-level compatibility route for daemon/execution convenience exports that should remain available without implying they are the intended live package boundary. |
| `src/index.ts` | direct historical mixed root barrel | Previously an unlabeled blend of live package exports and historical daemon/execution conveniences; now reduced to a thin delegate. |
| `src/work-order/database/manager.ts` | strategically useful public export target | Kept as the root-facing database entry because it remains the stable top-level package-facing route. |
| `src/autonomy/daemon.ts` | strategically useful public export target | Kept on the live root surface as the package-level daemon entrypoint. |
| `src/autonomy/react-integration.ts` | compatibility-preserving carryover | Still intentionally exportable, but not treated as part of the intended live root package boundary. |
| `src/autonomy/daemon-event-emitter.ts` | compatibility-preserving carryover | Still intentionally exportable for historical bridge/import compatibility, but not part of the intended live root package boundary. |

## Selected consolidation cluster

Chosen cluster:

- add an explicit root live-vs-compatibility split
- narrow `src/index.ts` into a documented historical mixed barrel that delegates through that split
- add targeted validation for the new root routing shape

Why this cluster was chosen:

- the gateway-side surfaces were already explicit after Sessions 83-84
- the main remaining ambiguity was at the root, where `src/index.ts` still blended current package-boundary exports with older daemon/execution convenience exports without labeling the difference
- this cluster is large enough to close the remaining ambiguity without widening into broader package redesign or deleting compatibility paths

## What changed

### New explicit root live surface

- added `src/public.ts`
- routed the intended live root package surface through:
  - `WorkOrderDatabase`
  - `AutonomyDaemon`
  - work-order type exports

### New explicit root compatibility surface

- added `src/compatibility.ts`
- centralized compatibility-preserving root exports for:
  - `ReActIntegration`
  - `DaemonEventEmitterMixin`
  - `IDaemonEventEmitter`

### Historical mixed root barrel thinned

- reduced `src/index.ts` to a documented historical mixed barrel
- `src/index.ts` now re-exports from:
  - `./public.js`
  - `./compatibility.js`

### Validation coverage added for the root split

- added `test/root/public-root-surface.test.ts`
- this confirms:
  - `src/index.ts` delegates through explicit root live/compatibility entrypoints
  - `src/public.ts` does not expose compatibility-only exports
  - `src/compatibility.ts` does not expose live root package exports
  - the historical mixed root barrel still preserves legacy named exports

## What was re-routed, narrowed, or thinned

- `src/index.ts`
  - changed from an unlabeled root export list to a thin historical mixed barrel
- root package routing
  - now has the same explicit live-vs-compatibility structure already established in `src/gateway/`
- no gateway/integration runtime ownership paths were moved again

## Compatibility surfaces that remain and why

| Surface | Why it remains |
| --- | --- |
| `src/gateway/index.ts` | Historical gateway mixed barrel retained for compatibility; now already thin and explicit enough to be acceptable as a final compatibility boundary. |
| `src/gateway/integration/index.ts` | Historical mixed integration barrel retained for import compatibility; already reduced to delegation through explicit live and compatibility surfaces. |
| `src/gateway/compatibility.ts` | Explicit gateway public compatibility boundary; still useful and intentional. |
| `src/gateway/integration/compatibility.ts` | Explicit integration compatibility boundary; still useful and intentional. |
| `src/gateway/integration/daemon-compatibility.ts` | Explicit daemon-side compatibility module; remains the correct home for historical daemon bridge compatibility logic. |
| `src/compatibility.ts` | Explicit root compatibility boundary; keeps older daemon/execution root imports available without blurring the intended live package boundary. |
| `src/index.ts` | Historical mixed root barrel retained for import compatibility; now thin enough that it no longer represents block-level architectural ambiguity. |

## What was intentionally postponed

- any broader package-architecture redesign beyond this explicit root/gateway surface split
- deletion of compatibility paths solely because they are historical
- any change to gateway behavior, scheduler behavior, daemon behavior, replay behavior, execution semantics, attach/connect behavior, or detach/unsubscribe semantics
- any broad root-index cleanup unrelated to compatibility/public-surface closure

## Block closure judgment

`RF-059` is closed.

Reason:

- the remaining mixed gateway/root export routes are now all explicitly classified as either:
  - true live/public boundaries
  - intentional compatibility boundaries
  - direct historical mixed barrels that are thin delegates only
- the remaining compatibility-preserving surfaces are acceptable final public boundaries rather than unresolved structural debt
- closing the block now does not require broader package redesign

No further follow-up row is required from this session.

## Preserved invariants

This session preserved:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` local-authoritative seam invariants
- `ConversationWorker` local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `LLMStreamEventSink` ownership direction
- extracted conversation bootstrap ownership
- scheduler composition ownership established during `RF-034`
- gateway/daemon transport-boundary ownership established in Sessions 78-82
- compatibility/public-surface split introduced in Sessions 83-84
- outer transport ownership lines
- durable ownership lines
- current scheduler behavior
- current daemon startup behavior
- current replay behavior
- current direct vs evented execution semantics
- current `runtimeEventBus` semantics and ownership
- current persistence semantics
- current public runtime behavior
- current attach/connect and detach/unsubscribe semantics

## Validation summary

Targeted validation run:

- `npx jest test/gateway/gateway-public-surface.test.ts test/gateway/integration/integration-surface-split.test.ts test/gateway/integration/daemon-bridge.test.ts test/root/public-root-surface.test.ts --runInBand`
- `npm run build`

Validation intent:

- confirm the explicit gateway live/compatibility routing still behaves as expected
- confirm the new root live/compatibility routing is explicit and preserves historical root named exports
- confirm the project still compiles after the root export split

Validation result:

- both validation commands passed during this session
