# Session 97: Session Preferred-Model Alignment

## Summary

Session 97 continued the cross-runtime source-of-truth rationalization line started in Session 95 and narrowed in Session 96.

This session stayed tightly scoped to one follow-up:

- align session-level preferred-model reads to the effective model authority boundary introduced in Session 96

It did not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`, and it did not change startup, scheduler, gateway/daemon IPC, provider execution/fallback behavior, admin/runtime RPC, TUI state handling, or persisted compatibility metadata.

## Session-level path aligned

The session-level preferred-model read path in:

- `src/app/conversation/session-manager.ts`

now consumes the Session 96 authority helper:

- `resolveEffectiveModelSelection(...)`

`SessionManager.resolvePreferredModelForSession()` remains a `string | undefined` compatibility surface, but it now delegates through a small internal helper that reads:

1. runtime override for the active session agent
2. agent runner hint (`runner.config.model` / `model_hint`)

instead of re-reading runtime overrides directly as a parallel source of truth.

## Callers now reading through the authority boundary

The immediate session-level callers remain the same, but they now read through the authority boundary via `SessionManager.resolvePreferredModelForSession()`:

- input analysis in `processMessageInternal(...)`
- conversational response generation in `processMessageInternal(...)`
- executing-state confirmation generation in `handleExecuting(...)`
- monitoring/progress narration in `handleMonitoring(...)`
- memory indexing in `indexTurnSafely(...)`

This keeps the call-site surface stable while removing the previous direct runtime-only read path.

## Semantics intentionally preserved

This session intentionally preserved:

- `string | undefined` return shape for session preferred-model reads
- runtime override precedence over agent runner hint
- existing conversation/display/memory behavior when no explicit session-level model is present
- existing TUI `selectedModel` behavior as a UI/transport mirror
- existing persisted compatibility projections:
  - `selected_model`
  - `model`
  - `actual_model`
  - `model_source`
- existing run-event, RPC, and session-facing payload shapes
- existing provider execution and fallback behavior

## Why tier defaults, TUI cleanup, and projection cleanup stayed out of scope

Session-level preferred-model reads were aligned to the authority boundary as consumers, but this session intentionally did **not** feed `llm-config` tier defaults into `SessionManager`.

That omission was deliberate:

- injecting tier defaults here would change current conversation/memory/display semantics from "explicit session model only" to "always materialized effective model"
- changing TUI `selectedModel` handling would broaden this session into UI/transport cleanup
- changing persisted compatibility fields would broaden this session into projection/materialization cleanup

Those areas remain follow-up work for later sessions in the same rationalization line.

## Remaining ambiguity after Session 97

The following ambiguity still remains after this session:

- session-level preferred-model reads now share the authority helper, but they still intentionally expose only the compatibility `string | undefined` view rather than provenance/source metadata
- TUI `selectedModel` remains a mirror of transport/runtime state rather than a normalized authority consumer
- persisted `selected_model` / `model` / `actual_model` / `model_source` fields remain compatibility projections rather than a normalized projection layer
- broader repo-wide direct reads of model-related compatibility state were intentionally not touched

## Validation

Focused validation performed:

- `npx jest test/app/conversation/session-manager.preferred-model-alignment.test.ts test/app/conversation/session-manager.lifecycle.test.ts test/app/conversation/session-manager.memory-scope.test.ts --verbose`
- `npx tsc -p tsconfig.json --noEmit --pretty false`

Validation specifically covered:

- session-level runtime override precedence over agent runner hints
- session-level fallback to agent runner hints when no runtime override is present
- preservation of `undefined` preferred-model behavior when neither override nor hint exists
- unchanged session-facing response shape on the affected conversation path
- repository-wide TypeScript compile validity after the bounded session-level alignment
