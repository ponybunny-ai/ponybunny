# Session 128: Major-Block Re-Ranking Review

## Scope

Session 128 is a documentation/review-only session.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign startup/bootstrap behavior
- redesign scheduler semantics
- redesign gateway/daemon transport semantics
- redesign provider execution/fallback behavior
- redesign execution/runtime ownership by default
- change existing RPC/event/status payload shapes
- change TUI behavior
- perform broad package/module-boundary redesign

The goal is to identify the single best next active major block after Session 127 concluded that the agent-registry / agent-definition boundary line should pause.

## Reviewed Sources

Task/state documents reviewed:

- `docs/refactoring/ponybunny_refactor_master_task_list.md`
- `docs/refactoring/session118-major-block-reranking-review.md`
- `docs/refactoring/session120-rf071-line-review.md`
- `docs/refactoring/session121-rf036-task-ready-review.md`
- `docs/refactoring/session122-major-block-reranking-review.md`
- `docs/refactoring/session123-agent-registry-boundary-review.md`
- `docs/refactoring/session124-agent-registry-readonly-boundary.md`
- `docs/refactoring/session125-agent-registry-line-review.md`
- `docs/refactoring/session126-agent-command-submit-boundary.md`
- `docs/refactoring/session127-agent-registry-deep-line-review.md`
- `docs/refactoring/session114-rf030-line-review.md`
- `docs/refactoring/session100-source-of-truth-line-review.md`
- `docs/refactoring/session103-runtime-core-singleton-line-review.md`
- `docs/refactoring/session109-detach-capability-line-review.md`
- `docs/refactoring/session111-rf062-line-review.md`

Current code surfaces reviewed for this re-ranking:

- `src/scheduler-daemon/daemon.ts`
- `src/infra/scheduler/cron-job-reconciler.ts`
- `src/scheduler-daemon/agent-scheduler.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- `src/scheduler/composition/default-scheduler.ts`
- `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
- `src/infra/agents/subagent-process-manager.ts`
- `src/infra/agents/schema-driven-agent-runner.ts`
- `src/infra/scheduler/capabilities.ts`
- `src/gateway/rpc/agent-command-submit-goal-materializer.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `src/app/conversation/session-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`

## Current Late-Stage Landscape

### Truly closed lines

These lines still look closed in both the task table and the current code shape:

- `RF-034` scheduler composition / ownership cleanup
- gateway/daemon transport-boundary block
- `RF-059` compatibility / public-surface rationalization
- `RF-060` startup / bootstrap composition-root rationalization
- `RF-061` GatewayServer internal runtime graph / service-wiring rationalization

Why they remain closed:

- the intended ownership homes already exist
- the remaining residue in those areas is helper-local or compatibility-local, not a still-missing major owner seam
- reopening them now would be symmetry chasing or redesign drift

### Paused at diminishing returns

These lines still look correctly paused:

- `RF-030`
  - Session 113 already moved the heavy materialization/submit knot into `ConversationTaskMaterializer`
  - `SchedulerTaskBridge` now mostly holds thin observation/cancel logic, and `subscribeToProgress(...)` is still a no-op stub
- `RF-036`
  - Session 121 already showed that the remaining `task.ready` moves are either low-yield contract polish or higher-risk runtime protocol migration
- Sessions 95-100 source-of-truth line
  - the authority/projection split landed; the remaining field is mostly mirrors and compatibility residue
- Sessions 101-103 runtime-core singleton / service-locator line
  - Session 102 removed the strongest execution-boundary reach-through; the remaining singleton field is broader and less bounded
- `RF-071`
  - Session 119 landed the one high-value prompt/tool compatibility owner split; the residue is helper- and compatibility-level
- `RF-072`
  - Sessions 124 and 126 completed the two justified slices; Session 127 showed the remaining adjacent seams belong to different owner classes

### Intentionally paused after coherent first or second slices

These lines were stopped after landing the bounded slices that justified them:

- Sessions 104-109 daemon detach/unsubscribe capability
  - internal/admin detach is already present through `GatewayDaemonAttachment.detach()` and `internal.runtime.daemon.detach`
  - the remaining work is rollout, unsubscribe/protocol, or UI/reporting follow-up
- `RF-062`
  - Session 110 landed the one high-value post-`RF-061` wiring cluster
  - Session 111 correctly stopped before helper-local follow-ups
- `RF-072`
  - Session 124 moved live read-only/model-hint consumers behind `IAgentDefinitionReadAccess`
  - Session 126 moved `agent.command.submit` behind `agent-command-submit-goal-materializer.ts`
  - Session 127 correctly stopped before drifting into startup owners, execution composition, or subagent/process ownership

### Still-planned or not-yet-advanced areas that remain low priority

The task table still contains:

- `RF-024` tool mode switch
- `RF-026` tool hardening

The current code still supports leaving them low:

- `LocalToolWorker` remains the intended local-authoritative path
- no non-local tool topology has emerged that would justify either a formal tool mode switch or broader durable tool hardening

## Plausible Next Major Blocks

Only candidates supported by the current task table and the current codebase are included here.

### Candidate 1: resume `RF-030` for the post-materialization observation split

Codebase evidence:

- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts` still mixes `createGoalFromConversation(...)`, `getTaskStatus(...)`, `subscribeToProgress(...)`, and `cancelTask(...)`
- `ConversationTaskMaterializer` already owns the substantive creation/submission path

Evaluation:

- Structural gain: modest
- Semantic risk: low to medium
- Scope tightness: moderate
- Can support one large bounded coding session next: yes
- Drift into redesign risk: medium if it starts reshaping conversation lifecycle ownership
- Better than resuming other paused lines: only slightly; still weaker than the best unpromoted seam

Judgment:

Still plausible, but not the best next major block. Session 114's diminishing-returns conclusion still holds on the current code.

### Candidate 2: resume `RF-036` for the runtime-internal `task.ready` seam

Codebase evidence:

- `SchedulerCore` still publishes `task.ready`
- `LocalExecutionWorker` still consumes `task.ready`
- Session 121 already concluded the only meaningful remaining moves would spend real runtime-protocol risk budget

Evaluation:

- Structural gain: moderate
- Semantic risk: high
- Scope tightness: only moderate
- Can support one large bounded coding session next: not with favorable risk/reward
- Drift into redesign risk: high
- Better than resuming other paused lines: no

Judgment:

Not next. `RF-036` should remain fully paused.

### Candidate 3: resume broader paused lines directly (`RF-071`, source-of-truth, singleton, detach, or the just-paused `RF-072`)

Codebase evidence:

- `RF-071` residue is now behind `legacy-prompt-tooling-compatibility.ts`
- the source-of-truth residue is mostly mirrors and compatibility projections
- the broader singleton field remains diffuse after Session 102
- detach already has its bounded structural slices
- `RF-072` already extracted the two clean agent-definition consumer classes and the remaining nearby seams are different owner classes

Evaluation:

- Structural gain: low to medium depending on line
- Semantic risk: medium to high
- Scope tightness: poor in broad-line form
- Can support one large bounded coding session next: not cleanly
- Drift into redesign risk: high
- Better than other paused lines: no broad resumption beats the strongest newly isolated seam

Judgment:

These should remain paused unless one beats the current field clearly. None does.

### Candidate 4: activate a new daemon-owned agent activation / recurring-schedule ownership block

Codebase evidence:

- `SchedulerDaemon.start()` still directly:
  - loads agents from `getGlobalAgentRegistry()`
  - derives `availableAgentIds`
  - resolves the main agent with `resolveMainAgentId(...)`
  - runs `reconcileCronJobsFromRegistry(...)`
  - logs main-agent and reconciliation results
  - later registers schema runners through `getGlobalRunnerRegistry()`
  - enables `AgentScheduler` using the same registry
- `src/infra/scheduler/cron-job-reconciler.ts` is already an explicit helper, but `SchedulerDaemon.start()` still owns the surrounding activation choreography
- `src/scheduler-daemon/agent-scheduler.ts` already represents the recurring-agent dispatch runtime once activation is complete

What the seam actually is:

- daemon startup currently mixes core lifecycle start with agent-runtime activation concerns
- the activation concerns are internally coherent and daemon-owned: agent loading, main-agent selection, cron reconciliation, recurring-agent enablement, and adjacent runner activation
- this cluster is now more visible precisely because the live gateway materialization consumer and live execution-boundary consumer were already cleaned up in Sessions 124/126 and 102

Evaluation:

- Structural gain: high
- Semantic risk: medium
- Scope tightness: moderate if the first slice stays on startup preparation rather than the whole activation cluster
- Can support one large bounded coding session next: yes
- Drift into redesign risk: controllable if the first slice preserves ordering, logging, and daemon-owned semantics
- Better than resuming paused lines: yes

Judgment:

This is the strongest remaining major block.

### Candidate 5: activate a new runner-registration / execution-composition residue block

Codebase evidence:

- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` still builds `RegistryBackedLocalExecutionAgentTickResolver(getGlobalAgentRegistry(), getGlobalRunnerRegistry())`
- `src/scheduler/composition/default-scheduler.ts` still carries the same default fallback
- `LocalExecutionAdapter` itself no longer reads globals directly after Session 102

Evaluation:

- Structural gain: low to medium
- Semantic risk: medium to high
- Scope tightness: only moderate
- Can support one large bounded coding session next: yes, but the payoff is limited
- Drift into redesign risk: high because it quickly becomes execution/runtime-owner cleanup rather than one bounded refactor slice
- Better than resuming other paused lines: not convincingly

Judgment:

Real residue, but weaker than the daemon-owned activation knot. The highest-value execution-boundary slice already landed in Session 102.

### Candidate 6: activate a new subagent/process ownership block

Codebase evidence:

- `ProcessSubagentManager` still defaults its `registryProvider` to `getGlobalAgentRegistry()`
- `SchemaDrivenAgentRunner` still defaults to `new ProcessSubagentManager()`
- `startSubagents(...)` resolves definitions, derives workdirs, and spawns child processes in one flow

Evaluation:

- Structural gain: medium
- Semantic risk: medium to high
- Scope tightness: moderate
- Can support one large bounded coding session next: maybe
- Drift into redesign risk: high because the seam is directly tied to execution-time process ownership
- Better than resuming other paused lines: not clearly

Judgment:

Important longer-term seam, but not the best next block. It is more behavior-adjacent than the daemon activation cluster and less ready for a first bounded session.

### Candidate 7: pull the remaining reporting/default-factory residue

Codebase evidence:

- `src/infra/scheduler/capabilities.ts` still loads agents through the global registry for `getAgentsInfo()`
- already-extracted boundaries still retain global default factories

Evaluation:

- Structural gain: low
- Semantic risk: low to medium
- Scope tightness: high
- Can support one large bounded coding session next: yes
- Drift into redesign risk: low
- Better than resuming other paused lines: no, because the payoff is too small

Judgment:

Not a major block. This is cleanup residue, not the best next line.

## Selected Next Block

### Decision

The single best next major block to activate is:

**a new daemon-owned agent activation / recurring-schedule ownership line centered on `SchedulerDaemon.start()` and its adjacent agent-runtime activation seams.**

### What the current problematic seam/block is

The live problematic seam is the daemon-owned agent activation cluster that still sits inline inside `src/scheduler-daemon/daemon.ts`.

Today that startup path owns too many agent-runtime concerns in one method:

- agent registry loading
- available-agent discovery
- main-agent resolution
- cron-job reconciliation kickoff
- runner registration
- recurring-agent scheduler enablement
- startup logging around those steps

The issue is not that any single one of those concerns is misplaced outside the daemon. The issue is that the daemon start method still mixes base process startup with a concentrated agent-runtime activation block that now stands out as its own owner seam.

### Where it lives

Primary concentration:

- `src/scheduler-daemon/daemon.ts`

Adjacent supporting surfaces:

- `src/infra/scheduler/cron-job-reconciler.ts`
- `src/scheduler-daemon/agent-scheduler.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`

### Why now is the right time

Why this block is stronger now than it was earlier:

- Session 102 already removed the highest-value live execution-boundary registry reach-through, so the remaining execution-composition residue is no longer the best first target
- Sessions 124 and 126 already extracted the two clean live agent-definition consumer classes, so the remaining agent-registry adjacency now points away from `RF-072` and toward daemon-owned activation
- closed `RF-060` / `RF-061` work means the surrounding startup and GatewayServer graph seams have already been rationalized enough that this daemon-local concentration can now be addressed as its own block rather than through broader composition-root work

This makes the daemon activation cluster the strongest remaining late-stage seam that is still:

- structurally real
- more than reporting/default-factory polish
- safer than resuming `RF-036`
- more valuable than resuming `RF-030`
- less diffuse than resuming broader singleton or source-of-truth lines

### Why it beat the other candidates

Why it beats resuming `RF-030`:

- `RF-030` now offers only a thinner observation split in `SchedulerTaskBridge`
- the daemon activation knot is materially larger and still concentrated in one live owner path

Why it beats resuming `RF-036`:

- `RF-036` now requires protocol-risk budget to achieve real structural change
- the daemon activation block can start with ownership extraction while preserving current startup, runtime, and payload semantics

Why it beats resuming `RF-071`, source-of-truth, singleton, detach, or `RF-072`:

- those lines are already at diminishing returns in their current form
- broad resumption would reopen diffuse fields rather than target one concentrated seam
- `RF-072` specifically should stay paused because Session 127 already showed that the remaining nearby surfaces are startup/runtime owners, execution composition, subagent/process ownership, or low-yield residue rather than a third agent-definition consumer slice

Why it beats runner-registration/execution-composition as a separate block:

- the direct live execution-boundary reach-through was already fixed in Session 102
- the remaining shared resolver defaults are weaker and more execution-semantics-adjacent than the daemon startup activation knot

Why it beats subagent/process ownership:

- the subagent seam is real but more behavior-adjacent
- the daemon activation cluster has a cleaner first slice that can stay inside daemon-owned startup preparation without touching child-process or execution semantics

### Safest first slice

The safest first slice is:

**extract a daemon-owned agent startup preparation boundary that owns only:**

- loading agents from the registry
- deriving the available agent IDs
- resolving the effective main agent ID
- running cron reconciliation
- returning/logging the resulting activation summary

Why this is the safest first slice:

- it preserves the existing startup order inside `SchedulerDaemon.start()`
- it does not redesign runner registration, execution composition, or AgentScheduler behavior yet
- it does not change RPC, IPC, scheduler, event, or TUI semantics
- it is already a coherent subcluster inside the current start method
- it produces a meaningful owner seam without forcing a full startup/bootstrap redesign

What should explicitly stay out of the first slice:

- changing `createDefaultSchedulerDaemonRuntime(...)`
- changing `createDefaultScheduler(...)`
- changing `LocalExecutionAgentTickResolver` behavior
- changing `ProcessSubagentManager` or subagent lifecycle
- changing `agent.command.submit`
- changing payload shapes, startup ordering, or recurring-agent semantics

## What Is Not Next

The next session should explicitly not be:

- resuming the just-paused agent-registry line by default
- resuming paused lines without a stronger case than the selected daemon activation block
- broad package/module-boundary redesign
- broad naming-only or cleanup-only work
- speculative future capability work not grounded in the current codebase

More specifically:

- do not reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- do not resume `RF-036` by default
- do not resume `RF-030`, `RF-071`, source-of-truth, singleton, detach, or `RF-072` without a stronger concrete case than this selected block
- do not turn Session 129 into runner/execution redesign, startup redesign, or subagent/process redesign under a broader banner

## Recommended Session 129

Recommend exactly one next session:

**Session 129 should be one bounded coding session for the selected daemon-owned agent activation / recurring-schedule ownership block.**

Why coding rather than one more design session:

- the concentration is already clear in `SchedulerDaemon.start()`
- the safest first slice is already narrow and codebase-grounded
- the first move can be implemented as owner extraction while preserving current sequencing and behavior
- another design-only pass would mostly restate boundaries that are already visible in the current code

## Practical Roadmap For The Selected Block

### Phase 1

Extract the daemon-owned startup-preparation boundary for agent loading, main-agent selection, and cron reconciliation.

### Phase 2

If Phase 1 lands cleanly and still leaves one coherent knot, evaluate whether runner registration plus recurring-agent scheduler enablement forms one bounded second slice.

### Phase 3

Re-review the line immediately after the first coding slice rather than assuming a larger multi-session campaign.

## Validation

Validation for Session 128 was review/documentation-only:

- reviewed the current master task list and the completed Session 118-127 outputs listed above
- re-read the live code paths in `src/scheduler-daemon/daemon.ts`, `src/infra/scheduler/cron-job-reconciler.ts`, `src/scheduler-daemon/agent-scheduler.ts`, `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`, `src/scheduler/composition/default-scheduler.ts`, `src/infra/agents/subagent-process-manager.ts`, `src/infra/scheduler/capabilities.ts`, and the current `RF-072` boundary files
- confirmed this session makes no runtime code changes
- confirmed the session should change documentation only
