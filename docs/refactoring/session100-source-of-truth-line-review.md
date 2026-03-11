# Session 100: Cross-Runtime Source-of-Truth Line Review

## Summary

Session 100 is a review/documentation-only session for the cross-runtime source-of-truth rationalization line started in Session 95 and advanced in Sessions 96-99.

This session used the current codebase plus the completed Session 95-99 outputs to decide whether one more high-value, semantics-preserving, tightly bounded cleanup remains inside this line, or whether the line should now pause and yield priority to a different major refactor block.

Conclusion:

- the line has delivered real structural value
- one more tiny cleanup is technically possible
- but no remaining target is still strong enough to justify keeping this line as the first-priority refactor theme
- this line should pause here as structurally valuable but now at diminishing returns

Recommended Session 101:

- start a bounded review/design session for broader runtime-core singleton / service-locator cleanup

This session did not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`, did not redesign daemon detach/unsubscribe capability, did not broaden into package/module-boundary redesign, and did not change runtime, startup, scheduler, IPC, provider, RPC, TUI, or persistence semantics.

## What Sessions 95-99 already achieved

### 1. Authority read-path rationalization

Session 96 introduced:

- `src/infra/llm/provider-manager/effective-model-resolution.ts`

That module is now the explicit authority read path for:

1. runtime override
2. agent runner hint
3. `llm-config` tier default

Current consumers include:

- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- the scheduler default-leg read in `src/scheduler/core/scheduler.ts`

This removed the highest-value live duplication in effective model-selection reads without changing selection semantics.

### 2. Session-level preferred-model read alignment

Session 97 aligned:

- `src/app/conversation/session-manager.ts`

`SessionManager.resolvePreferredModelForSession()` now consumes the shared authority helper instead of reading runtime overrides as a parallel source of truth.

This was a meaningful cleanup because conversation analysis/response/memory paths now read through the same authority boundary while preserving the existing `string | undefined` compatibility shape.

### 3. Compatibility projection/materialization introduction

Session 98 introduced:

- `src/infra/llm/provider-manager/model-selection-compatibility.ts`

That boundary now owns the main compatibility materialization shapes for:

- `selected_model`
- `model`
- `actual_model`
- `model_source`

and is already used by:

- `src/scheduler/core/scheduler.ts`
- `src/runtime/execution-boundary/local-execution-run-completion-finalizer.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`

This separated authority resolution from compatibility projection, which was the right structural split for this line.

### 4. Replay/direct-execution projection alignment

Session 99 extended the same compatibility boundary to the next bounded caller cluster:

- replay-path `run_started` projection in `src/scheduler/core/scheduler.ts`
- direct execution run creation projection in `src/app/lifecycle/execution/execution-service.ts`

That materially reduced remaining duplication nearest the authority boundary without changing replay, direct-execution, or payload semantics.

## Current codebase state after Session 99

The highest-value parts of the line are now in place:

- authority reads are centralized in `effective-model-resolution.ts`
- session-level preferred-model reads no longer form a parallel authority path
- most nearby compatibility materializers now pass through `model-selection-compatibility.ts`
- scheduler replay and direct-execution startup materialization no longer duplicate that logic locally

What remains is narrower and farther from the original source-of-truth problem:

- UI/transport mirroring
- transport/event compatibility forwarding
- persistence-facing legacy field duplication that still exists because the schema and public payloads intentionally still expose multiple compatibility echoes

That is the key Session 100 finding: the line solved the important ownership and projection-boundary problems first, and the remaining debt is now mostly compatibility residue rather than primary authority ambiguity.

## Plausible remaining targets that actually still exist

### Target A: TUI `selectedModel` mirror still over-signals authority

Current live behavior:

- `src/cli/tui/app.tsx` loads `selectedModel` from `system.agent.model_override.get(...)` when the active agent changes
- that same state is later overwritten from `run.started.selectedModel`
- and then overwritten again from `run.completed.actualModel`
- `src/cli/tui/components/modals/goal-create-modal.tsx` uses `state.selectedModel` to write goal `context.selected_model` and `model_source: 'tui_selected'`

This means one TUI field still conflates:

- current runtime override for the active agent
- compatibility mirror of last run selection
- compatibility mirror of last actual execution model
- next goal’s requested model input

This is the clearest remaining mirror-vs-source ambiguity in the current codebase.

### Target B: Transport/runtime mirror ambiguity nearest the authority boundary

Current live behavior:

- `src/gateway/integration/scheduler-bridge.ts`
- `src/gateway/integration/ipc-bridge.ts`

still forward `event.data.selected_model` and `event.data.actual_model` directly into transport event payloads as `selectedModel` / `actualModel`.

This is still a mirror-only surface, but it sits close to the authority/projection line because the TUI then consumes those fields directly as if they can safely drive user-visible selected-model state.

### Target C: Broader persistence-facing compatibility duplication

Current live behavior:

- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts` still persists both `selected_model` and `model`
- `src/gateway/rpc/handlers/goal-handlers.ts` still mirrors `selected_model` into initial work-item `model`
- `src/app/lifecycle/execution/execution-service.ts` still persists `selected_model` and `requested_model`
- `src/runtime/execution-boundary/local-execution-run-completion-finalizer.ts` still persists `selected_model`, `requested_model`, and `actual_model`
- `src/scheduler/core/scheduler.ts` still persists `selected_model` and `model_source`

Most of these are now routed through shared helpers, but the underlying compatibility fields still intentionally duplicate related model-selection facts across goal/work-item/run contexts.

### Target D: Any still-live multi-writer ambiguity around model-selection state

There is still some multi-writer smell, but it is now materially weaker than in Session 95.

The current writers are mostly compatibility materializers rather than competing authority owners:

- conversation bootstrap writes compatibility mirrors before scheduling
- goal submission mirrors `selected_model` into work-item `model`
- scheduler materializes run-facing compatibility metadata
- execution finalization materializes completion-facing compatibility metadata
- runtime override RPC still writes the actual authority input in runtime config

This matters because most remaining writes are no longer choosing the effective model; they are echoing an already-chosen model into compatibility surfaces.

## Evaluation of remaining targets

### A. TUI `selectedModel` mirror cleanup

Structural gain:

- medium
- it would remove the single clearest remaining mirror-vs-source ambiguity visible in one place

Semantic risk:

- medium to high
- the same field currently drives header display, slash-command modal state, persisted goal submission context, and reactive updates from run events
- separating “override/request input” from “last run mirror” would start changing user-visible TUI semantics even if field names stayed stable

Scope tightness:

- only superficially tight
- the code footprint is small, but the meaning of the state is not

Still inside ownership/composition/wiring/boundary cleanup?

- only partially
- the problem begins as a source-of-truth issue, but quickly becomes UI state semantics

Drift risk:

- high risk of drifting into TUI behavior redesign

Judgment:

- real issue, but not the right next bounded cleanup for this line

### B. Transport/runtime mirror cleanup closest to the authority boundary

Structural gain:

- low to medium
- event adapters would become more explicit mirrors, but they are already thin and local

Semantic risk:

- medium
- any attempt to stop forwarding or reinterpret these fields would affect gateway/TUI event behavior

Scope tightness:

- tight in code footprint
- weak in payoff

Still inside ownership/composition/wiring/boundary cleanup?

- yes, but only marginally

Drift risk:

- likely to drift into payload or UI-consumer semantics rather than true ownership cleanup

Judgment:

- too low-yield to justify keeping the line active

### C. Broader persistence-facing compatibility projection duplication

Structural gain:

- low
- Session 98 and Session 99 already extracted the shared projection boundary for the highest-value nearby writers

Semantic risk:

- medium
- the remaining duplication is tied to legacy field shapes such as `model`, `requested_model`, and completion metadata

Scope tightness:

- moderate
- but the closer this goes toward “finishing” persistence cleanup, the more it risks schema-semantics debate without a schema change

Still inside ownership/composition/wiring/boundary cleanup?

- yes at the boundary/projection level
- but only weakly now

Drift risk:

- likely to drift into persistence-schema redesign or provenance redesign

Judgment:

- not strong enough to be the next highest-value session

### D. Remaining multi-writer / mirror-vs-source ambiguity around model-selection state

Structural gain:

- low
- the true authority writer is already clearer now: runtime config override plus shared authority resolution

Semantic risk:

- medium to high if pursued aggressively

Scope tightness:

- poor
- this quickly broadens into “what should each compatibility field mean” across UI, scheduler, execution, and persistence

Still inside ownership/composition/wiring/boundary cleanup?

- only at the start

Drift risk:

- high risk of drifting into capability design, payload semantics, or schema redesign

Judgment:

- not a good bounded next session

## Is there still one more high-value bounded step in this line?

Not as a first-priority refactor block.

The only plausible “one more step” is a narrowly bounded TUI-facing source/mirror cleanup around `selectedModel`, because it is still the clearest live ambiguity in the repo.

However, that target fails the more important Session 100 test:

- it is no longer clearly semantics-preserving
- it is no longer clearly just ownership/composition/wiring cleanup
- it is too likely to drift into UI semantics and user-facing behavior design

So the honest answer is:

- yes, there is still one technically plausible cleanup left
- no, it is no longer strong enough to keep this line as the next major priority

## Conclusion

This line should pause here as:

- structurally valuable
- successful in its main bounded goals
- no longer the highest-yield place to spend the next coding session

Why now is the right time to pause:

1. The important authority read-path problem is already solved.
2. The high-value nearby projection duplication is already consolidated.
3. The remaining debt is mostly compatibility residue or UI-facing ambiguity.
4. The next plausible cleanup would no longer be clearly semantics-preserving.

That is the point of diminishing returns for this line.

## Re-ranking against broader next-block candidates

Because this line should pause, the next session should be chosen against the broader pending candidates named in Session 95.

### 1. Broader runtime-core singleton / service-locator cleanup

Recommended next block.

Why it ranks first now:

- it remains live in current code, not just historical theory
- `src/autonomy/react-integration.ts`, `src/app/conversation/response-generator.ts`, and `src/infra/prompts/prompt-provider.ts` still fall back to `getGlobalToolProvider()`
- `src/runtime/execution-boundary/local-execution-adapter.ts`, `src/app/conversation/session-manager.ts`, `src/scheduler-daemon/daemon.ts`, and `src/infra/llm/provider-manager/agent-model-resolver.ts` still read global registries directly
- `src/infra/llm/provider-manager/provider-manager.ts` and adjacent provider-manager/endpoint-manager/model-resolver surfaces still expose singleton-style runtime composition

This is now a better priority because it is still clearly architectural, still codebase-wide enough to matter, and still separate from the closed gateway/bootstrap/runtime-graph blocks.

### 2. Daemon detach/unsubscribe capability design

Not recommended next.

Why it ranks second:

- there is still a real future capability question here
- but the structural transport-boundary work is already complete
- the remaining gap is semantic capability design, not current ownership ambiguity

That makes it less suitable than singleton/service-locator review for the next bounded session.

### 3. Broader package architecture / module-boundary redesign

Not recommended next.

Why it ranks third:

- this is the broadest and riskiest option
- current code does still show global-registry and singleton pressure, but that does not yet justify jumping straight to package/module-boundary redesign
- the codebase would benefit more from another narrow discovery/design pass before any broad module-architecture move

## What should not be done next

- Do not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`.
- Do not treat remaining `GatewayServer` steady-state ownership as unfinished `RF-061`.
- Do not redesign daemon detach or unsubscribe behavior.
- Do not try to “finish” model-selection cleanup by redefining `selected_model`, `model`, `requested_model`, `actual_model`, or `model_source`.
- Do not redesign TUI `selectedModel` semantics inside this line.
- Do not change event payload shapes or existing RPC method shapes.
- Do not start persistence-schema redesign to remove compatibility fields.
- Do not jump directly to broad package/module-boundary surgery.

## Recommended Session 101

Recommend exactly one next session:

- begin a bounded review/design session for broader runtime-core singleton / service-locator cleanup

Practical starting focus:

- inventory the highest-value remaining singleton/service-locator seams still on live runtime paths
- rank the smallest next structural target among:
  - `getGlobalToolProvider()` fallback consumers
  - global agent/runner registry reach-through in execution/conversation paths
  - provider-manager adjacent singleton composition
- choose one bounded implementation target only if the review finds a semantics-preserving first cut

This is the better next move because the current source-of-truth line has already captured its high-value bounded wins, while the remaining singleton/service-locator pressure is still broader, more architectural, and more deserving of first priority.

## Validation

Validation for Session 100 was documentation-only:

- reviewed current source files and Session 95-99 docs
- updated only:
  - `docs/refactoring/session100-source-of-truth-line-review.md`
  - `docs/refactoring/ponybunny_refactor_master_task_list.md`

No runtime code files were changed in this session.
