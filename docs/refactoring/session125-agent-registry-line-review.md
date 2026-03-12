# Session 125: Agent-Registry Line Review

## Scope

Session 125 is a bounded documentation/review session only.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign startup/bootstrap behavior
- redesign scheduler semantics
- redesign gateway/daemon transport semantics
- redesign provider execution/fallback behavior
- redesign gateway request materialization broadly
- redesign runner registration ownership
- change RPC/event/status payload shapes
- change TUI behavior

The goal is to decide whether `RF-072` still has exactly one more high-value, tightly bounded, semantics-preserving slice after Session 124, or whether the line should pause now and yield priority.

## Reviewed Sources

Reviewed documentation:

- `docs/refactoring/session122-major-block-reranking-review.md`
- `docs/refactoring/session123-agent-registry-boundary-review.md`
- `docs/refactoring/session124-agent-registry-readonly-boundary.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`

Reviewed current code:

- `src/infra/agents/agent-definition-read-access.ts`
- `src/app/conversation/session-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/infra/scheduler/capabilities.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- `src/scheduler/composition/default-scheduler.ts`
- `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
- `src/infra/agents/subagent-process-manager.ts`
- `src/infra/agents/schema-driven-agent-runner.ts`
- `src/scheduler-daemon/agent-scheduler.ts`

## What Session 124 Achieved

Session 124 completed the first major coding cluster selected in Session 123.

What it concretely achieved in the current tree:

- `src/infra/agents/agent-definition-read-access.ts` now defines the explicit narrow read-only boundary:
  - `IAgentDefinitionReadAccess`
  - `IReadOnlyAgentDefinitionView`
  - `RegistryBackedAgentDefinitionReadAccess`
  - `getGlobalAgentDefinitionReadAccess()`
- `src/app/conversation/session-manager.ts` now reads preferred-model agent metadata through `IAgentDefinitionReadAccess` instead of reading the global registry directly.
- `src/infra/llm/provider-manager/agent-model-resolver.ts` now reads workload model-hint metadata through the same boundary instead of reading the global registry directly.
- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts` now wires `SessionManager` through that explicit read-only boundary on the default bootstrap path.

What Session 124 intentionally preserved:

- gateway request materialization in `src/gateway/rpc/handlers/goal-handlers.ts`
- startup loading, cron reconciliation, and runner registration ownership in `src/scheduler-daemon/daemon.ts`
- runtime execution resolver composition in `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- compatibility fallback composition in `src/scheduler/composition/default-scheduler.ts`
- runtime/subagent execution ownership adjacent to `src/infra/agents/subagent-process-manager.ts`

Most importantly, the first in-scope read-only consumer class is now exhausted on the live runtime paths reviewed in Sessions 123-124:

- there are no remaining direct `getGlobalAgentRegistry()` reads in `SessionManager`
- there are no remaining direct `getGlobalAgentRegistry()` reads in `WorkloadModelResolver`
- the remaining global-registry consumers are now different ownership classes

## Current Post-124 Inventory

### Remaining direct or adjacent agent-definition consumers that actually exist now

1. Gateway request materialization
   - `src/gateway/rpc/handlers/goal-handlers.ts`
   - `agent.command.submit` still loads agents from the global registry, reads the enabled definition, derives workdir/tool/policy/route context, and sends that materialized request to the scheduler daemon.

2. Compatibility/reporting read surface
   - `src/infra/scheduler/capabilities.ts`
   - `src/gateway/rpc/handlers/system-handlers.ts`
   - `getAgentsInfo()` still loads and lists agent summaries for `system.capabilities` and `system.status`.

3. Daemon startup/runtime ownership
   - `src/scheduler-daemon/daemon.ts`
   - startup still loads agents, selects the main agent, reconciles cron jobs, registers schema runners, and starts `AgentScheduler` against the loaded registry.

4. Runtime composition fallback and activation-owner seams
   - `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
   - `src/scheduler/composition/default-scheduler.ts`
   - `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
   - these paths still compose or consume registry-backed execution resolution for runtime execution ownership.

5. Runtime/subagent execution seam
   - `src/infra/agents/subagent-process-manager.ts`
   - `src/infra/agents/schema-driven-agent-runner.ts`
   - `ProcessSubagentManager` still defaults its registry provider to `getGlobalAgentRegistry()` and resolves enabled subagent definitions before spawning processes.

### Notable non-candidates

- `src/cli/commands/agent.ts` still uses agent definitions, but it constructs local `AgentRegistry()` instances rather than participating in the mixed live global/runtime ownership seam that activated `RF-072`.
- `src/scheduler-daemon/agent-scheduler.ts` still reads agent definitions, but it already receives a daemon-owned injected registry and therefore reflects runtime ownership, not the unresolved access-boundary seam.

## Candidate Evaluation

### Candidate A: gateway-owned loaded-definition/materialization boundary for `agent.command.submit`

Codebase evidence:

- `src/gateway/rpc/handlers/goal-handlers.ts` still does all of the following in one live RPC path:
  - choose the agent id from request params or runtime config
  - call `getGlobalAgentRegistry().loadAgents(...)`
  - read the loaded definition
  - reject missing/disabled agents
  - derive effective tools
  - derive agent workdir
  - build `agent_tick` route/policy/approval context
  - call `remoteSchedulerClient.materializeGoal(...)`

Evaluation:

- Structural gain: high
  - this is the last remaining non-startup, non-runtime-owner direct global loaded-definition read on a live gateway request-materialization path
  - extracting it would make the gateway materialization owner explicit instead of leaving it collapsed into the RPC handler plus global registry access
- Semantic risk: medium
  - the path is dense and must preserve default-agent selection, disabled-agent rejection, workdir derivation, tool allow/deny handling, approval flags, `policy_snapshot`, and `routeContext`
  - however, those semantics are already localized to one handler and are covered by targeted tests
- Scope tightness: good
  - one RPC path
  - one new gateway-owned helper/boundary
  - no need to touch daemon startup, scheduler execution, or runner registration
- True ownership/composition/boundary cleanup: yes
  - this is still exactly agent-definition access / request-materialization cleanup
  - it does not require startup/bootstrap or scheduler redesign if kept narrow
- Drift risk: controllable
  - only if the session stays limited to `agent.command.submit`
  - drift begins if it tries to absorb `goal.submit`, remote scheduler transport concerns, or broader gateway runtime assembly

Judgment:

This is the single strongest remaining candidate inside `RF-072`.

### Candidate B: compatibility/reporting read surface around `getAgentsInfo()`

Codebase evidence:

- `src/infra/scheduler/capabilities.ts` still calls `getGlobalAgentRegistry()`
- it conditionally calls `loadAgents(...)` and returns lightweight summaries
- `src/gateway/rpc/handlers/system-handlers.ts` consumes that path for `system.capabilities` and `system.status`

Evaluation:

- Structural gain: low
  - this is a thin reporting surface, not a central ownership knot
- Semantic risk: low to medium
  - the reporting path currently relies on lazy loading and current agent summary shape
- Scope tightness: high
  - but it is tightly scoped mostly because it is small, not because it unlocks a large structural gain
- True ownership/composition/boundary cleanup: weak
  - this is more compatibility/reporting residue than a high-value access-boundary split
- Drift risk: medium
  - it can easily slide into CLI/discovery/reporting cleanup rather than finishing the active line

Judgment:

Real residue, but too low-yield to be the next session.

### Candidate C: daemon startup loading / cron reconciliation / runner registration cluster

Codebase evidence:

- `src/scheduler-daemon/daemon.ts` still:
  - loads agents
  - derives available/main agent ids
  - calls `reconcileCronJobsFromRegistry(...)`
  - registers schema runners into the global runner registry
  - starts `AgentScheduler` with the loaded registry

Evaluation:

- Structural gain: medium to high
  - these are real ownership sites
- Semantic risk: high
  - startup order, cron reconciliation, runner availability, and daemon activation are all involved
- Scope tightness: poor
  - this would span startup, registry loading, cron ownership, and runner registration together
- True ownership/composition/boundary cleanup: yes
  - but it is now clearly startup/runtime-owner cleanup rather than one more narrow access-boundary slice
- Drift risk: high
  - this would reopen startup/bootstrap rationalization and runner ownership work that this session was instructed not to resume

Judgment:

Not a justified next slice for Session 126.

### Candidate D: runtime composition fallback around the registry-backed agent-tick resolver

Codebase evidence:

- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` still constructs `RegistryBackedLocalExecutionAgentTickResolver(getGlobalAgentRegistry(), getGlobalRunnerRegistry())`
- `src/scheduler/composition/default-scheduler.ts` still retains the compatibility fallback that constructs the same resolver when no resolver is injected
- `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts` remains the runtime-facing resolver contract

Evaluation:

- Structural gain: low to medium
  - there is still some composition residue, but the highest-value execution-boundary split already landed in Session 102
- Semantic risk: medium to high
  - this sits directly on execution activation and scheduler composition
- Scope tightness: only moderate
  - a helper/factory extraction could stay small, but the payoff would also be smaller
- True ownership/composition/boundary cleanup: partial
  - it is more runtime-core/singleton/bootstrap residue than a clean continuation of the read/materialization boundary line
- Drift risk: high
  - this would pull `RF-072` toward paused singleton work and closed startup/bootstrap work

Judgment:

Too close to paused runtime-owner cleanup to justify continuing here.

### Candidate E: subagent-process registry fallback

Codebase evidence:

- `src/infra/agents/subagent-process-manager.ts` still defaults `registryProvider` to `getGlobalAgentRegistry()`
- `startSubagents(...)` resolves enabled subagent definitions before deriving workdir and spawning child processes
- `src/infra/agents/schema-driven-agent-runner.ts` still defaults `DefaultAgentExecutionEngine` to `new ProcessSubagentManager()`

Evaluation:

- Structural gain: low to medium
  - it would remove one more default global access point
- Semantic risk: medium
  - it is directly tied to subagent spawning, workdir selection, and execution-time process lifecycle
- Scope tightness: moderate
  - the initial seam is narrow, but the dependencies are execution-adjacent
- True ownership/composition/boundary cleanup: partial
  - this is closer to runtime execution/process ownership than to the current access-boundary cleanup goal
- Drift risk: high
  - it would slide toward execution/runtime singleton cleanup or runner/process ownership redesign quickly

Judgment:

Not the best next move for this line.

## Conclusion

### Answer to the primary questions

1. After Session 124, is there still one more high-value, tightly bounded slice worth doing now inside this line?

Yes.

2. If yes, what is the single best next target?

One gateway-owned loaded-definition / request-materialization boundary limited to `agent.command.submit`.

3. Should this line pause now?

Not yet. It should stay active for exactly one more bounded session, then be re-reviewed immediately.

### Why this line should continue for one more slice

Session 124 already exhausted the safest read-only consumer class. That means most of the remaining tree is now either:

- low-yield compatibility/reporting residue
- or true startup/runtime-owner code that this session should not reopen

`agent.command.submit` is the one remaining candidate that still combines:

- real structural payoff
- acceptable semantic risk
- good scope tightness
- a clean ownership split that still belongs to the active line

It is also the last remaining live path where gateway request materialization still reaches directly through global loaded-definition access rather than through an explicit boundary.

### Why this should be the last slice before another pause review

If Session 126 lands this gateway materialization boundary cleanly, the remaining `RF-072` surfaces would mostly be:

- startup/runtime owners in `daemon.ts`
- runtime composition fallback in `default-daemon-runtime.ts` and `default-scheduler.ts`
- low-yield compatibility/reporting residue in `capabilities.ts`
- execution-adjacent subagent/runtime seams

At that point the line should be re-reviewed again rather than automatically extended.

## What Should Not Be Done Next

- Do not bundle `goal.submit` into the `agent.command.submit` follow-up just because both call `remoteSchedulerClient.materializeGoal(...)`.
- Do not widen the next slice into daemon startup loading, cron reconciliation, or runner registration.
- Do not touch `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`, `src/scheduler/composition/default-scheduler.ts`, or `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts` under the banner of `RF-072`.
- Do not turn `getAgentsInfo()` or CLI agent listing into the main continuation target.
- Do not widen the line into subagent execution/process-lifecycle cleanup.
- Do not change RPC/event/status payload shapes, TUI behavior, or scheduler submission semantics.
- Do not treat broad singleton/global-registry removal as the goal of Session 126.

## Recommended Session 126

Recommend exactly one next session:

Complete one bounded coding/design session that introduces a gateway-owned loaded-agent-definition/materialization boundary for `agent.command.submit` only.

That session should:

- load and validate the enabled agent definition behind one explicit gateway-facing seam
- derive the current `agent_tick` materialization inputs behind that same seam
- rewire only `agent.command.submit` to use it
- preserve current runtime-config default-agent selection, workdir/policy/approval/route-context derivation, remote scheduler handoff, and payload shapes

That session should stop short of:

- `goal.submit`
- scheduler capabilities reporting
- daemon startup/bootstrap ownership
- scheduler composition fallback
- runner registration
- subagent execution ownership

## Validation

Validation for Session 125 was review-oriented:

- reviewed the current Session 123-124 outputs and the live code paths listed above
- searched the tree for remaining direct `getGlobalAgentRegistry()` / `loadAgents(...)` / `getAgent(...)` consumers
- confirmed that the first read-only consumer class migrated in Session 124 is now exhausted
- confirmed that this session made no runtime code changes
