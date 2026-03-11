# Session 103: Runtime-Core Singleton Line Review

## Summary

Session 103 is a bounded review and re-ranking session for the broader runtime-core singleton / service-locator cleanup line after Session 102 completed the first coding phase.

This session reviewed the actual current codebase and the completed Session 101-102 outputs. It did not change runtime behavior, startup behavior, scheduler behavior, gateway/daemon IPC behavior, provider execution/fallback behavior, admin/runtime RPC behavior, event payloads, or TUI behavior.

Conclusion:

- there is not one more clearly high-value, tightly bounded, semantics-preserving coding target left inside this line right now
- this line should pause here and yield priority to a different major refactor block
- Recommended Session 104: begin a bounded daemon detach/unsubscribe capability design session, using the now-explicit gateway detach operation surface as the starting point

That conclusion is about diminishing returns, not about claiming singleton pressure is solved. Current code still contains real singleton/service-locator usage, but the remaining plausible targets now either:

- sit too close to paused source-of-truth work
- drift into startup/bootstrap ownership
- overlap previously closed gateway runtime-wiring work
- or risk broad compatibility/DI churn for relatively modest structural gain

## What this line has already achieved

### Session 101 target selection

Session 101 correctly identified the first target as the live agent-tick execution path inside [`src/runtime/execution-boundary/local-execution-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts).

That was the best first cut because the execution boundary itself still performed direct process-global registry lookups during real work-item execution.

### Session 102 boundary completion

Session 102 completed the first coding phase by introducing [`src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts) and wiring it through the live composition sites:

- [`src/scheduler/composition/default-scheduler.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler/composition/default-scheduler.ts)
- [`src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/bootstrap/default-daemon-runtime.ts)

The adjacent compatibility wrapper in [`src/scheduler/composition/execution-engine-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler/composition/execution-engine-adapter.ts) also now requires the injected resolver instead of preserving a hidden fallback constructor path.

### What is now concretely better

After Session 102:

- the live agent-tick path in [`src/runtime/execution-boundary/local-execution-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts) no longer calls `getGlobalAgentRegistry()` or `getGlobalRunnerRegistry()`
- direct global agent/runner registry reads have been removed from the active agent-tick execution path
- composition-owned injection now exists at the identified scheduler/daemon sites
- agent definition lookup, runner-path detection, and runner resolution are now explicit injected dependencies on the execution boundary

That is a real ownership/composition win on a meaningful live runtime path.

## Current remaining plausible targets inside this line

Only targets that actually exist in the current codebase are listed here.

### 1. Gateway RPC handler global agent-registry access

Current evidence:

- [`src/gateway/rpc/handlers/goal-handlers.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/rpc/handlers/goal-handlers.ts) still imports `getGlobalAgentRegistry()`
- the `agent.command.submit` handler loads agents and reads the selected agent definition directly from that global registry before materializing the goal

What it is:

- real singleton/service-locator usage
- on a live RPC path
- but located on the gateway request-materialization side, not inside the runtime execution boundary that Session 102 just cleaned up

### 2. Daemon startup and runner-registration ownership pressure

Current evidence:

- [`src/scheduler-daemon/daemon.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts) still loads agents through `getGlobalAgentRegistry()`
- the same startup sequence still registers runners through `getGlobalRunnerRegistry()`

What it is:

- real global registry ownership pressure
- but concentrated in daemon startup/bootstrap and recurring-agent runtime activation

### 3. Provider-manager adjacent singleton-style composition

Current evidence:

- [`src/infra/llm/provider-manager/provider-manager.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/provider-manager/provider-manager.ts) still constructs itself from `getEndpointManager()` and `getWorkloadModelResolver()`
- [`src/infra/llm/provider-manager/agent-model-resolver.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/provider-manager/agent-model-resolver.ts) still reads `getGlobalAgentRegistry()`

What it is:

- real singleton-style runtime composition pressure
- still active on runtime paths that influence model selection and fallback
- structurally meaningful, but adjacent to the paused Sessions 95-100 source-of-truth line

### 4. Prompt/tool fallback global access on live runtime paths

Current evidence:

- [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts) still falls back to `getGlobalPromptProvider()` and `getGlobalToolProvider()` when runtime tooling context is omitted
- [`src/app/conversation/response-generator.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/conversation/response-generator.ts) still falls back to `getGlobalToolProvider()`
- [`src/infra/prompts/prompt-provider.ts`](/Users/nickma/Develop/nick-ma/pony/src/infra/prompts/prompt-provider.ts) still defaults to global skill/tool services
- [`src/runtime/tooling-context/runtime-tooling-context.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tooling-context/runtime-tooling-context.ts) still intentionally mirrors the explicit runtime tooling context back into legacy globals

What it is:

- real singleton/service-locator fallback behavior still present on live runtime-capable code paths
- but already intentionally retained as compatibility support after the earlier runtime-tooling-context work

## Evaluation of each plausible remaining target

### Target A: gateway RPC handler global registry access

Structural gain:

- medium
- replacing the direct registry read in `agent.command.submit` would make gateway-side agent-command materialization less dependent on a hidden process-global lookup

Semantic risk:

- low to medium
- the handler does real agent loading, enabled checks, policy snapshot capture, tool policy derivation, workdir materialization, and route-context creation before dispatch

Scope tightness:

- moderate, not high
- the local code change could be small, but a proper cleanup needs a composition-owned dependency threaded into gateway handler registration

Is it truly ownership/composition/wiring cleanup?

- yes

Drift risk:

- medium
- the natural implementation path goes through gateway handler-registration wiring in [`src/gateway/gateway-server.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/gateway-server.ts), which is too close to the already-closed gateway runtime graph / service-wiring block

Judgment:

- plausible, but not strong enough to justify continuing this line by itself

### Target B: daemon startup / runner-registration ownership pressure

Structural gain:

- medium
- the daemon would become less dependent on hidden global registry ownership at startup

Semantic risk:

- high relative to the expected gain
- this area owns agent loading, cron reconciliation, startup sequencing, runner registration, and recurring agent scheduling activation

Scope tightness:

- low

Is it truly ownership/composition/wiring cleanup?

- yes, but it is inseparable from startup/bootstrap semantics

Drift risk:

- high
- any worthwhile move here risks reopening `RF-060` or redesigning current runner-registration behavior

Judgment:

- should not be the next target in this line

### Target C: provider-manager adjacent singleton-style composition

Structural gain:

- medium to high
- this area still centralizes model-resolution and endpoint-lifetime decisions behind singleton-backed services

Semantic risk:

- medium to high
- this cluster directly affects model selection, fallback order, endpoint availability checks, and provider execution flow

Scope tightness:

- low

Is it truly ownership/composition/wiring cleanup?

- yes

Drift risk:

- high
- it would likely drift into provider capability design, source-of-truth cleanup, or broad package/runtime DI churn

Judgment:

- important longer-term, but not a tightly bounded Session 104 target

### Target D: prompt/tool fallback related global access

Structural gain:

- low to medium
- another fallback removal here would make more constructors explicit, but the highest-value runtime-core path already moved in Session 102

Semantic risk:

- medium
- these fallbacks are still part of the current compatibility strategy around runtime tooling context and older callers

Scope tightness:

- deceptively low
- the first local edit is easy, but the cleanup quickly broadens across prompt/provider creation policy and non-migrated callers

Is it truly ownership/composition/wiring cleanup?

- partly, but mixed with compatibility policy

Drift risk:

- high
- this would easily turn into repo-wide DI churn rather than one bounded structural improvement

Judgment:

- not a good next target

## Conclusion

### Is there still one more high-value bounded step inside this line?

No.

After Session 102, the strongest live execution-boundary service-locator reach-through is already removed. The remaining candidates are real, but none of them is simultaneously:

- high-value
- tightly bounded
- clearly semantics-preserving
- and cleanly inside runtime-core ownership/composition cleanup without reopening another refactor line

That means this line has reached diminishing returns for now.

### Why pausing now is the right call

1. The clearest live runtime-core reach-through has already been fixed.
2. The remaining singleton usage is now either lower-yield or structurally entangled with paused/closed lines.
3. Forcing one more coding session here would likely spend scope budget on gateway wiring, startup ownership, provider-selection semantics, or compatibility cleanup rather than another clean runtime-core boundary win.
4. The honest review result is that the line is no longer the highest-value place for the next bounded session.

## Re-ranking against broader next-block candidates

Because this line should pause, the next session should be chosen against the broader remaining blocks rather than stretching singleton/service-locator cleanup.

### 1. Daemon detach/unsubscribe capability design

Recommended next block.

Why it now ranks first:

- the structural precursor work is already in place
- [`src/gateway/integration/gateway-daemon-detach-operations.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/gateway-daemon-detach-operations.ts) explicitly models the current detach state as unsupported rather than leaving it implicit
- [`src/gateway/integration/gateway-daemon-attachment.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/gateway-daemon-attachment.ts) now exposes detach-facing operation state through a clear gateway-owned surface
- the remaining work is a bounded capability-design question that now has an explicit structural home

Why it beats continuing this line:

- it offers a clearer next decision boundary than any remaining singleton target
- it does not require reopening `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- it is more likely to produce one well-scoped design session than another low-yield singleton cleanup pass

### 2. Broader package architecture / module-boundary redesign

Not recommended next.

Why it ranks second:

- current singleton pressure does not justify broad package surgery yet
- the codebase still benefits more from bounded line-level work than from repo-wide module reshaping

### 3. Continue runtime-core singleton / service-locator cleanup

Not recommended next.

Why it ranks third:

- the obvious first target was already taken in Session 102
- the remaining candidates are weaker, riskier, or more entangled than the just-completed work

## What should not be done next

- Do not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`.
- Do not resume the paused Sessions 95-100 source-of-truth line through provider-manager or session preferred-model cleanup disguised as singleton work.
- Do not redesign daemon startup or runner-registration behavior inside this line.
- Do not turn prompt/tool fallback cleanup into broad constructor rewiring or repo-wide DI conversion.
- Do not treat gateway RPC handler cleanup as a reason to reopen gateway runtime graph / service-wiring extraction.
- Do not jump to broad package/module-boundary redesign.
- Do not change runtime semantics, startup semantics, scheduler semantics, gateway/daemon IPC behavior, provider fallback behavior, RPC behavior, event payload shapes, or TUI behavior.

## Recommended Session 104

Recommend exactly one next session:

- begin a bounded daemon detach/unsubscribe capability design session

Practical focus for that session:

- use the explicit detach-facing boundary in [`src/gateway/integration/gateway-daemon-detach-operations.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/gateway-daemon-detach-operations.ts) and [`src/gateway/integration/gateway-daemon-attachment.ts`](/Users/nickma/Develop/nick-ma/pony/src/gateway/integration/gateway-daemon-attachment.ts) as the source of truth for current structure
- document what detach and unsubscribe would need to mean operationally without changing current behavior
- identify the smallest safe future capability slice, if any, without broadening into transport redesign

## Validation

Validation for Session 103 was review/documentation-only:

- reviewed the current Session 101 and Session 102 refactor documents
- inspected the current code paths in:
  - `src/runtime/execution-boundary/local-execution-adapter.ts`
  - `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
  - `src/scheduler/composition/default-scheduler.ts`
  - `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
  - `src/scheduler/composition/execution-engine-adapter.ts`
  - `src/gateway/rpc/handlers/goal-handlers.ts`
  - `src/scheduler-daemon/daemon.ts`
  - `src/autonomy/react-integration.ts`
  - `src/app/conversation/response-generator.ts`
  - `src/infra/prompts/prompt-provider.ts`
  - `src/infra/llm/provider-manager/provider-manager.ts`
  - `src/infra/llm/provider-manager/agent-model-resolver.ts`
  - `src/gateway/integration/gateway-daemon-detach-operations.ts`
  - `src/gateway/integration/gateway-daemon-attachment.ts`
- updated only:
  - `docs/refactoring/session103-runtime-core-singleton-line-review.md`
  - `docs/refactoring/ponybunny_refactor_master_task_list.md`

No runtime code files were changed in this session.
