# Session 96: Effective Model Resolution Boundary

## Summary

Session 96 begins the first coding session in the cross-runtime source-of-truth rationalization line.

This session stayed tightly scoped to the highest-value first target identified in Session 95:

- effective model-selection authority rationalization

It did not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`, and it did not change startup, scheduler, IPC, provider execution, admin/runtime RPC, or persisted schema semantics.

## Authority boundary added

This session introduced:

- `src/infra/llm/provider-manager/effective-model-resolution.ts`

That module now defines the explicit authority read path for effective pre-execution model selection.

Its precedence remains:

1. `runtime.agent.modelOverrides`
2. agent runner-config hint (`runner.config.model` / `model_hint`)
3. workload/tier default from `llm-config`

The boundary returns:

- resolved model
- provenance/source classification
- tier when available

Current source classifications are:

- `runtime_override`
- `agent_runner_hint`
- `llm_config_tier`

The module is explicitly documented in code as the intended authority path. Transport/UI/persistence surfaces remain compatibility projections or mirrors.

## Callers rewired in this session

### 1. Provider-manager workload resolution

`src/infra/llm/provider-manager/agent-model-resolver.ts` now delegates its authoritative workload read path to the new boundary via:

- `resolveEffectiveModelForWorkload(workloadId)`

`getModelForWorkload()` now reads through that method instead of re-implementing the precedence inline.

This preserved the existing workload-resolution behavior while exposing explicit provenance for callers/tests.

### 2. Conversation bootstrap model resolution

`src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts` now resolves conversation-created goal/work-item model materialization through the new boundary.

The bridge still writes the same compatibility fields:

- `selected_model`
- `model`

It still writes them only when a runtime override or agent hint resolves, preserving the prior behavior that conversation bootstrap does not invent a new persisted selection from `llm-config` defaults.

### 3. Scheduler pre-execution default-leg assembly

`src/scheduler/core/scheduler.ts` now routes the non-persisted default leg of pre-execution model assembly through a single helper that calls the new boundary.

Important preserved behavior:

- persisted compatibility fields still win first:
  - work-item `context.model`
  - goal `context.selected_model`
- scheduler still persists and emits the same compatibility metadata:
  - `selected_model`
  - `model_source`
- existing `model_source` values remain unchanged:
  - `tui_selected`
  - `scheduler_selector`

This means Session 96 centralized the read path shape without changing current scheduler-facing semantics.

## Semantics intentionally preserved

This session intentionally preserved:

- runtime override precedence over agent hint and tier default
- agent hint precedence over `llm-config` tier primary
- existing provider-manager fallback-chain behavior
- existing conversation bootstrap write behavior for `selected_model` / `model`
- existing scheduler precedence of persisted compatibility-selected model over selector default
- existing run context field names and run-event payload shapes
- existing RPC method shapes
- existing provider execution/fallback behavior

## Remaining duplication after Session 96

The following duplication or mirror-vs-authority ambiguity still remains:

- `SessionManager.resolvePreferredModelForSession()` still reads runtime override directly and does not yet align to the new authority boundary
- scheduler default-leg resolution does not yet feed runtime override or agent runner hint into the authority boundary; it only centralizes the existing selector-derived default leg
- TUI `selectedModel` state still behaves as a transport/UI mirror fed by override reads and run events
- persisted `selected_model` / `model` / `actual_model` / `model_source` remain compatibility materializations rather than a fully normalized projection layer

## Why those items were left out of scope

They were left out intentionally because pulling them into Session 96 would have risked semantic drift or scope growth:

- aligning session preferred-model reads could change conversation memory/display behavior
- feeding scheduler execution directly from runtime override or agent hint would be a behavioral change in paths that currently rely on persisted compatibility fields plus selector output
- changing TUI mirror behavior or persisted model materialization would broaden the session into UI/projection cleanup instead of the first bounded authority extraction

Session 96 therefore stops after introducing the authority boundary and rewiring the highest-value callers that could safely adopt it without changing runtime semantics.

## Validation

Focused validation performed:

- `npx jest test/infra/llm/provider-manager/provider-manager.test.ts test/scheduler-daemon/session-intake.test.ts test/scheduler/core/scheduler.test.ts`
- `npx tsc -p tsconfig.json --noEmit --pretty false`

Validation specifically covered:

- authoritative workload resolution provenance and precedence
- conversation bootstrap propagation of resolved model into compatibility fields
- scheduler preservation of `selected_model` / `model_source` startup shapes
- repository-wide TypeScript compile validity after the new boundary and caller rewires
