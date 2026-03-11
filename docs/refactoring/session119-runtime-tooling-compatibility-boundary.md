# Session 119: Runtime Tooling Compatibility Boundary

## Targeted RF-071 Cluster

Session 119 completed the first major coding cluster of `RF-071`:

- introduce one explicit compatibility owner for legacy prompt/tool-provider fallback access and installation
- move `PromptProvider`'s embedded global-default behavior behind that boundary
- route both runtime-owned and gateway-owned legacy-global installation through the same seam
- preserve explicit `RuntimeToolingContext` authority on migrated execution paths

This session stayed tightly bounded to the legacy prompt/tool fallback boundary and did not reopen `RF-034`, `RF-059`, `RF-060`, `RF-061`, or any paused refactor line.

## Compatibility Owner Introduced

Added `src/infra/prompts/legacy-prompt-tooling-compatibility.ts`.

That module now explicitly owns the compatibility-only concerns that were previously split across multiple surfaces:

- reading the legacy fallback dependencies used by prompt construction
- reading the legacy fallback tool provider for non-migrated consumers
- owning the legacy global prompt-provider singleton mirror
- applying legacy/global prompt/tool installation writes

It is intentionally not a new runtime tooling authority. Explicit runtime-owned construction still lives with `RuntimeToolingContext` and the existing runtime-owned execution factories.

## PromptProvider Fallback/Default Changes

`src/infra/prompts/prompt-provider.ts` now delegates its default/global behavior to the new compatibility module:

- the no-argument `PromptProvider` construction path now reads fallback `SkillRegistry` and `ToolProvider` dependencies through `readLegacyPromptToolingFallback()`
- `getGlobalPromptProvider()` now delegates singleton creation through `getLegacyCompatiblePromptProvider(...)`
- `setGlobalPromptProvider()` now delegates legacy global prompt-provider installation through `setLegacyCompatiblePromptProvider(...)`

Public `PromptProvider` semantics were intentionally preserved:

- explicit `new PromptProvider(skillRegistry, toolProvider)` construction still works unchanged
- the no-argument compatibility/default path still behaves like the historical global-default path
- existing getter/setter compatibility surfaces remain available

## Legacy-Global Installation Changes

The two current legacy-global installation paths now route through the same compatibility seam:

- `RuntimeToolingContext.syncLegacyGlobals()` now calls `installLegacyPromptToolingGlobals(...)` with the runtime-owned `toolProvider` plus its lazily created `PromptProvider`
- `GatewayToolProviderRuntime` now calls `installLegacyPromptToolingGlobals(...)` with its gateway-owned `toolProvider`

This keeps the old side effects intact while making the compatibility write owner explicit.

## Runtime-Owned vs Fallback Access Changes

Fallback-capable consumers reviewed in Session 118 now read through the compatibility boundary on their legacy path:

- `ReActIntegration`
- `PlanningService`
- `ResponseGenerator`

Their explicit runtime-owned path remains unchanged:

- when a `RuntimeToolingContext` is provided, they still use that explicit runtime-owned provider/context directly
- `LocalExecutionCycleRuntimeFactory` and other explicit runtime-owned construction paths remain authoritative
- no execution, gateway, IPC, payload, conversation lifecycle, or TUI semantics were intentionally changed

## Semantics Intentionally Preserved

This cluster intentionally preserved:

- `RuntimeToolingContext` as the authority on migrated execution paths
- gateway-owned tool graph assembly and stream-sink binding behavior
- current legacy getter/setter compatibility surfaces
- current fallback/default prompt behavior
- current execution, gateway, IPC, payload, and TUI behavior
- current provider execution/fallback behavior

This session did not broaden into agent-registry cleanup, model-selection/source-of-truth work, provider-manager redesign, transport cleanup, or repo-wide singleton removal.

## Likely Next Review Focus

The next session should be a review / re-ranking pass rather than another small cleanup.

Most likely review topics:

- confirm this compatibility owner now cleanly contains the highest-value legacy prompt/tool fallback read/write split
- reassess whether any remaining fallback residue is still worth another bounded RF-071 cluster
- verify that the remaining candidates are truly local compatibility follow-ups rather than a disguised broader singleton/tool-topology redesign

## Validation Summary

Validated with:

- `npx jest test/infra/prompts/prompt-provider.test.ts test/infra/prompts/prompt-provider-compatibility.test.ts test/runtime/runtime-tooling-context-legacy-compatibility.test.ts test/gateway/runtime/gateway-tool-provider-runtime.test.ts test/gateway/runtime/gateway-tool-provider-runtime-cluster.test.ts test/app/conversation/response-generator-runtime-tooling-context.test.ts test/app/lifecycle/planning/planning-service-runtime-tooling-context.test.ts test/autonomy/react-integration.test.ts test/app/lifecycle/execution/execution-service.test.ts`
- `npx tsc --noEmit --pretty false`

Results:

- the new compatibility owner mediates the touched legacy prompt/tool fallback read/write paths reviewed in this session
- `PromptProvider` default/global construction now delegates through the compatibility seam
- runtime-owned and gateway-owned legacy-global installation now share the same compatibility installer
- explicit runtime-owned tooling paths and adjacent focused tests remained green
