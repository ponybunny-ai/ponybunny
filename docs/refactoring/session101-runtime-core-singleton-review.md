# Session 101: Runtime-Core Singleton / Service-Locator Review

## Summary

Session 101 starts a new refactor line:

- broader runtime-core singleton / service-locator cleanup

This session is review/documentation only. It does not change runtime behavior, startup behavior, scheduler behavior, gateway/daemon IPC behavior, provider execution/fallback behavior, admin/runtime RPC behavior, event payloads, or TUI behavior.

Using the current codebase, the single highest-value, semantics-preserving first target in this new line is:

- the agent-tick execution path in [`src/runtime/execution-boundary/local-execution-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts)

That path is still a true live service-locator reach-through on a meaningful runtime boundary. `LocalExecutionAdapter` is the scheduler-owned execution port assembled by both default scheduler composition and daemon bootstrap, but on agent-tick work items it directly reads the process-global agent and runner registries to decide execution routing and resolve the concrete runner. That is the strongest remaining first cut because it is:

- on a live runtime path
- squarely about ownership/composition/boundary cleanup
- structurally valuable
- tightly bounded
- low risk to keep semantics unchanged if addressed by dependency injection at composition time

This session does not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`, does not continue the source-of-truth line from Sessions 95-100, and does not broaden into daemon detach/unsubscribe work, package redesign, or repo-wide singleton removal.

## Current codebase evidence

### 1. The strongest still-live runtime-core reach-through

`LocalExecutionAdapter` is assembled as the scheduler/runtime execution port in both current composition paths:

- [`src/scheduler/composition/default-scheduler.ts:45`](/Users/nickma/Develop/nick-ma/pony/src/scheduler/composition/default-scheduler.ts#L45) constructs `new LocalExecutionAdapter(executionService)` when no execution port is injected.
- [`src/scheduler-daemon/bootstrap/default-daemon-runtime.ts:55`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/bootstrap/default-daemon-runtime.ts#L55) also constructs `new LocalExecutionAdapter(deps.executionService)` before wiring the execution worker and scheduler.

Inside that live execution boundary, the agent-tick path still reaches directly into process-global registries:

- [`src/runtime/execution-boundary/local-execution-adapter.ts:49`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts#L49) calls `getGlobalAgentRegistry()`
- [`src/runtime/execution-boundary/local-execution-adapter.ts:75`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts#L75) calls `getGlobalRunnerRegistry()`
- the same method then uses those globals to:
  - fetch the agent definition
  - compare `definitionHash`
  - decide whether to route through a registered runner or fall back to `ExecutionService`
  - resolve and execute the concrete runner

That is not just a singleton existence issue. It is live execution-path policy and routing depending on a hidden process-global lookup from inside a runtime boundary that otherwise looks explicit.

### 2. Tool-provider global fallback is still present, but no longer the best next target

There are still fallback consumers of `getGlobalToolProvider()` and `getGlobalPromptProvider()`:

- [`src/autonomy/react-integration.ts:83`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L83)
- [`src/app/conversation/response-generator.ts:79`](/Users/nickma/Develop/nick-ma/pony/src/app/conversation/response-generator.ts#L79)
- [`src/infra/prompts/prompt-provider.ts:32`](/Users/nickma/Develop/nick-ma/pony/src/infra/prompts/prompt-provider.ts#L32)

But Session 55-58 already established `RuntimeToolingContext` as the explicit runtime-owned source of truth for migrated runtime paths, and that context still intentionally mirrors the legacy globals through:

- [`src/runtime/tooling-context/runtime-tooling-context.ts:60`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tooling-context/runtime-tooling-context.ts#L60)

Gateway runtime setup also still writes the compatibility global tool-provider surface:

- [`src/gateway/runtime/gateway-tool-provider-runtime.ts:44`](/Users/nickma/Develop/nick-ma/pony/src/gateway/runtime/gateway-tool-provider-runtime.ts#L44)

This remains real singleton pressure, but Session 58 already documented why it was intentionally deferred. Touching it next would risk drifting into constructor-fallback cleanup, broader compatibility-surface cleanup, or repo-wide DI churn rather than a single high-value runtime-core boundary repair.

### 3. Provider-manager adjacent singletons are real, but not the best first cut

`LLMProviderManager` still composes itself from singleton-style runtime services:

- [`src/infra/llm/provider-manager/provider-manager.ts:40`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/provider-manager/provider-manager.ts#L40) reads `getEndpointManager()` and `getWorkloadModelResolver()`
- [`src/infra/llm/provider-manager/provider-manager.ts:823`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/provider-manager/provider-manager.ts#L823) exports `getLLMProviderManager()` as a singleton

`WorkloadModelResolver` also reaches through to the global agent registry:

- [`src/infra/llm/provider-manager/agent-model-resolver.ts:55`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/provider-manager/agent-model-resolver.ts#L55)

`EndpointManager` is also singleton-backed:

- [`src/infra/llm/provider-manager/endpoint-manager.ts:365`](/Users/nickma/Develop/nick-ma/pony/src/infra/llm/provider-manager/endpoint-manager.ts#L365)

This is meaningful singleton-style runtime composition pressure, but it is not yet the best first cut for this new line. A first session there would likely sprawl into provider-manager construction policy, config-cache lifetime, CLI/API callers, and the just-paused source-of-truth surfaces around model selection.

### 4. Other global registry reads that are real but lower-value first cuts

Other current global reads exist:

- gateway agent-command submission loads and reads the global agent registry in [`src/gateway/rpc/handlers/goal-handlers.ts:207`](/Users/nickma/Develop/nick-ma/pony/src/gateway/rpc/handlers/goal-handlers.ts#L207)
- scheduler daemon startup loads the global agent registry and registers runners into the global runner registry in [`src/scheduler-daemon/daemon.ts:158`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts#L158) and [`src/scheduler-daemon/daemon.ts:233`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/daemon.ts#L233)
- session preferred-model reads still touch the global agent registry in [`src/app/conversation/session-manager.ts:667`](/Users/nickma/Develop/nick-ma/pony/src/app/conversation/session-manager.ts#L667)
- process-subagent management still defaults to the global agent registry in [`src/infra/agents/subagent-process-manager.ts:204`](/Users/nickma/Develop/nick-ma/pony/src/infra/agents/subagent-process-manager.ts#L204)

These are real, but each is a worse first target:

- gateway RPC registry reads are not the most important runtime-core ownership knot
- daemon startup registry usage is entangled with startup semantics, which are explicitly out of scope
- session-manager registry reads sit inside the paused source-of-truth line
- subagent-process-manager already exposes an injectable provider and is not the highest-value live runtime path

## Classification of current findings

### True service-locator reach-through

- `LocalExecutionAdapter` agent-tick execution path reads `getGlobalAgentRegistry()` and `getGlobalRunnerRegistry()` from inside the active execution boundary.
- `WorkloadModelResolver` reads `getGlobalAgentRegistry()` to derive agent model hints.

### Singleton-style runtime composition pressure

- `LLMProviderManager` constructs itself from `getEndpointManager()` and `getWorkloadModelResolver()`, then exposes a process-global singleton accessor.
- `EndpointManager` and `WorkloadModelResolver` are themselves singleton-backed runtime services.

### Implicit fallback dependency

- `ReActIntegration`, `ResponseGenerator`, and `PromptProvider` still fall back to global prompt/tool providers when explicit runtime tooling context is omitted.

### Global registry read on live runtime path

- `LocalExecutionAdapter` agent-tick path
- gateway `agent.command.submit`
- session preferred-model hint reads

### Compatibility-only global access not worth touching yet

- `RuntimeToolingContext.syncLegacyGlobals()` mirror writes
- gateway runtime installation of the legacy global tool-provider surface
- prompt/tool global fallbacks that remain intentionally supported for non-migrated callers after Session 58

## Plausible candidate targets

### Candidate A: LocalExecutionAdapter agent/runner registry reach-through

Current pattern:

- a scheduler/runtime execution boundary calls process-global registries directly during live execution

Where it lives:

- [`src/runtime/execution-boundary/local-execution-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts)
- assembled from [`src/scheduler/composition/default-scheduler.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler/composition/default-scheduler.ts)
- assembled from [`src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/bootstrap/default-daemon-runtime.ts)

Structural gain:

- high
- it removes hidden runtime lookup from a boundary that should already be explicit
- it tightens the live scheduler/worker execution path without changing what agent definitions or runners are used

Semantic risk:

- low to medium if done narrowly
- the same registries can still back the new boundary; only lookup ownership changes

Scope tightness:

- high
- one runtime boundary plus its immediate composition sites

Inside ownership/composition/wiring/boundary cleanup?

- yes, directly

Drift risk:

- low if kept to dependency ownership only

Judgment:

- best first target

### Candidate B: Prompt/tool global fallback cleanup

Current pattern:

- runtime-capable constructors still fall back to process-global prompt/tool services

Structural gain:

- medium

Semantic risk:

- medium to high because fallback removal or narrowing quickly touches compatibility callers and runtime-tooling migration policy

Scope tightness:

- deceptively low; likely to sprawl

Inside ownership/composition/wiring/boundary cleanup?

- partly, but mixed with compatibility policy

Drift risk:

- high risk of repo-wide singleton cleanup or aesthetic DI churn

Judgment:

- not the next target

### Candidate C: Provider-manager / endpoint-manager singleton composition

Current pattern:

- provider-manager family relies on singleton-owned resolver and endpoint-manager state

Structural gain:

- medium to high in theory

Semantic risk:

- medium to high because it touches provider selection, endpoint health/cache lifetime, and many callers

Scope tightness:

- low as a first step

Inside ownership/composition/wiring/boundary cleanup?

- yes

Drift risk:

- high risk of broad DI churn, provider capability redesign, or accidental continuation of the source-of-truth line

Judgment:

- important later, not the best first cut

### Candidate D: Daemon/global registry composition cleanup

Current pattern:

- daemon startup loads agent registry globally and registers schema runners into the global runner registry

Structural gain:

- medium

Semantic risk:

- medium because it is entangled with startup sequence and runtime availability

Scope tightness:

- moderate at best

Inside ownership/composition/wiring/boundary cleanup?

- yes, but too close to startup semantics

Drift risk:

- high risk of reopening `RF-060`

Judgment:

- explicitly not the next target

## Selected highest-value first target

### Target

- inject an explicit agent-tick execution dependency boundary into `LocalExecutionAdapter` so the live execution boundary no longer reaches `getGlobalAgentRegistry()` and `getGlobalRunnerRegistry()` directly

### Current problematic pattern

`LocalExecutionAdapter` is supposed to be the scheduler/runtime execution boundary, but on agent-tick work items it bypasses explicit ownership and performs hidden service lookup against process-global agent and runner registries. That means a runtime boundary that otherwise looks injected and explicit still decides execution routing from ambient global state.

### Where it lives

- [`src/runtime/execution-boundary/local-execution-adapter.ts:45`](/Users/nickma/Develop/nick-ma/pony/src/runtime/execution-boundary/local-execution-adapter.ts#L45)
- composed from [`src/scheduler/composition/default-scheduler.ts:52`](/Users/nickma/Develop/nick-ma/pony/src/scheduler/composition/default-scheduler.ts#L52)
- composed from [`src/scheduler-daemon/bootstrap/default-daemon-runtime.ts:58`](/Users/nickma/Develop/nick-ma/pony/src/scheduler-daemon/bootstrap/default-daemon-runtime.ts#L58)

### Who should own the dependency instead

The scheduler/daemon runtime composition layer should own the concrete registry access and pass a narrow dependency into `LocalExecutionAdapter`.

The adapter should depend on a small injected boundary that covers only what the agent-tick path needs, for example:

- load/resolve agent definition by id
- resolve whether a runner path exists for the definition
- resolve the concrete runner for that definition

That ownership belongs in runtime composition, not inside the execution boundary itself.

### Why this is the best first cut

- It is a true live runtime service-locator reach-through, not just an old singleton that still exists somewhere.
- It sits on a meaningful path: scheduler execution, execution worker dispatch, and agent-tick routing.
- It can be repaired without changing runtime semantics by injecting the same backing registries behind a narrow explicit boundary.
- It does not require reopening gateway service wiring, startup/bootstrap work, transport boundaries, or the paused source-of-truth line.
- It avoids the trap of broad singleton elimination and instead removes one high-value hidden dependency from one runtime-owned seam.

## What is explicitly not the next target

- reopening `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- continuing the Sessions 95-100 source-of-truth line
- daemon detach/unsubscribe capability work
- broad package/module-boundary redesign
- repo-wide singleton elimination
- constructor-fallback removal across the repo
- provider-manager-wide DI conversion
- purely aesthetic DI or “make everything injectable” cleanup
- TUI selected-model cleanup
- RPC/event payload redesign

## Recommended Session 102

Recommend exactly one next session:

- one bounded coding session that introduces a narrow injected agent-tick registry/runner dependency boundary for `LocalExecutionAdapter`, wires it from current scheduler/daemon composition, and preserves all existing execution routing, runner selection, fallback-to-`ExecutionService`, IPC, startup, and payload semantics

This should remain tightly scoped to the execution-boundary call path. It should not attempt daemon-wide registry ownership cleanup or provider-manager cleanup in the same session.

## What this new refactor line should not do next

- do not start a repo-wide singleton purge
- do not remove prompt/tool fallback constructors across unrelated modules
- do not redesign provider-manager, endpoint-manager, and model-resolver construction in one pass
- do not reinterpret the remaining GatewayServer ownership as unfinished `RF-061`
- do not fold startup/bootstrap changes back into daemon or gateway composition roots
- do not turn this line into package reshuffling or barrel cleanup
- do not pursue symmetry-driven dependency injection where the codebase does not get a clear ownership win

## Practical phased roadmap

### Phase 1

Bound the first live execution-path reach-through:

- extract the agent-tick registry/runner dependency behind an explicit injected boundary on `LocalExecutionAdapter`

### Phase 2

Reassess adjacent live runtime-core globals only if Phase 1 lands cleanly:

- decide whether the next best target is another execution/runtime path, a narrow provider-manager composition seam, or whether the line should pause again

### Phase 3

Touch compatibility/global fallback surfaces only when there is a concrete runtime-owned ownership win:

- avoid broad fallback removal unless a specific live runtime path still depends on hidden global state

## Validation for this review session

Validation for Session 101 should confirm this remained documentation-only:

- inspect current singleton/service-locator call sites in `src/`
- add this review document
- update only the relevant rows in the refactor master task list
- verify no runtime source files were changed

