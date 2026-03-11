# Session 118: Major-Block Re-Ranking Review

## Scope

Session 118 is a bounded documentation/review session only.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign scheduler semantics
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport semantics
- redesign provider execution/fallback behavior
- change existing RPC/event/status payload shapes
- change TUI behavior
- perform broad package/module-boundary redesign

The goal is to identify the single best next major block to activate after Session 117 paused `RF-036`.

## Reviewed Sources

Task/state documents reviewed:

- `docs/refactoring/ponybunny_refactor_master_task_list.md`
- `docs/refactoring/session109-detach-capability-line-review.md`
- `docs/refactoring/session111-rf062-line-review.md`
- `docs/refactoring/session114-rf030-line-review.md`
- `docs/refactoring/session117-rf036-line-review.md`
- `docs/refactoring/session100-source-of-truth-line-review.md`
- `docs/refactoring/session103-runtime-core-singleton-line-review.md`
- `docs/refactoring/session58-runtime-core-cleanup-closure-review.md`
- `docs/refactoring/session92-tool-provider-wiring-rationalization.md`

Current code surfaces reviewed for this re-ranking:

- `src/runtime/tooling-context/runtime-tooling-context.ts`
- `src/app/lifecycle/execution/execution-service.ts`
- `src/infra/prompts/prompt-provider.ts`
- `src/autonomy/react-integration.ts`
- `src/app/conversation/response-generator.ts`
- `src/app/lifecycle/planning/planning-service.ts`
- `src/runtime/execution-boundary/local-execution-cycle-runtime-factory.ts`
- `src/gateway/runtime/gateway-tool-provider-runtime.ts`
- `src/scheduler/core/scheduler.ts`
- `src/runtime/workers/execution-worker.ts`
- `src/scheduler-daemon/conversation-bootstrap/conversation-task-materializer.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `src/app/conversation/session-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/scheduler-daemon/daemon.ts`

## Current Active/Paused Landscape

### Truly closed lines

These lines look closed in both the task table and current code shape:

- `RF-034` scheduler composition / ownership cleanup
- gateway/daemon transport-boundary block (`RF-035` / `RF-058`)
- `RF-059` compatibility/public-surface rationalization
- `RF-060` startup/bootstrap composition-root rationalization
- `RF-061` GatewayServer internal runtime graph / service-wiring rationalization

Why they still look closed:

- the remaining work in those areas is no longer a coherent internal ownership seam; it is mostly outward rollout, compatibility residue, or small helper-internal cleanup
- current code already reflects the extracted ownership homes those lines were meant to create
- reopening them now would be symmetry chasing rather than landing another strong structural slice

### Paused at diminishing returns

These lines were paused because the current remaining work is real but no longer the best next bounded cluster:

- `RF-030`
  - Session 113 already moved the concrete conversation-to-goal/work-item materialization and scheduler-submit knot into `ConversationTaskMaterializer`
  - the remaining `SchedulerTaskBridge` pressure is mostly thin observation/read/cancel surface, and `subscribeToProgress(...)` is still a no-op stub
- `RF-036`
  - Session 116 already isolated gateway/TUI `task.narration` / `task.result` behind an explicit compatibility-only boundary
  - the only substantial remaining target is the runtime-internal `task.ready` seam in `src/scheduler/core/scheduler.ts` and `src/runtime/workers/execution-worker.ts`, which is more entangled with execution/replay/event-store semantics than the finished gateway cleanup
- Sessions 95-100 source-of-truth line
  - Session 96-99 already centralized effective model resolution and the main compatibility projections
  - the remaining ambiguity is mostly TUI/transport mirror cleanup, not another strong ownership boundary
- Sessions 101-103 broader singleton/service-locator line
  - Session 102 already removed the highest-value live execution-boundary global registry reach-through
  - the remaining general singleton targets are spread across gateway wiring, startup, provider-manager/model-selection, and compatibility fallbacks

### Intentionally paused after a coherent first slice

These lines were paused in a controlled way because the first bounded slice already reached a natural stopping point:

- Sessions 104-109 detach capability block
  - internal/admin detach is structurally complete; remaining work is public rollout, unsubscribe/protocol work, or UI/reporting
- `RF-062`
  - the one clearly valuable post-`RF-061` cluster landed in Session 110, and the remaining pressure is helper-internal rather than another meaningful live-server ownership seam

### Planned/not-yet-advanced areas that still exist

The master task list still contains only two not-done legacy planned/deferred tool lines:

- `RF-024` tool mode switch
  - current code still supports only the local authoritative awaited tool path, and Session 39 already concluded a formal mode switch should not exist yet
- `RF-026` tool hardening
  - current code still shows the same local in-process `LocalToolWorker` shape that justified deferring broader durable/cross-process hardening until a non-local topology exists

Those areas still exist, but the current codebase does not support them as the strongest next major block.

## Plausible Next Major Blocks

Only candidates grounded in the current codebase and current task table are included here.

### Candidate 1: activate a new runtime-tooling compatibility/fallback cleanup block

Current code evidence:

- `ExecutionService` creates the explicit `RuntimeToolingContext` and immediately mirrors it outward through `runtimeToolingContext.syncLegacyGlobals()` in `src/app/lifecycle/execution/execution-service.ts`
- `RuntimeToolingContext.syncLegacyGlobals()` currently writes only prompt/tool globals in `src/runtime/tooling-context/runtime-tooling-context.ts`
- `GatewayToolProviderRuntime` separately installs a gateway-owned global tool provider through `setGlobalToolProvider(this.toolProvider)` in `src/gateway/runtime/gateway-tool-provider-runtime.ts`
- `PromptProvider` still defaults directly to `getGlobalSkillRegistry()` and `getGlobalToolProvider()` in `src/infra/prompts/prompt-provider.ts`
- `ReActIntegration`, `ResponseGenerator`, and `PlanningService` still fall back to `getGlobalPromptProvider()` or `getGlobalToolProvider()` when explicit `RuntimeToolingContext` is omitted in:
  - `src/autonomy/react-integration.ts`
  - `src/app/conversation/response-generator.ts`
  - `src/app/lifecycle/planning/planning-service.ts`
- the explicit runtime-owned path is already clear in `src/runtime/execution-boundary/local-execution-cycle-runtime-factory.ts`, which constructs `PromptProvider(params.skillRegistry, toolProvider)` directly for the runtime-owned execution path

What the problematic seam actually is:

- the repository already has an authoritative runtime-owned tooling boundary on migrated paths
- but the compatibility/fallback ownership around legacy prompt/tool access is still split between runtime-owned sync, gateway-owned global installation, direct global defaults inside `PromptProvider`, and constructor fallbacks in migrated consumers
- that is a real live ownership seam, not just naming debt

Evaluation:

- Structural gain: high
  - it would clarify where legacy prompt/tool fallback ownership lives without reopening execution, gateway transport, or startup semantics
- Semantic risk: low to medium
  - the first slice can preserve all current getters/setters and fallback behavior while only making the compatibility boundary explicit
- Scope tightness: good
  - the live seam is concentrated in a small set of files rather than spread across multiple subsystems
- Supports one large bounded coding session next: yes
- Drift into redesign risk: moderate but controllable
  - only if it widens into repo-wide singleton removal or tool-topology unification, which should be explicitly avoided

Judgment:

This is the strongest live candidate because it still exposes one concentrated ownership/composition seam with a clear safe first slice.

### Candidate 2: resume `RF-036` for the runtime-internal `task.ready` seam

Current code evidence:

- `src/scheduler/core/scheduler.ts` still publishes `task.ready`
- `src/runtime/workers/execution-worker.ts` still subscribes to `task.ready`
- Session 117 already confirmed that this is the only substantial remaining `RF-036` target

Evaluation:

- Structural gain: moderate
- Semantic risk: high
  - touches execution dispatch, replay reasoning, event-store history, and operational expectations around the event vocabulary
- Scope tightness: only moderate
- Supports one large bounded coding session next: maybe, but with materially worse risk/reward than Session 116
- Drift into redesign risk: high

Judgment:

This remains a real candidate, but it still loses because it is more entangled than the selected runtime-tooling compatibility seam.

### Candidate 3: resume `RF-030` for a post-materialization observation split

Current code evidence:

- `ConversationTaskMaterializer` now owns the substantive creation/submission path
- `SchedulerTaskBridge` still mixes that delegate with `getTaskStatus(...)`, `cancelTask(...)`, and `subscribeToProgress(...)`
- `SessionManager` still reads task status and subscribes to progress through that bridge

Evaluation:

- Structural gain: modest
- Semantic risk: low to medium
- Scope tightness: moderate
- Supports one large bounded coding session next: yes, but the payoff is smaller than before because the main knot is already gone
- Drift into redesign risk: medium if it starts changing conversation lifecycle ownership instead of only interface shape

Judgment:

This is still the cleanest paused-line second slice, but it is now smaller than the selected candidate and no longer the best use of the next major block.

### Candidate 4: resume the paused source-of-truth/model-selection line

Current code evidence:

- `src/app/conversation/session-manager.ts` still reads agent model hints through `getGlobalAgentRegistry()`
- `src/infra/llm/provider-manager/agent-model-resolver.ts` still reads `getGlobalAgentRegistry()`
- TUI and transport surfaces still consume compatibility-selected-model mirrors

Evaluation:

- Structural gain: low to moderate
- Semantic risk: medium to high
  - the remaining work sits close to TUI semantics, transport mirrors, and persisted compatibility fields
- Scope tightness: weak
- Supports one large bounded coding session next: not cleanly
- Drift into redesign risk: high

Judgment:

The codebase still contains residue here, but Session 100’s diminishing-returns conclusion still holds.

### Candidate 5: resume the broader singleton/service-locator line

Current code evidence:

- `src/gateway/rpc/handlers/goal-handlers.ts` still reads `getGlobalAgentRegistry()`
- `src/scheduler-daemon/daemon.ts` still loads agents/runners through global registries during startup
- `src/infra/llm/provider-manager/agent-model-resolver.ts` still reaches the global agent registry
- prompt/tool fallback globals still exist

Evaluation:

- Structural gain: potentially medium
- Semantic risk: medium to high
- Scope tightness: poor in the broad form
- Supports one large bounded coding session next: not as a broad line
- Drift into redesign risk: high

Judgment:

The broad paused line still should not resume as-is. The selected candidate wins precisely because it extracts one narrow, stronger sub-seam from that broader field instead of reopening the whole line.

### Candidate 6: start `RF-024` tool mode switch or `RF-026` tool hardening

Current code evidence:

- `LocalToolWorker` still represents the intended local authoritative path
- there is still no justified non-local topology or need for a formal tool-dispatch mode setting

Evaluation:

- Structural gain: low right now
- Semantic risk: medium
- Scope tightness: moderate
- Supports one large bounded coding session next: technically yes, but with weak justification
- Drift into redesign risk: medium to high

Judgment:

Neither remaining tool task currently beats the selected block or even the best paused-line second slices.

## Selected Next Major Block

### Choice

Activate a new bounded block for runtime-tooling compatibility/fallback boundary cleanup.

### The current problematic seam

The live seam is the split ownership between:

- explicit runtime-owned tooling on migrated paths
- legacy prompt/tool globals used as compatibility fallback
- gateway-owned global tool-provider installation
- direct global defaults embedded inside `PromptProvider`
- constructor fallback logic inside migrated consumers

That seam currently lives primarily in:

- `src/runtime/tooling-context/runtime-tooling-context.ts`
- `src/app/lifecycle/execution/execution-service.ts`
- `src/gateway/runtime/gateway-tool-provider-runtime.ts`
- `src/infra/prompts/prompt-provider.ts`
- `src/autonomy/react-integration.ts`
- `src/app/conversation/response-generator.ts`
- `src/app/lifecycle/planning/planning-service.ts`

### Why now is the right time

Why this is the right time in the current repository state:

1. The older gateway/startup/public-surface lines that previously would have blurred this work are now closed.
2. Session 117 already showed that `RF-036` has crossed into a riskier execution/event-store seam rather than another clean protocol cleanup.
3. `RF-030` already landed its strongest materialization extraction and now offers only a smaller second slice.
4. The selected seam already has prior documented backlog support:
   - Session 58 explicitly deferred `PromptProvider` default/global cleanup and clearer gateway/global-tool compatibility isolation
   - Session 92 explicitly postponed broader unification of gateway-local tool assembly with the runtime-tooling-context path
   - Session 103 still called out the remaining prompt/tool fallback surfaces, but the broad singleton line was too scattered
5. The current code now makes the remaining seam easier to isolate honestly as a compatibility-boundary problem, not a broad singleton purge.

### Why it is better than resuming paused lines

It wins over the paused lines because:

- it has higher structural gain than the remaining `RF-030` observation split
- it has materially lower semantic risk than the remaining `RF-036` `task.ready` work
- it is more tightly bounded than resuming the broad source-of-truth or singleton lines
- it does not force public detach rollout, unsubscribe semantics, TUI cleanup, payload-shape churn, or startup redesign

### Safest first slice

The safest first slice is one bounded coding session that:

- introduces one explicit compatibility owner for legacy prompt/tool-provider access and installation
- narrows `PromptProvider` default/global creation behind that compatibility seam instead of embedding direct global defaults in the class constructor
- reroutes the existing runtime-owned and gateway-owned legacy-global writes through that compatibility seam
- preserves:
  - current `RuntimeToolingContext` authority on migrated paths
  - current getter/setter compatibility surfaces
  - current execution, gateway, IPC, payload, and TUI behavior

This is safer than trying to remove all fallback usage immediately. It makes the compatibility boundary explicit first, while preserving behavior.

## What Is Not Next

The following are explicitly not the next step:

- resuming `RF-036` by default
- resuming `RF-030`, `RF-062`, detach, source-of-truth, or broad singleton lines without a stronger case than the selected block
- broad package/module-boundary redesign
- broad naming-only or cleanup-only work
- repo-wide singleton purge
- speculative tool-topology, unsubscribe, or future protocol capability work not grounded in the current code
- changing provider execution/fallback behavior
- changing existing RPC/event/status payload shapes
- changing TUI behavior

## Recommended Session 119

Recommend exactly one next session:

One bounded coding session for the selected runtime-tooling compatibility/fallback block.

This should be a coding session, not one more design session, because the current code and prior reviews already make the first safe slice clear enough:

- explicit runtime-owned tooling authority already exists
- the remaining compatibility seam is now well-localized
- the safest first slice is additive and semantics-preserving

## Short Phased Roadmap For The Selected Block

### Phase 1

Session 119:

- extract the legacy prompt/tool compatibility boundary
- route current runtime-owned and gateway-owned global installation through it
- keep current fallback behavior intact

### Phase 2

Only if Phase 1 lands cleanly:

- trim direct global-default construction out of nearby migrated consumers where the compatibility helper already provides the same behavior

### Phase 3

Re-rank before any broader follow-up:

- do not automatically widen into repo-wide singleton cleanup, gateway/runtime tool-graph unification, or skill/agent-registry redesign

## Validation

Validation for Session 118 was review/documentation-only:

- reviewed the current master task list and Session 109-117 outputs relevant to the paused/closed landscape
- reviewed the current code at the live paused-line seams and the selected runtime-tooling compatibility seam
- confirmed that Session 118 changes only:
  - `docs/refactoring/session118-major-block-reranking-review.md`
  - `docs/refactoring/ponybunny_refactor_master_task_list.md`
- made no runtime code changes
