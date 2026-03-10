# Session 83: Compatibility/Public-Surface Rationalization

## Scope

This session started the next post-`RF-034` / post-transport-boundary refactor block by reviewing only the remaining compatibility/public-surface area adjacent to the recently completed scheduler and gateway/daemon work, then implementing one bounded consolidation cluster.

Primary objective for this session:

- reduce structural confusion caused by mixed gateway/public barrels and scattered compatibility exports
- preserve runtime behavior and historical import compatibility
- make intended live surfaces and compatibility-only surfaces easier to distinguish

## Reviewed surfaces and role classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/integration/gateway-daemon-attachment.ts` | intended live ownership-correct surface | Gateway-owned daemon attachment, status, and detach-facing operation state boundary. |
| `src/gateway/integration/gateway-daemon-lifecycle.ts` | intended live ownership-correct surface | Internal lifecycle bookkeeping for the live gateway-owned attachment seam. |
| `src/gateway/integration/gateway-daemon-detach-operations.ts` | intended live ownership-correct surface | Explicit detach-facing state helpers for the live attachment seam. |
| `src/gateway/integration/scheduler-bridge.ts` | intended live ownership-correct surface | Gateway-owned transport/event bridge from scheduler events into the gateway event bus. |
| `src/gateway/integration/scheduler-compatibility.ts` | intentional compatibility layer | Consolidated compatibility layer for historical gateway-side scheduler factory/adapter imports; scheduler/runtime code should not treat this as live ownership. |
| `src/gateway/integration/scheduler-factory.ts` | direct historical shim | Thin import-preserving pass-through to `scheduler-compatibility.ts`. |
| `src/gateway/integration/scheduler-repository-adapter.ts` | direct historical shim | Thin import-preserving pass-through to `scheduler-compatibility.ts`. |
| `src/gateway/integration/execution-engine-adapter.ts` | direct historical shim | Thin import-preserving pass-through to `scheduler-compatibility.ts`. |
| `src/gateway/integration/daemon-bridge.ts` | intentional compatibility layer | Historical gateway-facing daemon bridge; now only a shell over `GatewayDaemonAttachment`. |
| `src/gateway/integration/index.ts` before this session | mixed/ambiguous barrel | Mixed live gateway boundaries and compatibility-only exports in one surface. |
| `src/gateway/index.ts` before this session | mixed/ambiguous public barrel | Public gateway barrel mixed intended live API with compatibility-only exports, making ownership hard to read. |
| `src/index.ts` | true public package boundary | Narrow package root export surface; not part of the current compatibility sprawl and intentionally left unchanged. |

## Selected consolidation cluster

Chosen cluster:

- split gateway integration and gateway public barrels into explicit live and compatibility entrypoints
- keep the historical mixed barrels intact, but make them delegate through the explicit split

Why this cluster was chosen:

- the remaining debt was concentrated in barrels that still presented compatibility exports as if they were part of the live gateway-owned/public API
- the direct historical shim files were already thin enough; the larger confusion was that broad barrels still blurred ownership
- this cluster is behavior-preserving because it changes export routing and documentation shape, not runtime composition or call flow

## What changed

### New explicit live surfaces

- added `src/gateway/integration/boundaries.ts`
  - exports only live gateway-owned integration boundaries:
    - `GatewayDaemonAttachment`
    - gateway daemon attachment/detach status types
    - `SchedulerBridge`
- added `src/gateway/public.ts`
  - exports the intended live public gateway surface
  - routes live integration exports through `src/gateway/integration/boundaries.ts`

### New explicit compatibility surfaces

- added `src/gateway/integration/compatibility.ts`
  - centralizes compatibility-only integration exports:
    - `DaemonBridge`
    - `DaemonEventEmitterMixin`
    - `IDaemonEventEmitter`
    - scheduler compatibility exports from `scheduler-compatibility.ts`
- added `src/gateway/compatibility.ts`
  - centralizes compatibility-only public gateway exports

### Historical mixed barrels retained, but rerouted

- `src/gateway/integration/index.ts`
  - remains available for import compatibility
  - now clearly delegates live exports through `./boundaries.js`
  - now clearly delegates compatibility exports through `./compatibility.js`
- `src/gateway/index.ts`
  - remains available as the historical mixed public barrel
  - now re-exports from `./public.js` and `./compatibility.js` instead of remaining the place where all concerns are defined inline

## What was narrowed vs preserved

Narrowed:

- the live gateway entrypoints are now explicit and compatibility-free:
  - `src/gateway/integration/boundaries.ts`
  - `src/gateway/public.ts`
- the compatibility-only exports are now explicit and centralized:
  - `src/gateway/integration/compatibility.ts`
  - `src/gateway/compatibility.ts`

Preserved:

- all historical named exports from:
  - `src/gateway/integration/index.ts`
  - `src/gateway/index.ts`
- all direct historical shim paths:
  - `scheduler-factory.ts`
  - `scheduler-repository-adapter.ts`
  - `execution-engine-adapter.ts`
- current runtime behavior and composition

## Compatibility surfaces that remain and why

| Surface | Why it remains |
| --- | --- |
| `src/gateway/integration/scheduler-compatibility.ts` | Still the intentional consolidation point for gateway-side historical scheduler imports. Removing it would broaden scope into contract deletion instead of compatibility rationalization. |
| `src/gateway/integration/scheduler-factory.ts` | Historical direct import path preservation. |
| `src/gateway/integration/scheduler-repository-adapter.ts` | Historical direct import path preservation. |
| `src/gateway/integration/execution-engine-adapter.ts` | Historical direct import path preservation. |
| `src/gateway/integration/daemon-bridge.ts` | Historical gateway-facing daemon attachment shell; remains intentionally thinner than the live attachment boundary. |
| `src/gateway/integration/index.ts` | Mixed barrel retained for compatibility, but now visibly routed through explicit live/compatibility modules. |
| `src/gateway/index.ts` | Mixed public barrel retained for compatibility, but now visibly routed through explicit live/compatibility modules. |

## Intentionally postponed

- any broader redesign of package root exports in `src/index.ts`
- deletion of historical shim paths solely because they are old
- any gateway behavior, daemon behavior, scheduler behavior, replay behavior, or detach/unsubscribe semantic changes
- any broader barrel cleanup outside the gateway/integration and gateway public-surface cluster

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

- `npx jest test/gateway/gateway-public-surface.test.ts test/gateway/integration/integration-surface-split.test.ts test/gateway/integration/daemon-bridge.test.ts test/gateway/integration/gateway-daemon-attachment.test.ts test/gateway/integration/execution-engine-adapter.test.ts test/scheduler/composition/scheduler-repository-adapter.test.ts --runInBand`
- `npm run build`
- `node --input-type=module -e "...import('./dist/gateway/public.js')..."`

Validation intent:

- confirm the new live vs compatibility entrypoints export the expected names
- confirm the historical mixed barrels still preserve legacy named exports
- confirm existing daemon-bridge and scheduler compatibility shims still resolve correctly
- confirm the project still compiles after the barrel rerouting
- confirm the built `dist/` gateway entrypoints expose the intended live/compatibility split at runtime

Additional note:

- an initial broader test attempt also included `test/gateway/integration/scheduler-factory.test.ts`; that untouched test currently fails on an existing evented-execution expectation and was not used as final validation for this session because the session did not modify `scheduler-factory` or scheduler execution behavior

## Assessment of this new block

This looks like a multi-session block, not a one-session close.

Reason:

- the highest-value first move was the explicit barrel split, but the broader compatibility/public-surface block still has remaining decisions around which historical root/public paths should remain merely documented versus further narrowed
- the direct shims are now easier to reason about because they route through explicit compatibility modules, but they still exist and should be reviewed as a follow-up set rather than deleted opportunistically

## Recommended next session

Recommended next step in this block:

- review the remaining historical shim and root/public export paths adjacent to this new split
- decide whether one additional narrowing pass can safely reduce redundant pass-through layers without breaking intended public contracts
- keep that follow-up strictly inside compatibility/public-surface rationalization rather than reopening scheduler or daemon ownership work
