# Session 98: Model Metadata Projection Hygiene

## Summary

Session 98 continued the cross-runtime source-of-truth rationalization line from Sessions 95-97.

This session stayed on the projection side only:

- add one narrow compatibility model-metadata projection/materialization boundary
- rewire a bounded caller cluster to use it
- preserve existing payload names, persisted field names, omissions, and runtime behavior

It did not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`, and it did not change startup, scheduler semantics, gateway/daemon IPC, provider execution/fallback behavior, admin/runtime RPC behavior, TUI `selectedModel`, or persistence schemas.

## Projection/materialization boundary added

Session 98 added:

- `src/infra/llm/provider-manager/model-selection-compatibility.ts`

That module is intentionally projection-only. It does **not** resolve effective model authority or introduce new precedence rules.

Instead, it materializes compatibility/output fields after authority-side resolution has already happened elsewhere:

- `selected_model`
- `model`
- `actual_model`
- `model_source`

The helper is split into two narrow projection shapes:

1. `materializeCompatibilitySelectedModelProjection(...)`
   - for compatibility mirrors built from an already-selected model
   - materializes `selected_model`, `model`, and optional `model_source`

2. `materializeCompatibilityRunModelProjection(...)`
   - for run completion/event compatibility metadata
   - materializes `selected_model`, `actual_model`, and optional `model_source`

The naming and comments explicitly distinguish authority resolution from compatibility projection so this module cannot be mistaken for the source-of-truth boundary introduced in Session 96.

## Callers rewired

The session rewired a bounded high-value caller cluster:

- `src/scheduler/core/scheduler.ts`
  - run creation context materialization
  - normal `run_started` event payload materialization
  - run completion persistence materialization
  - `run_completed` event payload materialization
- `src/runtime/execution-boundary/local-execution-run-completion-finalizer.ts`
  - direct execution run completion context materialization for `selected_model` / `actual_model`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
  - conversation-created goal/work-item compatibility `selected_model` / `model` materialization
- `src/gateway/rpc/handlers/goal-handlers.ts`
  - remote `goal.submit` initial-work-item compatibility `model` mirror from `selected_model`

This keeps the change small while removing duplicated field assembly across the highest-value current materializer/emitter surfaces nearest the authority boundary.

## Compatibility semantics intentionally preserved

This session intentionally preserved:

- existing field names:
  - `selected_model`
  - `model`
  - `actual_model`
  - `model_source`
- existing `model_source` meaning as compatibility metadata, including its current imperfect provenance semantics
- existing omission/undefined behavior for compatibility fields
- existing run event payload shapes
- existing RPC payload shapes
- existing persisted schema field names
- existing provider execution and fallback behavior
- existing startup and scheduler behavior

In particular:

- the helper only materializes compatibility fields from already-resolved inputs
- `SchedulerCore.resolveProjectedExecutionModel(...)` still decides the selected model and compatibility source exactly as before
- Session 96 authority ownership remains in `resolveEffectiveModelSelection(...)`, not in the new helper

## Remaining duplication after Session 98

Projection duplication still remains and was intentionally left for later sessions:

- replay-path `run_started` payload assembly in `src/scheduler/core/scheduler.ts`
- direct execution-service run creation of `selected_model` / `requested_model` before cycle execution
- other transport/runtime consumers that read projected event fields rather than materializing them
- broader persistence-facing compatibility fields outside the bounded caller cluster
- TUI `selectedModel` UI/transport mirroring

Those were left untouched to keep this as the first bounded projection-hygiene step rather than a broader compatibility-surface redesign.

## Why TUI and broader persistence cleanup stayed out of scope

TUI `selectedModel` remains a UI/transport mirror, not an authority owner.

Pulling it into this session would have broadened the work from compatibility projection hygiene into UI state semantics, which the current refactor line explicitly avoids.

Likewise, broader persistence cleanup stayed out of scope because this session’s goal was to add the first narrow projection/materialization boundary, not to redesign persistence schemas or normalize every compatibility field writer in one pass.

## Validation

Focused validation performed:

- `npx jest test/infra/llm/provider-manager/model-selection-compatibility.test.ts test/runtime/execution-boundary/local-execution-run-completion-finalizer.test.ts test/gateway/rpc/goal-handlers.test.ts test/scheduler-daemon/session-intake.test.ts test/scheduler/core/scheduler.test.ts test/app/lifecycle/execution/execution-service.test.ts --runInBand`
- `npx tsc -p tsconfig.json --noEmit --pretty false`

Validation covered:

- the new compatibility projection helper output shapes
- preservation of run completion payload field names and values on the direct execution path
- preservation of scheduler run creation and `run_started` / `run_completed` compatibility fields
- preservation of conversation-created goal/work-item `selected_model` / `model` materialization
- preservation of remote `goal.submit` `selected_model` -> `model` compatibility mirroring
- repository-wide TypeScript compile validity after the bounded projection cleanup
