# Session 95: Cross-Runtime Source-of-Truth Review

## Summary

This session starts a new refactor line: cross-runtime source-of-truth rationalization.

It is a bounded discovery/review session only. No runtime code changed.

The highest-value current source-of-truth problem is the split authority for effective model-selection state across runtime config, agent config, scheduler selection, persisted goal/work-item/run context, and TUI runtime state.

This is not a reopening of `RF-034`, `RF-059`, `RF-060`, or `RF-061`. Those blocks were reviewed only to confirm that the remaining pressure is now elsewhere.

## Scope and session guardrails

This session does not:

- reopen `RF-034`
- reopen `RF-059`
- reopen `RF-060`
- reopen `RF-061`
- treat remaining `GatewayServer` steady-state ownership or thin delegations as unfinished `RF-061`
- redesign daemon detach/unsubscribe capability
- perform broad package/module-boundary redesign
- perform broad singleton/service-locator cleanup unless a concrete source-of-truth issue directly requires it
- alter startup semantics
- alter scheduler semantics
- alter gateway/daemon IPC behavior
- alter tool/provider execution semantics
- alter admin/runtime RPC behavior
- perform broad renames or file moves

## Method used

This review is based on targeted source inspection of current runtime-relevant state holders, including:

- runtime config and runtime RPC exposure
- provider/model resolution and legacy LLM compatibility surfaces
- scheduler-side model selection and persisted run metadata
- conversation/session-side preferred-model logic
- gateway/TUI model selection and persistence flow

Primary files reviewed:

- `src/infra/config/runtime-config.ts`
- `src/infra/llm/provider-manager/config-loader.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/infra/llm/llm-service.ts`
- `src/infra/llm/provider-factory.ts`
- `src/infra/llm/endpoints/endpoint-registry.ts`
- `src/scheduler/model-selector/model-selector.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `src/app/conversation/session-manager.ts`
- `src/scheduler/core/scheduler.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/cli/tui/app.tsx`
- `src/cli/tui/components/modals/goal-create-modal.tsx`

## Current findings by category

### 1. True authoritative-state duplication

Fact involved:

- configured model/provider/endpoint defaults and fallback order

Current holders:

- `llm-config` and provider-manager config are one real authority surface in `src/infra/llm/provider-manager/config-loader.ts`
- legacy static provider/model/endpoint defaults still exist in:
  - `src/infra/llm/llm-service.ts`
  - `src/infra/llm/provider-factory.ts`
  - `src/infra/llm/endpoints/endpoint-registry.ts`
  - `src/scheduler/model-selector/model-tier-config.ts`

Observed duplication:

- `LLMService` still hardcodes default tier models and environment override loading (`src/infra/llm/llm-service.ts`)
- legacy provider metadata still defines supported models and default models (`src/infra/llm/provider-factory.ts`)
- endpoint registry still hardcodes endpoint defaults and priorities (`src/infra/llm/endpoints/endpoint-registry.ts`)
- scheduler model selection still mixes old tier defaults with `llm-config` tier data (`src/scheduler/model-selector/model-selector.ts`)

Judgment:

- This is real duplication, not just a harmless compatibility export layer.
- The same runtime-relevant fact is still encoded in more than one place.

### 2. Mirror-vs-source ambiguity

Fact involved:

- selected model for the current operator/agent flow

Current holders:

- runtime override state via `runtime.agent.modelOverrides`
- TUI local `selectedModel`
- persisted `selected_model` / `model` fields on goal and work-item context
- run event payloads carrying `selected_model` and `actual_model`

Observed ambiguity:

- the TUI initially loads `selectedModel` from `system.agent.model_override.get` (`src/cli/tui/app.tsx`)
- that same TUI state is then overwritten from `run.started` and `run.completed` events (`src/cli/tui/app.tsx`)
- the overwritten TUI state is later used as input when creating a goal (`src/cli/tui/components/modals/goal-create-modal.tsx`)

Judgment:

- the TUI state is behaving partly like a mirror of runtime selection and partly like a future-write source
- that makes it unclear whether the authoritative fact is "current agent override", "last executed run model", or "next requested goal model"

### 3. Multi-writer smell

Fact involved:

- requested model attached to work entering execution

Current writers:

- conversation bootstrap writes `selected_model` onto goal context and both `selected_model` and `model` onto work-item context (`src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`)
- gateway goal submission writes `model` into the initial work-item context from goal `selected_model` (`src/gateway/rpc/handlers/goal-handlers.ts`)
- scheduler writes `selected_model` and `model_source` into run context (`src/scheduler/core/scheduler.ts`)
- runtime override update APIs write `runtime.agent.modelOverrides` (`src/gateway/rpc/handlers/system-handlers.ts` plus `src/scheduler-daemon/daemon.ts`)

Judgment:

- these are not all writing the same field on the same record, but they are competing writers for the same business fact: "what model should this work use"
- the write order is implicit rather than bounded behind one authority boundary

### 4. Derived-state drift risk

Fact involved:

- effective preferred model for conversation/session activity versus scheduled work

Observed drift:

- `WorkloadModelResolver` resolves workload model from runtime override, agent config hint, then `llm-config` tier (`src/infra/llm/provider-manager/agent-model-resolver.ts`)
- conversation bootstrap uses a separate local resolver that reads runtime override and then agent `model_hint` from `agent.json` (`src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`)
- session memory preference only reads runtime override and ignores agent config hint and persisted work context (`src/app/conversation/session-manager.ts`)
- scheduler work-item execution chooses among persisted goal/work-item metadata first, then falls back to scheduler selection (`src/scheduler/core/scheduler.ts`)

Judgment:

- this is derived-state drift risk, not yet confirmed behavioral breakage
- but the same runtime can presently answer "what model is in effect" differently depending on whether the caller is conversation memory, conversation bootstrap, scheduler selection, or TUI UI state

### 5. Transport projection vs authoritative state

Fact involved:

- admin-visible model override state and runtime config flags

Observed shape:

- gateway `system.*` handlers expose model-override and runtime-config access over RPC (`src/gateway/rpc/handlers/system-handlers.ts`)
- gateway runtime RPC surface forwards those calls over IPC when a daemon is attached, or falls back to local runtime config reads otherwise (`src/gateway/runtime/gateway-runtime-rpc-surface.ts`)

Judgment:

- these are transport/control-plane projections and should stay that way
- they should not become the semantic owner of effective model resolution
- the actual source of truth should remain below transport, in runtime config plus one explicit resolution boundary

### 6. Compatibility surface acting as real source of truth

Fact involved:

- live provider/model support metadata

Observed shape:

- `LLMService` still exposes and loads its own tier-model defaults (`src/infra/llm/llm-service.ts`)
- legacy `PROVIDER_METADATA` still describes supported models and default models (`src/infra/llm/provider-factory.ts`)
- legacy endpoint registry still describes live endpoint defaults and priority (`src/infra/llm/endpoints/endpoint-registry.ts`)

Judgment:

- those compatibility surfaces are not purely compatibility-only yet
- they still participate in live resolution decisions and availability reasoning

## Single highest-value first target

The single highest-value first target in this new refactor line is:

- effective model-selection authority rationalization

More specifically, the fact/state is:

- the effective requested model for a given workload/agent/work item before execution begins

### Who should be authoritative owner

The authoritative owner should be one provider-manager-backed resolution boundary that derives effective model choice from:

1. `runtime.agent.modelOverrides`
2. agent runner-config hint (`runner.config.model` / `model_hint`)
3. `llm-config` workload/tier defaults

### Who should become read-only mirror / projection / derived consumer

These should become mirrors, projections, or derived consumers only:

- TUI `selectedModel` state
- gateway/system RPC responses for model override reads
- persisted `selected_model` / `model` metadata on goal, work item, and run records
- run event payloads carrying `selected_model` / `actual_model`
- session-level preferred-model readers used for memory or display

### What current ambiguity or duplication exists

- there are multiple live read paths for effective model choice
- there are multiple write points that materialize model choice into persisted metadata
- the UI state is fed from both override authority and execution-result events
- legacy compatibility surfaces still encode live model/provider defaults

### Why it matters now

This is the best first target now because it has:

- high structural gain across gateway, daemon, scheduler, conversation, and UI paths
- lower semantic risk than broader provider execution or package-boundary redesign
- direct relevance to cross-runtime source-of-truth ownership
- no need to reopen closed `GatewayServer` composition or transport blocks

The remaining `GatewayServer` surfaces after `RF-061` are acceptable runtime ownership. This model-selection problem is the clearer current source-of-truth debt.

## Safest first cleanup model

Recommended first cleanup model:

- introduce one narrow effective-model-resolution boundary and make it the only intended read path for "what model should this work use before execution"

### Boundary to introduce, tighten, or document

Introduce or explicitly document a boundary shaped like:

- input: workload or agent identity, optional user-requested model, optional persisted requested-model hint
- output: resolved model plus provenance/source classification

That boundary should sit below gateway/TUI transport surfaces and above provider execution details.

### What should be extracted vs left in place

Extract or consolidate:

- the duplicated read logic now split across:
  - `WorkloadModelResolver`
  - conversation bootstrap model-hint resolution
  - session preferred-model lookup
  - scheduler pre-execution choice assembly

Leave in place for the first cleanup:

- current persisted metadata fields (`selected_model`, `model`, `actual_model`, `model_source`)
- current RPC methods for set/get override
- current run event payload shapes
- current provider execution path and endpoint probing order
- current replay/run persistence semantics

### What should remain as compatibility mirror only

For the first cleanup, the following should be treated as compatibility or projection-only surfaces:

- TUI `selectedModel`
- gateway/system model override read APIs
- run event `selected_model` / `actual_model` payloads
- legacy `LLMService` tier defaults and older provider metadata, unless a consumer still requires them directly

### What should not be touched yet

Do not touch yet:

- daemon detach/unsubscribe design
- startup/bootstrap composition
- scheduler rollout and deterministic-runtime flags
- tool routing or provider execution behavior
- admin/runtime RPC method shapes
- broad provider-manager versus legacy LLM package redesign
- broad singleton elimination across the repo

## What is explicitly not the next target

The next target is not:

- any `RF-034` follow-up work
- any `RF-059` follow-up work
- any `RF-060` follow-up work
- any `RF-061` follow-up work
- daemon detach/unsubscribe capability design
- broad package/module-boundary redesign
- broad singleton/service-locator cleanup unless a concrete model-selection source-of-truth issue directly requires a local change
- repo-wide config-flag unification
- provider execution/path-selection redesign

## Recommended Session 96

Recommended Session 96:

- implement the first effective-model-resolution boundary and rewire only the highest-value read paths to it

Brief rationale:

- this is the smallest coding step that converts the current model-selection problem from implicit multi-owner behavior into one documented authority path
- it can be done without changing runtime semantics by preserving current precedence and keeping persisted metadata as compatibility mirrors
- it does not require transport changes, startup changes, or reopening any closed refactor block

## What this new refactor line should not do next

Tempting but premature directions:

- replacing all legacy LLM/provider modules in one sweep
- eliminating every global or singleton around LLM, tool, prompt, or config access
- redesigning model/provider endpoint fallback semantics
- collapsing every persisted model-related field into one schema change immediately
- turning TUI state cleanup into a full UI architecture rewrite
- broad agent-config file reshaping or repository-wide naming cleanup

## Short practical roadmap

### Phase 1

- establish one effective-model-resolution authority boundary
- preserve current precedence and semantics
- demote UI/runtime/persisted surfaces to explicit mirrors or projections

### Phase 2

- tighten write rules for persisted model metadata so writes are clearly projection writes, not hidden authority writes
- reduce duplicate conversation/scheduler/session read logic

### Phase 3

- reassess which legacy LLM compatibility surfaces still act as live authority after Phase 1 and Phase 2
- only then decide whether a further bounded provider/endpoint source-of-truth cleanup is justified

## Validation summary

Validation for this session was documentation/review only:

- targeted source review of the files listed above
- targeted runtime-state and model-selection usage scans across `src/`
- no runtime code changed

Files changed in this session:

- `docs/refactoring/session95-cross-runtime-source-of-truth-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`

No other files should change in this session.
