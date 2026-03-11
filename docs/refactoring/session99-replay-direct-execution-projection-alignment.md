# Session 99: Replay and Direct-Execution Projection Alignment

## Summary

Session 99 continued the cross-runtime source-of-truth rationalization line from Sessions 95-98.

This session remained projection-only and stayed inside the next bounded caller cluster left intentionally behind by Session 98:

- scheduler replay-path `run_started` model metadata projection
- direct execution-service run creation model metadata projection

It did not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`, and it did not change startup behavior, scheduler semantics, replay semantics, direct execution behavior, gateway/daemon IPC behavior, provider execution/fallback behavior, admin/runtime RPC behavior, persistence schemas, or TUI `selectedModel` state.

## Projection paths aligned

Session 99 reused and minimally extended the Session 98 compatibility projection boundary in:

- `src/infra/llm/provider-manager/model-selection-compatibility.ts`

The helper module now covers the bounded replay/direct-execution emitter/materializer cluster through:

1. existing `materializeCompatibilitySelectedModelProjection(...)`
   - reused for replay-path `run_started` `selected_model` projection

2. new `materializeCompatibilityDirectExecutionRunProjection(...)`
   - projection-only helper for direct execution run creation
   - materializes:
     - `selected_model`
     - `requested_model`

The new helper remains deliberately narrow:

- no authority resolution
- no new precedence logic
- no runtime-model selection ownership
- no payload redesign

`requested_model` remains a legacy compatibility echo for the direct request path, so the helper preserves its existing string-or-undefined shape rather than introducing new normalization semantics.

## Callers now using the normalized compatibility boundary

The scoped Session 99 callers now read compatibility model metadata from the shared projection module:

- `src/scheduler/core/scheduler.ts`
  - replay-path `run_started` payload assembly now projects `selected_model` through `materializeCompatibilitySelectedModelProjection(...)`

- `src/app/lifecycle/execution/execution-service.ts`
  - direct execution `repository.createRun(...)` context materialization now projects `selected_model` / `requested_model` through `materializeCompatibilityDirectExecutionRunProjection(...)`

This extends the Session 98 materialization boundary to the next nearest remaining replay/direct-execution emitter cluster without introducing a competing projection path.

## Semantics intentionally preserved

This session intentionally preserved:

- existing field names:
  - `selected_model`
  - `requested_model`
  - `model`
  - `actual_model`
  - `model_source`
- existing replay `run_started` payload shape
- existing direct execution run-context shape
- existing omission/undefined behavior for replay compatibility fields
- existing direct execution behavior, including the current request model passed into cycle execution
- existing persistence field names
- existing event payload field names
- existing RPC/public method shapes

In particular:

- replay `run_started` still emits only `selected_model` plus `replay_of_run_id`
- direct execution run creation still persists only `selected_model` and `requested_model` on the initial run context
- no `model_source` was added to replay payloads
- no `model` / `actual_model` field behavior changed on the affected paths

## Remaining duplication after Session 99

Projection duplication still remains outside this bounded cluster, including:

- broader transport/runtime consumers farther from the authority boundary
- TUI `selectedModel` mirroring
- broader persistence-facing compatibility fields that are not part of replay/direct execution startup materialization

Those paths were intentionally left untouched so this session could stop after aligning the replay/direct-execution emitter/materializer cluster.

## Why TUI and broader transport/persistence cleanup stayed out of scope

TUI `selectedModel` remains a UI/transport mirror rather than an authority owner. Pulling it into this session would have broadened the work from bounded projection hygiene into UI state semantics.

Broader transport and persistence cleanup likewise remained out of scope because Session 99’s goal was to align the next nearest replay/direct-execution projection cluster, not to normalize every remaining compatibility emitter or redesign provenance semantics such as `model_source`.

## Validation

Focused validation performed:

- `npx jest test/infra/llm/provider-manager/model-selection-compatibility.test.ts test/scheduler/core/scheduler.test.ts test/app/lifecycle/execution/execution-service.test.ts --runInBand`
- `npx tsc -p tsconfig.json --noEmit --pretty false`

Validation covered:

- compatibility helper output shapes for selected-model, direct-execution run-context, and run-completion projections
- replay-path `run_started` compatibility field preservation
- direct execution initial run-context `selected_model` / `requested_model` preservation
- repository-wide TypeScript compile validity after the bounded Session 99 projection alignment
