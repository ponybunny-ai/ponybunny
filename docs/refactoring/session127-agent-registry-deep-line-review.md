# Session 127: Agent-Registry Deep Line Review

## Scope

Session 127 is a documentation/review-only session.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign startup/bootstrap behavior
- redesign scheduler semantics
- redesign gateway/daemon transport semantics
- redesign provider execution/fallback behavior
- redesign runner registration ownership by default
- redesign daemon startup activation ownership by default
- redesign subagent execution/process ownership by default
- change RPC/event/status payload shapes
- change TUI behavior

The goal is to perform a full-depth post-Session-126 review of the active `RF-072` line, classify all materially relevant remaining agent-registry / runner-registry / loaded-definition seams adjacent to that line, and decide whether one more bounded Session 128 slice still exists or whether the line should now pause.

## Reviewed Sources

Reviewed documentation:

- `docs/refactoring/session122-major-block-reranking-review.md`
- `docs/refactoring/session123-agent-registry-boundary-review.md`
- `docs/refactoring/session124-agent-registry-readonly-boundary.md`
- `docs/refactoring/session125-agent-registry-line-review.md`
- `docs/refactoring/session126-agent-command-submit-boundary.md`
- `docs/refactoring/session114-rf030-line-review.md`
- `docs/refactoring/session120-rf071-line-review.md`
- `docs/refactoring/session100-source-of-truth-line-review.md`
- `docs/refactoring/session103-runtime-core-singleton-line-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`

Reviewed current code:

- `src/app/conversation/session-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/infra/agents/agent-definition-read-access.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/gateway/rpc/agent-command-submit-goal-materializer.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`
- `src/scheduler/composition/default-scheduler.ts`
- `src/runtime/execution-boundary/local-execution-adapter.ts`
- `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
- `src/infra/scheduler/capabilities.ts`
- `src/infra/scheduler/cron-job-reconciler.ts`
- `src/scheduler-daemon/agent-scheduler.ts`
- `src/infra/agents/subagent-process-manager.ts`
- `src/infra/agents/schema-driven-agent-runner.ts`
- `src/infra/agents/agent-registry.ts`
- `src/infra/agents/runner-registry.ts`

## What This Line Already Cleaned Up

Sessions 124 and 126 did complete the two clean consumer classes that justified activating `RF-072`.

### 1. Read-only metadata / model-hint consumers moved behind the read boundary

Session 124 introduced `src/infra/agents/agent-definition-read-access.ts` and moved the first real read-only consumers behind it:

- `SessionManager` now gets agent model-hint data through `IAgentDefinitionReadAccess`
- `WorkloadModelResolver` now gets workload model-hint data through the same boundary
- `default-conversation-bootstrap.ts` now wires the default `SessionManager` through that read boundary

This removed direct global agent-registry reads from the live conversation/provider-manager model-hint path without touching startup, execution, or daemon ownership.

### 2. `agent.command.submit` moved behind the gateway-owned loaded-definition / materialization boundary

Session 126 introduced `src/gateway/rpc/agent-command-submit-goal-materializer.ts` and moved the mixed loaded-definition / materialization flow out of `goal-handlers.ts`.

That boundary now owns:

- effective agent-id selection for the RPC path
- registry-backed load/validate of the enabled definition
- workdir, tool allow/deny, approval, `policy_snapshot`, and `routeContext` derivation
- the remote scheduler materialization handoff for `agent.command.submit`

This means the live gateway request-materialization consumer class has already been extracted into its explicit owner seam.

### 3. Ownership classes intentionally left untouched by this line

Sessions 124 and 126 intentionally did not absorb:

- daemon startup loading, main-agent selection, and cron reconciliation
- runner registration ownership
- execution-time resolver composition and scheduler fallback wiring
- system capability/status reporting reads
- subagent execution/process-lifecycle ownership

Those remain real surfaces, but they are not the same concern class as the two completed `RF-072` slices.

## Current Post-126 Inventory

The remaining materially relevant seams adjacent to this line now break down as follows.

| Seam | Current files | Ownership class | Structural gain | Semantic risk | Scope tightness | Still belongs to `RF-072`? | Current judgment |
|---|---|---|---|---|---|---|---|
| Registry-backed implementation inside the new gateway materializer | `src/gateway/rpc/agent-command-submit-goal-materializer.ts` | gateway loaded-definition materialization consumer, but already boundary-owned | low | medium | medium | only weakly | not a justified third slice |
| Agent summary reporting for `system.capabilities` / `system.status` | `src/infra/scheduler/capabilities.ts`, `src/gateway/rpc/handlers/system-handlers.ts` | compatibility/reporting residue | low | low to medium | high | weakly | document and exclude |
| Startup load, main-agent selection, cron reconciliation | `src/scheduler-daemon/daemon.ts`, `src/infra/scheduler/cron-job-reconciler.ts`, `src/scheduler-daemon/agent-scheduler.ts` | startup/runtime activation owner | medium to high | high | poor | no | out of scope for this line |
| Runner registration plus execution-time resolver composition/fallback | `src/scheduler-daemon/daemon.ts`, `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`, `src/scheduler/composition/default-scheduler.ts`, `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts` | runner-registration owner plus execution-time resolver composition seam | low to medium | medium to high | only moderate | no | out of scope for this line |
| Subagent definition lookup before child-process spawn | `src/infra/agents/subagent-process-manager.ts`, `src/infra/agents/schema-driven-agent-runner.ts` | subagent/runtime ownership seam | medium | medium to high | moderate | no | out of scope for this line |
| Global default access fallbacks behind already-extracted boundaries | `src/infra/agents/agent-definition-read-access.ts`, `src/app/conversation/session-manager.ts`, `src/infra/llm/provider-manager/agent-model-resolver.ts` | singleton/composition residue | low | low to medium | medium | only indirectly | low-yield residue, not next |

## Seam-By-Seam Review

### A. Registry-backed implementation inside `agent-command-submit-goal-materializer.ts`

Current state:

- `goal-handlers.ts` no longer performs direct agent-registry reads for `agent.command.submit`
- the new materializer still uses a registry-backed implementation (`loadAgents(...)` + `getAgent(...)`) and the default factory still builds it from `getGlobalAgentRegistry()`

Evaluation:

- Structural gain from another extraction: low
  - the ownership problem that justified Session 126 is already solved
  - the remaining direct registry calls are now an implementation detail inside the explicit gateway-owned boundary
- Semantic risk: medium
  - this path still owns default-agent selection, enabled-agent validation, workdir/policy derivation, and scheduler materialization handoff
- Scope tightness: only moderate
  - a third slice would mostly introduce one more helper or access interface under the same owner
- Ownership clarity: already materially improved
  - splitting registry-backed load/lookup out again would not create a new owner class
- Whether it still belongs to this line: only weakly
  - it is no longer a cross-owner boundary problem
- Drift risk: medium
  - it can quickly become constructor/interface churn for little structural payoff

Conclusion:

This is the most tempting local continuation, but it is not strong enough. Session 126 already extracted the real seam. A third slice here would mostly hide `loadAgents(...)` / `getAgent(...)` behind one more helper without clarifying ownership further.

### B. `system.capabilities` / `system.status` agent summary reads

Current state:

- `getAgentsInfo()` still calls the global registry, lazily loads agents, and returns summary metadata
- `system-handlers.ts` consumes that path for capability/status reporting

Evaluation:

- Structural gain: low
  - this is a reporting surface, not a live orchestration/materialization knot
- Semantic risk: low to medium
  - the reporting path is shallow, but it still relies on current lazy-load behavior and current summary shape
- Scope tightness: high
  - but the payoff is correspondingly small
- Ownership clarity: mostly already acceptable as compatibility/reporting
- Whether it belongs to this line: only weakly
  - this is residue, not the active consumer class that activated `RF-072`
- Drift risk: medium
  - it can easily turn into status/reporting cleanup rather than agent-definition boundary work

Conclusion:

Real residue, but not worth a full Session 128. This should be documented and explicitly excluded.

### C. Daemon startup load / main-agent selection / cron reconciliation

Current state:

- `SchedulerDaemon.start()` still loads agents from the global registry
- the daemon still selects the main agent and runs `reconcileCronJobsFromRegistry(...)`
- `AgentScheduler` and `CronJobReconciler` then consume the injected registry as startup/runtime owners

Evaluation:

- Structural gain: medium to high
  - these are real ownership sites
- Semantic risk: high
  - startup order, cron lifecycle, and daemon activation are all involved
- Scope tightness: poor
  - the logic spans load timing, main-agent selection, registry state, cron job reconciliation, and daemon activation
- Ownership clarity: already points away from `RF-072`
  - these are startup/runtime owners, not boundary consumers awaiting extraction
- Whether it belongs to this line: no
- Drift risk: very high
  - this would reopen startup/bootstrap composition and daemon activation work that the current session was instructed not to resume

Conclusion:

This is a true owner seam and should stay out of this line.

### D. Runner registration and execution-time resolver composition

Current state:

- `SchedulerDaemon.start()` still registers schema runners into the global runner registry
- `createDefaultSchedulerDaemonRuntime(...)` and the fallback inside `createDefaultScheduler(...)` still compose `RegistryBackedLocalExecutionAgentTickResolver(getGlobalAgentRegistry(), getGlobalRunnerRegistry())`
- `LocalExecutionAdapter` itself no longer reads globals directly; Session 102 already cleaned that seam

Evaluation:

- Structural gain: low to medium
  - Session 102 already landed the actual high-value execution-boundary extraction
  - what remains is composition-root/fallback residue
- Semantic risk: medium to high
  - this touches execution activation, fallback behavior, and runner availability timing
- Scope tightness: only moderate
  - a helper/factory extraction could stay small, but its payoff would also be small
- Ownership clarity: this is runtime execution composition, not live agent-definition read/materialization cleanup
- Whether it belongs to this line: no
- Drift risk: high
  - this would drift into paused singleton/runtime-core cleanup or closed startup/bootstrap work

Conclusion:

This should not be the third `RF-072` slice. It is the wrong ownership class.

### E. Subagent definition lookup and process spawn ownership

Current state:

- `ProcessSubagentManager` still defaults its registry provider to `getGlobalAgentRegistry()`
- `startSubagents(...)` resolves enabled subagent definitions before deriving workdir and spawning child processes
- `DefaultAgentExecutionEngine` still defaults to `new ProcessSubagentManager()`

Evaluation:

- Structural gain: medium
  - this is a real global default seam
- Semantic risk: medium to high
  - it is tied directly to subagent lifecycle, child-process spawn, workdir selection, and execution-time behavior
- Scope tightness: moderate
  - the first seam is narrow, but the ownership context is not
- Ownership clarity: this is runtime execution/process ownership, not a read/materialization consumer
- Whether it belongs to this line: no
- Drift risk: high
  - it would reopen subagent/runtime ownership and execution-process composition by the back door

Conclusion:

Important adjacency, but not an `RF-072` continuation target.

### F. Global default fallbacks behind already-extracted boundaries

Current state:

- `getGlobalAgentDefinitionReadAccess()` is still the default factory
- `SessionManager` and `WorkloadModelResolver` still default to that global read boundary when not explicitly injected
- `createDefaultAgentCommandSubmitGoalMaterializer()` still defaults to `getGlobalAgentRegistry()`

Evaluation:

- Structural gain: low
  - the direct consumer cleanup already landed
- Semantic risk: low to medium
  - removing the defaults would require constructor churn through composition and compatibility paths
- Scope tightness: medium
  - but the result would mostly be DI plumbing, not a new access-boundary win
- Ownership clarity: this is now singleton/composition residue
- Whether it belongs to this line: only indirectly
- Drift risk: high
  - this would slide into the already-paused singleton/runtime-composition field

Conclusion:

These are legitimate residues, but they are not the next move for this line.

## Primary Questions Answered

### 1. After Sessions 124 and 126, what seams still remain?

The remaining seams are:

- registry-backed implementation detail inside the new gateway materializer
- capability/status reporting reads
- daemon startup loading, main-agent selection, and cron reconciliation
- runner registration and execution-time resolver composition/fallback
- subagent definition lookup and process-spawn ownership
- default global fallback composition behind already-extracted boundaries

### 2. Which seams are valid continuation targets versus owners/residue/adjacency?

- Valid bounded continuation targets: none strong enough to justify another session
- True startup/runtime owners: daemon startup loading, main-agent selection, cron reconciliation, `AgentScheduler`, runner registration
- Execution/runtime ownership seams: `default-daemon-runtime.ts`, `default-scheduler.ts`, `local-execution-agent-tick-resolver.ts`, `subagent-process-manager.ts`, `schema-driven-agent-runner.ts`
- Low-yield compatibility residue: `getAgentsInfo()` in scheduler capabilities, global default factories/default constructor fallbacks behind the already-extracted boundaries
- Adjacency that should not be absorbed into this line: subagent process ownership, runner-registration ownership, daemon activation ownership

### 3. Is there exactly one more justified bounded coding slice left?

No.

The line has now exhausted the two real consumer classes that justified activation:

- read-only metadata/model-hint consumers
- one live gateway loaded-definition/materialization consumer

What remains is either owner code or low-yield residue. There is no third slice that still offers strong structural payoff without drifting into startup/bootstrap redesign, scheduler composition redesign, execution/runtime ownership redesign, or broader singleton cleanup.

### 4. Should this line pause now?

Yes.

This is the point of diminishing returns for `RF-072`.

## All Remaining Issues Found In Or Adjacent To This Line

### Justified next-slice candidate

- None. The only tempting local follow-up is splitting the registry-backed implementation inside `RegistryBackedAgentCommandSubmitGoalMaterializer`, but Session 126 already created the real owner boundary and another extraction would mostly be helper/interface churn.

### Too risky / wrong ownership class

- `src/scheduler-daemon/daemon.ts` startup agent loading, main-agent selection, and cron reconciliation entrypoint
- `src/infra/scheduler/cron-job-reconciler.ts` plus `src/scheduler-daemon/agent-scheduler.ts` daemon-owned runtime scheduling surfaces
- `src/scheduler-daemon/daemon.ts` runner registration through `getGlobalRunnerRegistry()`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`, `src/scheduler/composition/default-scheduler.ts`, and `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts` execution-time resolver composition/fallback
- `src/infra/agents/subagent-process-manager.ts` plus `src/infra/agents/schema-driven-agent-runner.ts` subagent/process-lifecycle ownership

### Low-yield residue

- `src/infra/scheduler/capabilities.ts` agent summary reporting for `system.capabilities` / `system.status`
- `src/gateway/rpc/agent-command-submit-goal-materializer.ts` still being registry-backed internally after Session 126
- `src/infra/agents/agent-definition-read-access.ts`, `src/app/conversation/session-manager.ts`, and `src/infra/llm/provider-manager/agent-model-resolver.ts` still carrying global default fallbacks behind the now-explicit read boundary

### Future-watchlist only

- If a future daemon startup/runtime ownership block is activated, re-evaluate `SchedulerDaemon.start()` plus cron reconciliation and runner registration together rather than piecemeal
- If a future runtime-core/singleton block is reactivated, re-evaluate the default scheduler/daemon resolver composition and the default global access factories together as composition-root residue
- If a future subagent/runtime ownership block is activated, re-evaluate `ProcessSubagentManager` default registry access together with `DefaultAgentExecutionEngine` construction rather than treating it as standalone registry cleanup

## What Should Not Be Done Next

- Do not force a third `RF-072` slice just to hide `loadAgents(...)` / `getAgent(...)` behind one more helper inside `agent-command-submit-goal-materializer.ts`.
- Do not bundle `goal.submit` or broader gateway materialization cleanup into this line.
- Do not reopen daemon startup loading, main-agent selection, cron reconciliation, or runner registration under the banner of agent-definition boundary cleanup.
- Do not pull `default-daemon-runtime.ts`, `default-scheduler.ts`, or `local-execution-agent-tick-resolver.ts` back into scope as if they were still unresolved read/materialization consumers.
- Do not turn capability/status reporting cleanup into the next session just because it still reads agent summaries.
- Do not widen the line into subagent execution/process-lifecycle cleanup.
- Do not resume the paused source-of-truth or singleton lines indirectly through constructor/default-factory churn in `SessionManager`, `WorkloadModelResolver`, or the gateway materializer.

## Practical Re-Ranking After Pausing This Line

With `RF-072` paused, the broader remaining candidates still look like this:

1. No paused line should be resumed blindly.
   - `RF-036` remains fully paused after Session 121 because the remaining `task.ready` work is higher-risk protocol/runtime migration territory.
   - `RF-030` remains paused after Session 114 because its remaining observation split is smaller and lower-yield.
   - `RF-071` remains paused after Session 120 because the residue is mostly compatibility/helper cleanup.
   - the broader source-of-truth and singleton lines remain real but still too diffuse to reopen without a fresh selection pass.
2. The best next move is therefore another major-block re-ranking review, not a forced third `RF-072` extraction.

## Recommended Session 128

Recommend exactly one next session:

**run a fresh major-block re-ranking review using the post-127 codebase state, rather than continuing `RF-072`.**

Why this is better than forcing one more `RF-072` slice:

- `RF-072` has already consumed its two clean, high-value consumer classes
- the remaining adjacent surfaces are owner seams or low-yield residue
- a third slice would either be weak helper churn or would drift into startup/bootstrap, scheduler composition, execution/runtime ownership, runner registration, or singleton cleanup
- the project now needs a fresh comparison across the paused remaining themes instead of pretending this line is still the best available next move

## Validation

Validation for Session 127 was review-oriented:

- reviewed the current Session 123-126 outputs and the live code paths listed above
- searched the tree for remaining `getGlobalAgentRegistry()` / `getGlobalRunnerRegistry()` / `loadAgents(...)` / `getAgent(...)` / runner-registration call sites adjacent to this line
- confirmed that the read-only/model-hint consumers migrated in Session 124 remain behind `IAgentDefinitionReadAccess`
- confirmed that `goal-handlers.ts` now delegates `agent.command.submit` through the Session 126 gateway materializer boundary
- confirmed that this session makes no runtime code changes and is documentation-only
