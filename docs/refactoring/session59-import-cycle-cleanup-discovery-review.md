# Session 59: RF-033 Import-Cycle Cleanup Discovery Review

## Scope and session guardrails

This session is discovery/design only for `RF-033`.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution/recovery
- redesign `ToolWorker`
- redesign `ConversationWorker`
- implement runtime-core cleanup code
- perform broad module moves or renames

The goal here is to identify the highest-value current import-cycle or cross-layer dependency knot to break first while preserving the seams stabilized in Sessions 54-58.

## Method used

This review is based on:

- a local relative-import scan across `src/`
- targeted package-level SCC inspection
- manual review of the current execution, runtime, conversation, tooling, prompt, and persistence seams

Important baseline finding:

- The codebase does not currently show a large number of obvious file-to-file runtime import loops across `src/`.
- The more important current problems are package-level back-edges, constructor/composition knots, and runtime/global ownership coupling.
- There is also at least one real direct TypeScript import cycle that is small but architecturally secondary.

That distinction matters for `RF-033`: the first cleanup should target the cross-layer knot that currently creates the most architectural drag, not just the smallest literal cycle.

## Current findings by category

### 1. Mixed package-level import SCC around execution runtime ownership

Primary files:

- `src/runtime/execution-boundary/local-execution-adapter.ts`
- `src/app/lifecycle/execution/execution-service.ts`
- `src/autonomy/react-integration.ts`
- `src/runtime/workers/tool-worker.ts`
- `src/runtime/event-bus/adapters/scheduler-event-adapter.ts`
- `src/scheduler/core/types.ts`

Observed structure:

- `src/scheduler/core/types.ts` imports `ExecutionPort` and `RuntimeEventBus`.
- `src/runtime/event-bus/adapters/scheduler-event-adapter.ts` imports `ISchedulerCore` and scheduler event types.
- `src/runtime/execution-boundary/local-execution-adapter.ts` imports `IExecutionService` from `src/app/lifecycle/stage-interfaces.ts`.
- `src/app/lifecycle/execution/execution-service.ts` imports `ReActIntegration`, `LocalToolAdapter`, `RuntimeToolingContext`, and `LocalToolWorker`, then constructs all of them in one place.
- `src/autonomy/react-integration.ts` imports `LocalToolWorker` and runtime tool-boundary types directly.

Classification:

- Not primarily a single file-to-file import cycle.
- It is a real package-level SCC plus a constructor/composition dependency knot.
- It also contains a dependency-direction smell: `runtime/execution-boundary` reaches upward into `app/lifecycle`.

Why this matters now:

- The runtime execution boundary is supposed to be the stable seam between scheduler-owned execution dispatch and the local execution implementation.
- Today that seam still depends directly on `app/lifecycle` contracts, while `ExecutionService` also owns construction of runtime tooling and the local tool worker stack.
- That makes the execution seam look boundary-shaped from the scheduler side, but composition-shaped from the runtime side.

What invariant it threatens if left untouched:

- scheduler-owned run identity and execution/recovery invariants, because the execution boundary remains entangled with app-layer implementation details instead of staying a thin scheduler-facing contract
- `ReActIntegration` continuation ownership, because tool-runtime construction and continuation-driving logic remain co-located inside `ExecutionService`
- `ToolWorker` local-authoritative seam invariants, because the current composition knot makes it too easy to pull `LocalToolWorker` ownership back upward into app-level orchestration instead of keeping it a narrow runtime seam

### 2. Conversation/tooling/prompt/runtime knot

Primary files:

- `src/app/conversation/response-generator.ts`
- `src/runtime/tooling-context/runtime-tooling-context.ts`
- `src/infra/prompts/prompt-provider.ts`
- `src/infra/tools/tool-provider.ts`
- `src/infra/conversation/session-repository.ts`

Observed structure:

- `ResponseGenerator` depends on `RuntimeToolingContext` and still falls back to `getGlobalToolProvider()`.
- `RuntimeToolingContext` writes legacy globals via `setGlobalToolProvider(...)` and `setGlobalPromptProvider(...)`.
- `PromptProvider` reads global tool and skill providers by default.
- infra conversation repositories depend on app-layer repository interfaces from `SessionManager`.

Classification:

- Mostly dependency-direction smell and runtime/global ownership coupling.
- Also contains constructor/composition coupling.
- Only parts of it are literal import cycles.

Why this matters now:

- This knot weakens the “runtime tooling context is the source of truth on migrated paths” rule by keeping conversation and prompt generation partially coupled to global fallback surfaces.
- It also keeps infra repositories reaching into app interfaces, which blurs the intended direction around the `ConversationWorker` line.

What invariant it threatens if left untouched:

- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `ConversationWorker` local-authoritative seam invariants, because conversation-side dependencies are still too willing to reach through globals or app-owned contracts

Why it is not the first cleanup target:

- It is broader than the execution knot.
- It cuts across conversation, prompts, tooling, config, and legacy globals at once.
- Touching it first would create unnecessary risk of accidentally redesigning the conversation seam rather than just cleaning dependency direction.

### 3. Deterministic runtime event store and persistence interface back-edge

Primary files:

- `src/infra/persistence/repository-interface.ts`
- `src/deterministic-runtime/run-events.ts`

Observed structure:

- `repository-interface.ts` imports `DeterministicRunEvent` and `DeterministicRunEventType`.
- `run-events.ts` imports `IWorkOrderRepository`.

Classification:

- True import cycle.

Why this matters now:

- The deterministic runtime event model and the persistence contract currently know about each other directly.
- That makes the repository contract both define storage behavior and participate in deterministic runtime event modeling.

What invariant it threatens if left untouched:

- durable ownership lines, because durable-event storage contracts and deterministic runtime event modeling are still mutually defining each other instead of one side owning the contract cleanly

Why it is not the first cleanup target:

- It is real but localized.
- It does not currently threaten the worker seams or the scheduler-owned execution identity line as directly as the execution/runtime knot does.

## Clear distinction between problem types

### Import cycles

Current confirmed true import cycle:

- `src/infra/persistence/repository-interface.ts`
- `src/deterministic-runtime/run-events.ts`

This is a literal mutual module dependency.

### Constructor/composition dependency knots

Current highest-value knot:

- `ExecutionService` constructs `ToolRegistry`, `ToolAllowlist`, `ToolEnforcer`, `ToolProvider`, `RuntimeToolingContext`, `LocalToolAdapter`, `LocalToolWorker`, and `ReActIntegration` in one constructor path.

This is not just “too many imports”. It is one composition root that currently owns both app-level execution orchestration and runtime-local tool machinery.

### Runtime/global ownership coupling

Current visible examples:

- `RuntimeToolingContext.syncLegacyGlobals()`
- `ResponseGenerator` fallback to `getGlobalToolProvider()`
- `PromptProvider` defaulting to global tool and skill registries

This is different from an import cycle. The issue here is source-of-truth ambiguity, not only graph shape.

### Worker-seam boundary violations

Current risk area:

- The execution path still allows app-layer construction to reach directly into runtime-local tool worker composition.

This is not yet a behavioral seam break, but it is the code-shape most likely to erode the established local-authoritative `ToolWorker` and `ConversationWorker` lines if future cleanup is done carelessly.

## Single highest-value first cleanup target

The single highest-value first target is the execution/runtime ownership knot centered on:

- `src/runtime/execution-boundary/local-execution-adapter.ts`
- `src/app/lifecycle/execution/execution-service.ts`
- `src/autonomy/react-integration.ts`

Why this should be first:

1. It is the cross-layer knot that sits directly on the scheduler-to-runtime execution seam.
2. It mixes boundary ownership with construction ownership in the most sensitive part of the runtime.
3. It is the knot most likely to threaten established `ReActIntegration` continuation ownership and `ToolWorker` seam invariants if left to accrete further.
4. It can be reduced incrementally without touching gateway behavior, IPC, worker behavior, or durable ownership.

The smaller deterministic-runtime/persistence cycle is cleaner to describe, but it is not the highest-value first cut.

## Safest first cycle-break model

Recommended first boundary:

- introduce or tighten one narrow runtime-facing execution runner boundary between `LocalExecutionAdapter` and the app execution implementation

Practical model:

- `LocalExecutionAdapter` should depend on a small runtime-owned interface that means “execute this work item locally and return an execution result”.
- That interface should carry only the behavior the runtime boundary actually needs.
- `ExecutionService` can continue to implement the underlying behavior, but `runtime/execution-boundary` should stop importing app-stage contracts directly.

What should be extracted:

- the minimal interface currently represented by `IExecutionService` usage inside `LocalExecutionAdapter`
- only the runtime-facing execution method shape and any directly required result type aliases

What should stay in place for now:

- `ExecutionService` can remain the concrete implementation
- `ReActIntegration` remains the continuation owner
- `LocalToolWorker` remains the local-authoritative tool dispatch seam
- scheduler direct/evented behavior remains exactly as-is
- current worker/event publication logic remains exactly as-is

What should not be touched yet:

- no redesign of `ReActIntegration`
- no change to `ToolWorker` request-registry ownership
- no attempt to move prompt/tooling composition wholesale out of `ExecutionService` yet
- no scheduler event protocol rewrite
- no runtime/global cleanup sweep across conversation and prompts yet

Why this is the safest first break:

- It removes the most important reverse dependency first.
- It shrinks the execution/runtime SCC without reopening the stabilized worker seams.
- It keeps the composition root mostly where it is, which reduces behavioral risk.

## Invariants that must remain preserved

Any `RF-033` follow-up must preserve all of the following:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` local-authoritative seam invariants
- `ConversationWorker` local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- outer transport ownership lines
- durable ownership lines

In practical terms, that means:

- the scheduler still owns run creation, replay gating, and result continuation policy
- `ReActIntegration` still awaits one authoritative local tool outcome and owns post-tool continuation
- workers remain local execution seams, not new orchestration owners
- gateway and IPC remain outside the first cleanup

## What import-cycle cleanup should not do first

The codebase findings here argue against the following premature directions:

- repo-wide layering rewrite
  - The current problems are concentrated in a few specific SCCs and constructor knots, not a uniform repo-wide failure.
- broad module moves or renames
  - The highest-value first break is a narrow dependency-direction fix, not a physical package reshuffle.
- broad container / IoC introduction
  - The current risk is not “lack of DI”; it is that a few seams still mix ownership and composition. An IoC sweep would add surface area without isolating the highest-value knot first.
- worker seam redesign
  - The `ToolWorker` and `ConversationWorker` lines are explicitly stabilized and should not be reopened under an import-cleanup banner.
- transport ownership changes
  - The current top findings are inside runtime/app/infra composition, not in gateway or IPC ownership.
- broad runtime tooling-context expansion
  - The conversation/tooling/prompt knot is real, but pushing a bigger runtime-tooling redesign first would broaden scope and risk the stabilized worker seams.

## Ordered roadmap for RF-033

### Phase 1

Break the execution/runtime back-edge by introducing the narrow runtime-facing execution runner boundary used by `LocalExecutionAdapter`.

### Phase 2

Reduce the scheduler/runtime event coupling by narrowing `SchedulerEventAdapter` to a smaller event-source contract rather than importing the broader scheduler core surface.

### Phase 3

Clean the smaller true import cycles and localized dependency-direction smells:

- deterministic-runtime event store vs persistence interface
- infra conversation repository contracts that depend on app interfaces

### Phase 4

Only after the earlier phases are stable, revisit the broader conversation/tooling/prompt/global-fallback knot with a dedicated narrow design pass.

## Recommended Session 60

Session 60 should be one narrow coding session that extracts the runtime-facing execution runner boundary used by `LocalExecutionAdapter` and rewires that adapter away from direct `app/lifecycle` contract imports.

Rationale:

- It is the smallest code change that breaks the highest-value reverse dependency.
- It preserves scheduler-owned execution semantics, `ReActIntegration` continuation ownership, and the current local `ToolWorker` seam.
- It improves dependency direction immediately without forcing a worker redesign or a broader runtime-tooling move.

## Summary

The codebase’s most important current `RF-033` problem is not a giant set of literal file import loops. It is a mixed execution/runtime package SCC and composition knot where the scheduler-facing execution boundary, app execution implementation, and local runtime tool machinery still lean into each other too directly.

The safest first cleanup is therefore to tighten the runtime-facing execution boundary first, not to start with a repo-wide layering rewrite or a broad prompt/tooling cleanup.
