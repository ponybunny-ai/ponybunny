# Session 110: RF-062 Tool-Provider Runtime Wiring Cluster

## Scope

Session 110 starts `RF-062` with the first major coding cluster identified in Session 109: the still-mixed `GatewayToolProviderRuntime` ownership/publication seam in `src/gateway/gateway-server.ts`.

The targeted cluster was intentionally narrow:

- `GatewayToolProviderRuntime` construction
- publication of the resulting tool-registry facet into adjacent runtime/control wiring
- removal of now-redundant `GatewayServer` pass-through ownership for tool allowlist/enforcer fields that were no longer consumed locally

This session does not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`. It does not redesign provider execution semantics, startup/bootstrap behavior, scheduler behavior, daemon detach behavior, transport/UI/protocol surfaces, or public payload shapes.

## Targeted RF-062 Cluster

Before this session, `GatewayServer` still mixed three roles in one local block:

- constructing the gateway-local `GatewayToolProviderRuntime`
- selecting which runtime facet to publish into the adjacent `GatewayRuntimeRpcSurface`
- retaining extra tool-policy facets (`toolRegistry`, allowlist, enforcer) as server-owned fields even though the live adjacent consumer only needed the registry facet

That left a remaining `GatewayServer`-adjacent service-wiring concentration even after Session 92 had already moved the lower-level tool/provider graph assembly into `GatewayToolProviderRuntime`.

## Boundary Introduced

Added `src/gateway/runtime/gateway-tool-provider-runtime-cluster.ts`.

This helper now owns the bounded assembly/publication cluster:

- constructs `GatewayToolProviderRuntime`
- constructs `GatewayRuntimeRpcSurface`
- publishes the runtime's `toolRegistry` into that runtime/control surface

`GatewayServer` now consumes the result of `createGatewayToolProviderRuntimeCluster(...)` instead of manually:

- constructing `GatewayToolProviderRuntime`
- copying `toolRegistry`, allowlist, and enforcer onto local fields
- wiring `toolRegistry` into `GatewayRuntimeRpcSurface`

This is the main `RF-062` ownership/publication boundary for Session 110.

## What Moved Out Of GatewayServer

Moved out of `GatewayServer`:

- the composition step that binds `GatewayToolProviderRuntime` to `GatewayRuntimeRpcSurface`
- the publication decision that only the tool-registry facet should be forwarded to runtime/control handlers on this path
- the redundant local publication fields for `toolRegistry`, tool allowlist, and tool enforcer

The new helper is intentionally small. It is not a symmetry-driven extraction of unrelated runtime surfaces.

## What Intentionally Remained Inline

Intentionally kept inline in `GatewayServer` as steady-state runtime ownership:

- the server-owned `toolProviderRuntime` field
- the server-owned `runtimeRpcSurface` field
- handler registration timing
- server lifecycle, connection/auth state, audit ownership, rollout coordination, daemon attachment, scheduler attachment, and startup/shutdown sequencing

This preserves the existing rule that `GatewayServer` remains the live runtime owner while the mixed assembly/publication seam moves into one helper.

## Semantics Preserved

This session intentionally preserves:

- built-in gateway tool registration
- baseline tool allowlist seeding
- `ToolEnforcer` construction semantics
- global `ToolProvider` mirror installation
- provider-manager stream-sink binding behavior
- system/internal runtime handler behavior that depends on the published `toolRegistry`
- current RPC/event/status payload shapes
- gateway startup/bootstrap behavior
- provider execution/fallback behavior
- scheduler, transport, detach, and TUI behavior

No payload schemas or public runtime semantics changed.

## Remaining Likely RF-062 Follow-Up

Session 110 completes the first substantial coding cluster for `RF-062`, but it does not claim the whole line is finished.

The next session should be a review / re-ranking session focused on whether any meaningful `GatewayServer`-adjacent runtime-observation/service-wiring pressure still remains after this extraction, especially around:

- whether any other tool/provider-adjacent publication seam is still mixed in the live server
- whether `GatewayRuntimeRpcSurface` now has any remaining caller-side publication pressure worth extracting
- whether `RF-062` should continue immediately or pause after this larger structural step

It should not broaden into startup/bootstrap, transport, daemon detach, model source-of-truth, provider-manager redesign, or repo-wide gateway normalization.

## Validation

Validated with focused coverage on the affected path:

- `npx jest test/gateway/runtime/gateway-tool-provider-runtime.test.ts test/gateway/runtime/gateway-tool-provider-runtime-cluster.test.ts test/gateway/gateway-tool-provider-runtime-ownership.test.ts test/gateway/gateway-runtime-rpc-surface-ownership.test.ts test/gateway/rpc/internal-runtime-handlers.test.ts`
- `npx tsc --noEmit --pretty false`

Validation confirmed:

- the targeted assembly/publication cluster no longer lives mixed inline in `GatewayServer`
- adjacent runtime/control consumers still receive the intended `toolRegistry` facet
- the affected gateway/runtime ownership characterization tests remain green
- the internal runtime handler path still behaves as expected on the touched registry-facing surfaces
- TypeScript compilation remains clean after the boundary shift
