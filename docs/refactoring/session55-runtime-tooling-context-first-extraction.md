# Session 55: Runtime Tooling Context First Extraction

## What changed

Session 55 introduced the first explicit runtime-owned tooling boundary at [`src/runtime/tooling-context/runtime-tooling-context.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tooling-context/runtime-tooling-context.ts).

`RuntimeToolingContext` now owns the narrow runtime-core tooling surface needed for the first extraction:

- `toolRegistry`
- `toolAllowlist`
- `toolEnforcer`
- `toolProvider`
- `skillRegistry`
- a lazily created `PromptProvider` derived from the explicit tool and skill surfaces

The context also exposes `syncLegacyGlobals()` so the old singleton path can remain as a compatibility mirror for code that was not migrated in this session. That compatibility shim is no longer the source of truth for the migrated runtime-core path.

## Migrated consumers

The first runtime-core consumers moved off `globalToolProvider` as the authoritative source are:

- [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts)
- [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts)
- [`src/app/lifecycle/planning/planning-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/planning/planning-service.ts)
- [`src/app/conversation/response-generator.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/conversation/response-generator.ts)
- [`src/scheduler-daemon/session-intake.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/session-intake.ts) as the local runtime assembler for conversation response generation

The new ownership flow is:

1. `ExecutionService` builds the runtime tool graph exactly as before.
2. `ExecutionService` wraps that graph in `RuntimeToolingContext`.
3. `ExecutionService` passes that explicit context into `ReActIntegration`.
4. Runtime assembly points that need prompt/conversation capability shape now receive the same explicit context and pass it into `PlanningService` or `ResponseGenerator`.
5. Legacy globals are updated only as a mirror for non-migrated callers.

This keeps tool execution semantics, worker seams, IPC, and gateway behavior unchanged.

## What remains on the old global path

The old singleton path still exists for compatibility and for non-migrated callers:

- `getGlobalToolProvider()` still exists
- `getGlobalPromptProvider()` still exists
- gateway-owned tool composition still mirrors into the global provider path
- direct callers that do not yet receive explicit runtime tooling context still fall back to globals

That remaining global path is intentionally not removed in Session 55. The goal here was to make the runtime-core path explicit and authoritative first, not to eliminate every singleton in one pass.

## Source-of-truth change

Before this session:

- runtime-core capability shape was inferred through mutable global provider state
- multiple composition roots could replace the active tool provider

After this session:

- the migrated runtime-core path reads tool/prompt capability shape from `RuntimeToolingContext`
- `globalToolProvider` and `globalPromptProvider` are compatibility mirrors only for that path
- overwriting the global provider no longer changes the capability surface seen by migrated `PlanningService`, `ResponseGenerator`, or `ReActIntegration` instances that were wired with the explicit context

## What did not change

Session 55 intentionally did not change:

- gateway behavior
- IPC behavior
- direct vs evented execution semantics
- scheduler-owned run identity or recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` design
- `ConversationWorker` design
- durable ownership lines
- MCP ownership boundaries beyond exposing the existing runtime tool graph through the new context

## Focused validation

Validated in this session:

- `npx jest test/app/lifecycle/planning/planning-service-runtime-tooling-context.test.ts test/app/conversation/response-generator-runtime-tooling-context.test.ts test/autonomy/react-integration.test.ts test/app/lifecycle/execution/execution-service.test.ts test/scheduler-daemon/session-intake.test.ts`
- `npm run build`

The new focused tests verify that migrated runtime-core consumers use the explicit tooling context instead of falling back to global prompt/tool singletons.

## Next safest cleanup step

The next safest runtime-core cleanup step is to continue reducing singleton-backed composition pressure around the remaining runtime startup roots while keeping ownership lines intact.

The safest immediate follow-up is:

- thread `RuntimeToolingContext` through the remaining runtime composition roots that still rely on singleton fallback
- then narrow the remaining prompt/tool singleton reads around scheduler/runtime assembly without changing gateway, IPC, or worker topology

That continues the runtime-core ownership cleanup without broadening into scheduler-factory relocation, daemon splitting, worker redesign, or transport ownership changes.
