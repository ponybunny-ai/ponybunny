# Session 84: Historical Shim Thinning and Root Export Narrowing

## Scope

This session continued `RF-059` by reviewing the remaining direct historical shim layer and the adjacent public/root export routing introduced in Session 83, then implementing one bounded consolidation cluster.

Primary objective:

- make intended live gateway ownership surfaces more obvious
- keep compatibility-preserving paths explicit and secondary
- reduce ambiguity between direct historical shims and intentional compatibility modules
- preserve runtime behavior and import compatibility

## Reviewed surfaces and role classification

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/integration/scheduler-factory.ts` | direct historical shim | Already a thin pass-through to `scheduler-compatibility.ts`. |
| `src/gateway/integration/scheduler-repository-adapter.ts` | direct historical shim | Already a thin pass-through to `scheduler-compatibility.ts`. |
| `src/gateway/integration/execution-engine-adapter.ts` | direct historical shim | Already a thin pass-through to `scheduler-compatibility.ts`. |
| `src/gateway/integration/scheduler-compatibility.ts` | intentional compatibility layer | Consolidated historical scheduler-facing exports; still useful as the one explicit compatibility surface for scheduler-owned concerns. |
| `src/gateway/integration/gateway-daemon-attachment.ts` | intended live ownership-correct surface | Gateway-owned attachment/reporting boundary for daemon event forwarding. |
| `src/gateway/integration/gateway-daemon-lifecycle.ts` | intended live ownership-correct surface | Internal live attachment lifecycle bookkeeping. |
| `src/gateway/integration/gateway-daemon-detach-operations.ts` | intended live ownership-correct surface | Explicit detach-facing operation state helpers for the live attachment seam. |
| `src/gateway/integration/daemon-bridge.ts` before this session | direct historical shim carrying real compatibility logic | Historical import path, but it still contained the actual daemon compatibility class and mixed routing narrative. |
| `src/gateway/integration/daemon-compatibility.ts` after this session | intentional compatibility layer | New explicit home for the historical daemon bridge compatibility logic. |
| `src/gateway/integration/boundaries.ts` | intended live ownership-correct surface | Explicit live gateway integration boundary barrel from Session 83. |
| `src/gateway/integration/compatibility.ts` | intentional compatibility layer | Explicit compatibility barrel for gateway integration surfaces. |
| `src/gateway/integration/index.ts` | mixed/ambiguous historical barrel | Retained only for import compatibility; now routes through explicit live and compatibility barrels. |
| `src/gateway/public.ts` | intended live ownership-correct surface / true public gateway boundary | Explicit live public gateway API introduced in Session 83. |
| `src/gateway/compatibility.ts` | intentional compatibility layer / public compatibility boundary | Explicit public compatibility route introduced in Session 83. |
| `src/gateway/index.ts` | mixed/ambiguous historical public barrel | Retained for compatibility; delegates to `public.ts` and `compatibility.ts`. |
| `src/index.ts` | true public package boundary | Narrow root export surface; reviewed to confirm it does not currently blend live gateway ownership with compatibility routing. |

## Selected consolidation cluster

Chosen cluster:

- extract the daemon-side historical compatibility implementation into an explicit compatibility module
- reduce `src/gateway/integration/daemon-bridge.ts` to a true direct shim
- reroute adjacent gateway integration compatibility exports through the new explicit daemon compatibility module

Why this cluster was chosen:

- the scheduler direct shims were already thin and no longer carried meaningful logic
- the daemon historical path still carried the actual compatibility implementation, which made the direct shim look more important and ownership-correct than it is
- the adjacent public/export routing from Session 83 already existed, so the highest-value next move was to make the daemon historical route match that explicit live-vs-compatibility shape

## What changed

### New explicit daemon compatibility module

- added `src/gateway/integration/daemon-compatibility.ts`
- moved the existing `DaemonBridge` compatibility class and daemon event-emitter compatibility re-exports into that module without changing behavior
- kept the compatibility logic exactly as before: `DaemonBridge` still wraps `GatewayDaemonAttachment`, delegates `connect()`, `getStatus()`, `isConnected()`, and `emit()`, and preserves the same constructor shape

### Historical direct shim thinned

- reduced `src/gateway/integration/daemon-bridge.ts` to a direct re-export shim
- its role is now explicit:
  - `daemon-bridge.ts` is the historical path
  - `daemon-compatibility.ts` is the intentional compatibility layer
  - `boundaries.ts` remains the intended live gateway-owned path

### Adjacent compatibility routing narrowed

- updated `src/gateway/integration/compatibility.ts` to export daemon compatibility concerns from `daemon-compatibility.ts`
- left `src/gateway/public.ts`, `src/gateway/compatibility.ts`, `src/gateway/index.ts`, and `src/index.ts` behavior unchanged because they were reviewed but did not contain a higher-value redundant pass-through within this session’s scope

## Compatibility surfaces that remain and why

| Surface | Why it remains |
| --- | --- |
| `src/gateway/integration/scheduler-compatibility.ts` | Still the single explicit compatibility layer for historical scheduler-side imports. |
| `src/gateway/integration/scheduler-factory.ts` | Historical direct import preservation. |
| `src/gateway/integration/scheduler-repository-adapter.ts` | Historical direct import preservation. |
| `src/gateway/integration/execution-engine-adapter.ts` | Historical direct import preservation. |
| `src/gateway/integration/daemon-compatibility.ts` | Now the explicit home for daemon-side historical compatibility logic. |
| `src/gateway/integration/daemon-bridge.ts` | Historical direct import preservation; intentionally thinned in this session. |
| `src/gateway/integration/index.ts` | Historical mixed barrel retained for compatibility with older imports. |
| `src/gateway/compatibility.ts` | True public compatibility boundary and still useful as the explicit compatibility entrypoint. |
| `src/gateway/index.ts` | Historical mixed public barrel retained for compatibility. |
| `src/index.ts` | True package root boundary; preserved because removing or redesigning it would widen scope beyond shim/public-surface rationalization. |

## What was intentionally postponed

- any broader redesign of `src/index.ts`
- any deletion of historical mixed barrels or direct shims solely because they are old
- further narrowing of scheduler-related direct shims, since they are already behaving as intentionally thin pass-throughs
- any behavioral changes to gateway/daemon attach, detach, unsubscribe, scheduler composition, replay, or execution semantics
- any wider package-architecture cleanup outside this shim/public-export objective

## Compatibility/public-surface block assessment

This block looks closer to closure than it did in Session 83, but it still likely needs at least one further session.

Reason:

- the direct daemon historical path now matches the explicit compatibility-routing model better
- the remaining debt is smaller and more documentary/routing-oriented than structural
- the main unresolved question is whether any additional mixed public/root export routes can be narrowed further without stepping into broader package-API redesign

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
- compatibility/public-surface split introduced in Session 83
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

- `npx jest test/gateway/integration/daemon-bridge.test.ts test/gateway/integration/integration-surface-split.test.ts test/gateway/integration/gateway-daemon-attachment.test.ts --runInBand`
- `npm run build`

Validation intent:

- confirm `DaemonBridge` still behaves the same through the historical shim path
- confirm the explicit compatibility barrel now resolves daemon compatibility exports through `daemon-compatibility.ts`
- confirm the live gateway-owned daemon attachment boundary remains unchanged
- confirm the TypeScript build still succeeds after the shim thinning/rerouting

## Recommended next session

Recommended next step in this block:

- review whether the remaining mixed public/root export routes can be narrowed one more step without turning `src/index.ts` or `src/gateway/index.ts` into a broader package-architecture redesign
- keep the work focused on explicit compatibility routing and historical shim thinning, not deletion for its own sake
