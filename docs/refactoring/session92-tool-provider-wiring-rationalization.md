# Session 92: Tool-Provider Wiring Rationalization

## Summary

This session continued `RF-061` by reviewing the tool-registry / global tool-provider-related surfaces still living inside and immediately adjacent to `GatewayServer`, then extracting one cohesive internal tool/provider graph assembly helper without changing runtime semantics.

The selected consolidation cluster was the gateway-local tool/provider wiring path:

- built-in gateway tool registration
- baseline gateway tool allowlist seeding
- `ToolEnforcer` construction over that graph
- gateway-local `ToolProvider` construction for the legacy global mirror
- installation of the gateway-owned LLM stream event sink used by provider-manager streaming callbacks

`GatewayServer` remains the steady-state runtime owner. The new helper makes the internal tool/provider graph assembly explicit instead of leaving that wiring mixed into the live server alongside runtime-owned APIs, RPC registration, and lifecycle state.

## Reviewed Surfaces

| Surface | Classification | Notes |
| --- | --- | --- |
| `src/gateway/gateway-server.ts` | mixed steady-state runtime owner plus internal tool/provider wiring | Still owns live gateway runtime state, handler registration, lifecycle delegation, and runtime-facing access to tool state, but Session 91 left the tool registry / provider assembly inline here. |
| `src/gateway/channels/gateway-channel-runtime.ts` | previously extracted internal runtime graph helper | Session 89 already isolated channel runtime ownership; intentionally not reopened. |
| `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts` | previously extracted internal rollout/rollback wiring helper | Session 90 already isolated rollout telemetry / rollback coordination; intentionally not reopened. |
| `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts` | previously extracted internal audit observation helper | Session 91 already isolated scheduler-event audit wiring; intentionally not reopened. |
| new `src/gateway/runtime/gateway-tool-provider-runtime.ts` | explicit internal tool-registry / global tool-provider wiring helper | Now owns gateway-local tool/provider graph assembly, baseline allowlist seeding, global provider mirror installation, and gateway-owned stream-sink binding. |
| `src/infra/tools/tool-registry.ts` | true tool-registry primitives | Registry / allowlist / enforcer implementations already existed; this session did not redesign tool-policy semantics. |
| `src/infra/tools/tool-provider.ts` | true provider-bridge primitive plus compatibility-global surface | Still provides LLM tool definitions and the legacy global provider mirror; reviewed because `GatewayServer` was wiring it directly. |
| `src/gateway/events/llm-stream-event-sink.ts` | true gateway-owned event adapter | Already the correct boundary for mapping provider-manager stream callbacks onto gateway-visible events; kept as the concrete sink used by the new helper. |
| `src/runtime/tooling-context/runtime-tooling-context.ts` | runtime-core source-of-truth boundary on migrated paths | Reviewed to confirm that the new gateway helper does not change the existing rule: explicit runtime tooling context remains authoritative on migrated paths, while global provider installation remains a compatibility mirror for non-migrated consumers. |
| `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts` | startup/bootstrap helper already closed by `RF-060` | Reviewed only to confirm that this session should not widen into startup sequencing. |
| gateway/daemon attachment and IPC transport helpers | transport-boundary concern already closed in Sessions 78-82 | Reviewed only to confirm the selected cluster was not really a transport issue. |
| gateway/public compatibility surfaces | compatibility/public-surface concern already closed in Sessions 83-85 | No public exports or compatibility shims changed. |

## Selected Consolidation Cluster

The highest-value next cluster after Session 91 was the gateway-local tool/provider graph assembly path because it still blurred multiple roles inside `GatewayServer`:

- steady-state runtime ownership that should remain in the live server
- internal tool-registry wiring that does not need to stay inline there
- internal global tool-provider / provider-bridge wiring that exists mostly to keep legacy/global consumers pointed at the gateway-owned graph

This cluster was chosen because:

- it was directly adjacent to `GatewayServer`
- it mixed registry construction, allowlist policy seeding, provider installation, and stream-sink binding into the live runtime owner
- it could be extracted without reopening startup/bootstrap, transport, compatibility/public surfaces, channel runtime, rollout/rollback wiring, or scheduler-event audit wiring
- it was materially larger than a cosmetic rename and clarified a real runtime-graph ownership ambiguity

This was a better Session 92 target than broader tooling cleanup because the ambiguity was local to gateway service wiring, while broader runtime-tooling context evolution would widen into already-separated runtime-core work.

## What Changed

### New internal helper

Added `src/gateway/runtime/gateway-tool-provider-runtime.ts`.

It now owns:

- construction of the gateway-local `ToolRegistry`
- construction of the gateway-local `ToolAllowlist`
- registration of the current built-in gateway tools
- seeding of the current baseline allowed tool set
- construction of the gateway-local `ToolEnforcer`
- construction of the gateway-local `ToolProvider`
- installation of that provider through `setGlobalToolProvider(...)`
- binding of the gateway-owned `GatewayLLMStreamEventSink` through `configureLLMProviderManagerStreamEventSink(...)`

### `GatewayServer` after the extraction

`GatewayServer` now:

- constructs one `GatewayToolProviderRuntime`
- keeps runtime-facing references to the helper-owned `toolRegistry`, `toolAllowlist`, and `toolEnforcer`
- continues to supply the tool registry to system and internal-runtime handlers
- continues to own RPC registration, event bus ownership, scheduler/runtime coordination, and other steady-state server behavior

The resulting distinction is clearer:

- `GatewayServer`: steady-state runtime owner and runtime/public API surface
- `GatewayToolProviderRuntime`: gateway-internal tool-registry / global tool-provider graph assembly and binding helper

### What moved / what was re-routed / what was clarified

- The inline built-in tool registration moved out of `GatewayServer`.
- The inline baseline allowlist seeding moved out of `GatewayServer`.
- The inline `ToolEnforcer` construction moved out of `GatewayServer`.
- The inline `ToolProvider` construction and `setGlobalToolProvider(...)` call moved out of `GatewayServer`.
- The provider-manager stream-sink binding call moved out of `GatewayServer`.
- `GatewayServer` still exposes the same tool registry to existing internal/system handler wiring, but it no longer looks like the semantic owner of provider-graph assembly.

No tool names, allowlist contents, RPC routes, event names, stream payloads, scheduler behavior, daemon behavior, or runtime ownership semantics were changed.

## Adjacent Surfaces Intentionally Left Untouched

- `src/runtime/tooling-context/runtime-tooling-context.ts`
  - explicit `RuntimeToolingContext` remains the source of truth on migrated paths; this session did not move gateway runtime behavior back behind a global or reopen RF-055 / RF-032 concerns
- `src/gateway/bootstrap/default-gateway-runtime.ts`
  - startup/bootstrap composition-root work was already closed by `RF-060`
- `src/gateway/bootstrap/gateway-server-runtime-lifecycle.ts`
  - startup/shutdown sequencing remains the correct helper boundary; no lifecycle redesign was needed
- `src/gateway/channels/gateway-channel-runtime.ts`
  - Session 89 already isolated the channel runtime family
- `src/gateway/runtime/gateway-runtime-rollout-coordinator.ts`
  - Session 90 already isolated rollout telemetry / rollback wiring
- `src/gateway/runtime/gateway-scheduler-event-audit-observer.ts`
  - Session 91 already isolated scheduler-event audit wiring
- gateway/daemon attachment, detach, and IPC transport helpers
  - Sessions 78-82 already closed those transport-boundary ownership lines
- compatibility/public surfaces and historical shims
  - Sessions 83-85 already closed that block
- ToolWorker, ConversationWorker, replay, execution/recovery semantics, scheduler behavior, and daemon behavior
  - all remain out of scope for this session

## Intentionally Postponed

Intentionally postponed after this session:

- any gateway-adjacent dynamic MCP/global tool refresh behavior, because Session 92 only rationalized the existing static built-in provider wiring cluster
- any broader unification of gateway-local tool assembly with the execution/runtime-tooling-context path, because that would broaden into runtime-core ownership rather than this gateway-local service-wiring cluster
- any remaining mixed `GatewayServer` runtime-observation or service-wiring concerns unrelated to tool/provider graph assembly

`RF-061` still clearly looks like a multi-session block after this session. One meaningful tool/provider wiring cluster is now explicit, but `GatewayServer` still contains other adjacent service-wiring pressure that should be reviewed separately instead of folded into this session.

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
- channel runtime extraction established in Session 89
- rollout telemetry / rollback extraction established in Session 90
- scheduler-event audit extraction established in Session 91
- outer transport ownership lines
- durable ownership lines
- current scheduler behavior
- current daemon startup behavior
- current gateway startup behavior
- current replay behavior
- current direct vs evented execution semantics
- current `runtimeEventBus` semantics and ownership
- current persistence semantics
- current public runtime behavior
- current attach/connect and detach/unsubscribe semantics

## Validation Summary

Validated with:

- `npx jest test/gateway/runtime/gateway-tool-provider-runtime.test.ts test/gateway/gateway-tool-provider-runtime-ownership.test.ts test/gateway/gateway-scheduler-audit-runtime-ownership.test.ts test/gateway/gateway-rollout-runtime-ownership.test.ts test/gateway/gateway-startup-runtime-ownership.test.ts test/gateway/bootstrap/gateway-server-runtime-lifecycle.test.ts`
- `npx tsc --noEmit`

Results:

- focused gateway runtime/helper coverage passed
- gateway runtime-ownership characterization tests passed
- existing gateway startup/rollout/audit ownership characterization remained green after the extraction
- full TypeScript check passed
- no runtime-semantics regressions were observed in the touched tool/provider wiring paths

## Recommended Next Session

Stay in `RF-061`, but choose only one remaining `GatewayServer`-adjacent mixed service-wiring cluster. The next best target appears to be either:

- another gateway-local observation/wiring concern still mixed into the live server, if it is comparably cohesive
- or a narrower review of whether any remaining tool/provider-adjacent pass-through layer is now redundant after the explicit gateway tool-provider runtime extraction

Do not reopen startup/bootstrap, transport, compatibility/public surfaces, runtime-core source-of-truth rules, channel runtime extraction, rollout wiring, or scheduler-event audit wiring.
