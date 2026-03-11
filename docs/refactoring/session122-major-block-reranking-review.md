# Session 122: Major-Block Re-Ranking Review

## Scope

Session 122 is a bounded documentation/review session only.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign scheduler semantics
- redesign execution-worker behavior
- redesign replay/checkpoint/event-store/audit semantics
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport semantics
- change provider execution/fallback behavior
- change existing RPC/event/status payload shapes
- change TUI behavior
- perform broad package/module-boundary redesign

The goal is to identify the single best next major block to activate after Session 121 confirmed `RF-036` should remain fully paused.

## Reviewed Sources

Task/state documents reviewed:

- `docs/refactoring/ponybunny_refactor_master_task_list.md`
- `docs/refactoring/session109-detach-capability-line-review.md`
- `docs/refactoring/session111-rf062-line-review.md`
- `docs/refactoring/session114-rf030-line-review.md`
- `docs/refactoring/session118-major-block-reranking-review.md`
- `docs/refactoring/session120-rf071-line-review.md`
- `docs/refactoring/session121-rf036-task-ready-review.md`
- `docs/refactoring/session100-source-of-truth-line-review.md`
- `docs/refactoring/session103-runtime-core-singleton-line-review.md`

Current code surfaces reviewed for this re-ranking:

- `src/app/conversation/session-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- `src/scheduler/composition/default-scheduler.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `src/runtime/workers/execution-worker.ts`
- `src/scheduler/core/scheduler.ts`
- `src/infra/prompts/legacy-prompt-tooling-compatibility.ts`
- `src/autonomy/react-integration.ts`
- `src/app/lifecycle/planning/planning-service.ts`
- `src/app/conversation/response-generator.ts`
- `src/infra/scheduler/capabilities.ts`

## Current Late-Stage Landscape

### Truly closed lines

These lines still look closed in both the task table and the current code shape:

- `RF-034` scheduler composition / ownership cleanup
- gateway/daemon transport-boundary block
- `RF-059` compatibility / public-surface rationalization
- `RF-060` startup/bootstrap composition-root rationalization
- `RF-061` GatewayServer internal runtime graph / service-wiring rationalization

Why they still look closed:

- the intended ownership homes already exist in the codebase
- the remaining residue in those areas is helper-local polish, outward rollout, or compatibility cleanup rather than one more strong structural seam
- reopening them now would be symmetry chasing or naming churn rather than a better bounded refactor block

### Paused at diminishing returns

These lines still look intentionally paused for good reason:

- `RF-030`
  - Session 113 already moved the real mixed-owner knot into `ConversationTaskMaterializer`
  - `SchedulerTaskBridge` now mostly carries thin observation/cancel surface, and `subscribeToProgress(...)` is still a no-op stub
- `RF-036`
  - Session 121 confirmed the remaining `task.ready` work is either low-yield typing/classification polish or a materially riskier runtime protocol migration
- Sessions 95-100 source-of-truth line
  - effective-model authority and compatibility projection boundaries already landed
  - the remaining pressure is mostly TUI/transport/persistence mirror residue
- Sessions 101-103 broader singleton/service-locator line
  - Session 102 already removed the strongest live execution-boundary registry reach-through
  - the remaining field is real, but broad-line resumption still risks drifting into startup, gateway wiring, or source-of-truth redesign
- `RF-071`
  - Session 119 already landed the one strong prompt/tool compatibility owner extraction
  - the remaining candidates are compatibility residue or singleton-adjacent drift

### Intentionally paused after a coherent first slice

These lines were paused after landing a real first slice that now has weaker follow-ups:

- Sessions 104-109 daemon detach/unsubscribe capability block
  - internal/admin detach now exists through `GatewayDaemonAttachment.detach()` plus `internal.runtime.daemon.detach`
  - the remaining work is rollout, unsubscribe/protocol, or UI/reporting follow-up
- `RF-062`
  - Session 110 landed the one clearly valuable post-`RF-061` wiring cluster
  - Session 111 correctly stopped before helper-internal cleanup disguised as another major block

### Remaining planned/not-yet-advanced lines

The task table still contains the older tool lines:

- `RF-024` tool mode switch
- `RF-026` tool hardening

Current code still supports the earlier reasons not to advance them:

- `LocalToolWorker` remains the intended local authoritative path
- no non-local tool topology has emerged that would justify a formal mode switch or broader durable tool-worker hardening

### Live unpromoted seam still visible in the current codebase

One still-concentrated seam is not yet an active line:

- direct global agent-registry access on live read/materialization paths

Current code evidence:

- `SessionManager.getAgentModelHint(...)` still calls `getGlobalAgentRegistry().getAgent(...)`
- `WorkloadModelResolver.getAgentModelHint(...)` still calls `getGlobalAgentRegistry().getAgent(...)`
- `agent.command.submit` in `goal-handlers.ts` still calls `getGlobalAgentRegistry()`, loads agents, and reads the selected agent definition directly before goal materialization
- `default-daemon-runtime.ts` and `default-scheduler.ts` still create `RegistryBackedLocalExecutionAgentTickResolver` directly from `getGlobalAgentRegistry()` and `getGlobalRunnerRegistry()`
- `SchedulerDaemon.start()` still loads agents from the global registry and registers runners through the global runner registry

This is not one broad package-redesign claim. It is a real concentration of process-global agent-definition access that still crosses conversation model-hint reads, provider-manager model-hint reads, gateway request materialization, and scheduler/daemon composition.

## Plausible Next Major Blocks

Only candidates supported by the current codebase and current task table are included here.

### Candidate 1: resume `RF-030` for a post-materialization observation split

Codebase evidence:

- `SchedulerTaskBridge` still combines `createGoalFromConversation(...)`, `getTaskStatus(...)`, `cancelTask(...)`, and `subscribeToProgress(...)`
- `ConversationTaskMaterializer` already owns the substantive creation/submission path

Evaluation:

- Structural gain: modest
- Semantic risk: low to medium
- Scope tightness: moderate
- One bounded coding session next: yes
- Drift into redesign risk: medium if it starts altering conversation lifecycle ownership
- Better than paused lines? No. It is the cleanest paused-line second slice, but still smaller than the strongest remaining unpromoted seam

Judgment:

Still plausible, but not the best next major block.

### Candidate 2: resume `RF-036` for the runtime-internal `task.ready` seam

Codebase evidence:

- `SchedulerCore` still publishes `task.ready`
- `LocalExecutionWorker` still subscribes to `task.ready`
- Session 121 already concluded there is no high-value middle ground between harmless polish and riskier protocol migration

Evaluation:

- Structural gain: moderate
- Semantic risk: high
- Scope tightness: only moderate
- One bounded coding session next: not with favorable risk/reward
- Drift into redesign risk: high
- Better than paused lines? No. Session 121 already showed the remaining moves are either too weak or too risky

Judgment:

Not next. `RF-036` should remain fully paused.

### Candidate 3: resume the broader source-of-truth or singleton lines directly

Codebase evidence:

- `SessionManager` and `WorkloadModelResolver` still read the global agent registry
- `goal-handlers.ts` still reads the global agent registry on a live RPC path
- `SchedulerDaemon.start()` and the scheduler/daemon composition helpers still reach global registries

Evaluation:

- Structural gain: potentially medium
- Semantic risk: medium to high
- Scope tightness: poor in broad-line form
- One bounded coding session next: not cleanly
- Drift into redesign risk: high because the broad lines touch TUI mirrors, startup, provider resolution, gateway wiring, and compatibility policy
- Better than paused lines? Not as broad resumptions

Judgment:

The broad paused lines should not resume as-is. Their remaining field is too diffuse.

### Candidate 4: resume detach/unsubscribe follow-up

Codebase evidence:

- `GatewayDaemonAttachment.detach()` exists
- `internal.runtime.daemon.detach` is already wired
- no public/TUI control-plane rollout exists yet

Evaluation:

- Structural gain: low to medium
- Semantic risk: medium
- Scope tightness: moderate
- One bounded coding session next: yes, but mostly rollout/protocol/UI-facing work
- Drift into redesign risk: medium to high
- Better than paused lines? No. The remaining work is intentionally not the best structural refactor target

Judgment:

Not next.

### Candidate 5: start `RF-024` or `RF-026`

Codebase evidence:

- `LocalToolWorker` still represents the intended local authoritative path
- the current codebase still lacks a justified non-local tool topology

Evaluation:

- Structural gain: low right now
- Semantic risk: medium
- Scope tightness: moderate
- One bounded coding session next: technically yes, but weakly justified
- Drift into redesign risk: medium to high
- Better than paused lines? No

Judgment:

These remain lower priority than both the best paused-line second slice and the selected block below.

### Candidate 6: activate a new agent-registry access / agent-definition boundary block

Codebase evidence:

- `SessionManager` still performs direct global agent-definition reads only to derive the session preferred-model hint
- `WorkloadModelResolver` still performs the same direct global agent-definition read only to derive the workload model hint
- `agent.command.submit` still loads agents and reads the selected agent definition directly from the global registry before constructing workdir/policy/materialization context
- scheduler/daemon composition still instantiate registry-backed agent-tick helpers directly from globals
- `SchedulerDaemon.start()` still mixes startup lifecycle with direct registry loading and runner registration

What the seam actually is:

- multiple live consumers still depend on process-global agent-definition access
- but those consumers do not all need the same kind of ownership
- some are read-only metadata/model-hint consumers
- some are startup/runtime activation owners
- some are gateway materialization consumers

That split is currently implicit rather than explicit.

Evaluation:

- Structural gain: high
- Semantic risk: low to medium if the first slice stays read-only and avoids startup/runtime semantics
- Scope tightness: good for the first slice, weaker only if it broadens into full registry removal
- One bounded coding session next: potentially yes, but only after one more boundary-clarification pass
- Drift into redesign risk: controllable if startup loading, runner registration, transport semantics, and provider fallback are explicitly kept out of scope
- Better than paused lines? Yes. It isolates one still-concentrated live seam from the broader paused singleton/source-of-truth field without reopening those broader lines wholesale

Judgment:

This is the strongest remaining candidate.

## Selected Next Major Block

### Choice

Activate a new major block for explicit agent-registry access / agent-definition boundary cleanup.

### What the problematic seam is

The live seam is not “all remaining globals.” It is the narrower split between:

- read-only agent-definition consumers that only need model hints or agent metadata
- gateway request-materialization consumers that need loaded agent definitions to build one goal/work-item request
- startup/runtime activation owners that legitimately own agent loading, cron reconciliation, and runner registration

Today those concerns still collapse onto direct `getGlobalAgentRegistry()` and `getGlobalRunnerRegistry()` usage across:

- `src/app/conversation/session-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- `src/scheduler/composition/default-scheduler.ts`

### Why now is the right time

Why this beats the current alternatives now:

- `RF-036` was just re-reviewed and still has no safe meaningful slice
- `RF-030` has a bounded but smaller second slice
- `RF-071` has already reached compatibility-residue territory
- the broad source-of-truth and singleton lines still should remain paused in broad form, but this codebase now shows one narrower sub-seam inside that field that is concentrated enough to promote

This makes it the best risk/reward move after Session 121 rather than a speculative future capability.

### Why it is better than resuming paused lines

Compared with resuming paused lines directly:

- better than `RF-036` because it avoids runtime event protocol migration risk
- better than `RF-030` because the structural payoff is larger than splitting a now-thin observation bridge
- better than resuming Sessions 95-100 because it avoids TUI/transport mirror semantics
- better than resuming Sessions 101-103 as a broad line because it isolates one concentrated sub-seam instead of reopening diffuse singleton cleanup
- better than detach/public rollout follow-up because it is still structural ownership cleanup rather than protocol/UI rollout
- better than `RF-062` or gateway-wiring follow-up because it does not need to reopen closed GatewayServer runtime graph work
- better than `RF-024`/`RF-026` because it is supported by current live code pressure, not deferred topology work

### Safest first slice

The safest first slice is not immediate code movement across all of those call sites.

The safest first slice is:

- define one explicit read-only agent-definition/model-hint boundary
- classify which current call sites are true read-only consumers versus true startup/runtime owners
- choose one first coding cluster limited to the read-only/model-hint side

That likely means the first coding cluster after design should target:

- `SessionManager` preferred-model hint reads
- `WorkloadModelResolver` agent-model-hint reads

while explicitly leaving these out of the first coding slice:

- daemon startup agent loading and cron reconciliation
- runner registration
- gateway transport/public payload behavior
- provider execution/fallback semantics
- `agent.command.submit` materialization semantics until the read-only boundary is proven

## What Is Not Next

The next step is not:

- resuming `RF-036` by default
- resuming paused lines without a stronger case than the selected block
- broad package/module-boundary redesign
- broad naming-only or cleanup-only work
- speculative tool-topology or detach/public-rollout work not justified by the current code
- broad startup/bootstrap rewrite
- broad gateway/runtime graph rewiring

More specifically:

- do not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- do not force another `RF-030` session just for symmetry
- do not restart the broad source-of-truth or singleton lines as umbrella efforts
- do not treat helper wrapping around existing globals as enough by itself unless it lands a real ownership boundary

## Recommended Session 123

Recommend exactly one next session:

Session 123 should be one more design session for the new agent-registry access / agent-definition boundary block.

Why design first instead of coding immediately:

- the current seam is strong enough to promote, but it still spans three distinct concern types: read-only metadata/model-hint consumers, gateway materialization consumers, and startup/runtime activation owners
- forcing a coding session first would risk sliding into startup/bootstrap, gateway wiring, or broad singleton cleanup
- one bounded design pass can define the safe first coding cluster precisely and keep the line inside semantics-preserving ownership cleanup

## Short Phased Roadmap

### Phase 1

Session 123: design the explicit boundary, classify current call sites, and choose the first read-only coding cluster.

### Phase 2

First coding session after that: extract the read-only model-hint consumer boundary for `SessionManager` and `WorkloadModelResolver` without changing runtime semantics.

### Phase 3

Reassess whether gateway `agent.command.submit` should consume the same boundary or stay on a separate loaded-definition seam, while keeping startup loading and runner registration out of scope unless a later review shows another bounded gain.

## Validation

Validation for Session 122 was review-only:

- reviewed the current master task list and the Session 100, 103, 109, 111, 114, 118, 120, and 121 outputs
- inspected the live paused-line seams in `SchedulerTaskBridge`, `SchedulerCore`, and `LocalExecutionWorker`
- inspected the current global agent/runner registry call sites in `SessionManager`, `WorkloadModelResolver`, `goal-handlers.ts`, `SchedulerDaemon`, `default-daemon-runtime.ts`, and `default-scheduler.ts`
- confirmed this session required no runtime code changes

## Files Changed

- `docs/refactoring/session122-major-block-reranking-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`
