# Session 123: Agent-Registry Boundary Review

## Scope

Session 123 is a bounded documentation/review session only.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign scheduler semantics
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport semantics
- redesign provider execution/fallback behavior
- change RPC/event/status payload shapes
- change TUI behavior
- perform broad package/module-boundary redesign

The goal is to define the explicit boundary for the next major block around agent-registry access, classify current call sites by ownership type, and choose exactly one safest first coding cluster.

## Reviewed Sources

Required sources reviewed:

- `docs/refactoring/session122-major-block-reranking-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`
- `src/app/conversation/session-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- `src/scheduler/composition/default-scheduler.ts`

Immediately adjacent files reviewed to classify the seam correctly:

- `src/infra/agents/agent-registry.ts`
- `src/infra/agents/runner-registry.ts`
- `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
- `src/infra/scheduler/capabilities.ts`
- `src/infra/agents/subagent-process-manager.ts`

## Current Seam

The live problem is not one vague "global registry problem." The current seam is that `getGlobalAgentRegistry()` and, secondarily, `getGlobalRunnerRegistry()` still act as mixed access points for materially different concerns:

1. read-only agent-definition consumers that only need model hints or lightweight metadata
2. gateway request-materialization consumers that need a loaded agent definition in order to create goal/work-item context
3. startup/runtime owners that legitimately load agents, reconcile cron schedules, and register/resolve runners

Those concerns are currently crossing through the same global surfaces:

- `SessionManager` reads a selected agent's runner config only to compute a preferred model hint
- `WorkloadModelResolver` reads an agent's runner config only to fold an agent model hint into effective-model resolution
- `agent.command.submit` loads agents and then reads a full definition to materialize goal/work-item context
- scheduler/daemon composition still constructs `RegistryBackedLocalExecutionAgentTickResolver` from global registries
- `SchedulerDaemon.start()` both loads agents for cron reconciliation and registers schema runners into the global runner registry
- `getAgentsInfo()` in scheduler capabilities also reads the global agent registry for a compatibility/reporting surface

The issue is therefore mixed ownership at the access point, not merely the existence of a singleton.

## Call-Site Classification

### 1. Read-only model-hint / metadata consumers

These call sites read a narrow subset of agent-definition data and do not own agent loading, request creation, runner registration, or activation:

- `src/app/conversation/session-manager.ts`
  - `resolvePreferredModelSelectionForSession(...)` reads `activeAgentId`, then calls `getAgentModelHint(...)`
  - `getAgentModelHint(...)` calls `getGlobalAgentRegistry().getAgent(agentId)` and only reads `runner.config.model` / `runner.config.model_hint`
  - this is a read-only model-hint consumer, not a startup owner and not a gateway materializer
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
  - `getAgentModelHint(...)` calls `getGlobalAgentRegistry().getAgent(workloadId)` and only reads the same runner-config hint fields
  - this is also a read-only model-hint consumer
- `src/infra/scheduler/capabilities.ts`
  - `getAgentsInfo()` loads and lists agents for a capability/reporting surface
  - this is not part of the safest first slice because it still triggers `loadAgents(...)`, but it is useful evidence that the global registry is also serving compatibility/read surfaces beyond runtime ownership

### 2. Request-materialization consumers

These call sites legitimately need a loaded definition because they derive runtime request context from the definition body:

- `src/gateway/rpc/handlers/goal-handlers.ts`
  - `agent.command.submit` calls `registry.loadAgents(...)`, resolves `definition`, and uses that definition to derive:
  - agent display/name for goal/work-item titles
  - `definition_hash`
  - workdir via `ensureAgentWorkdir(...)`
  - effective tool policy allow/deny data
  - approval policy flags
  - `policy_snapshot`
  - route context metadata
  - this is a request-materialization consumer, not just a model-hint reader

### 3. Startup/runtime activation owners

These call sites own runtime activation concerns and should not be pulled into the first slice:

- `src/scheduler-daemon/daemon.ts`
  - `start()` calls `registry.loadAgents(...)`
  - uses loaded agents to derive the available/main agent set
  - invokes `reconcileCronJobsFromRegistry(...)`
  - passes the loaded registry into `AgentScheduler`
  - these are true startup/runtime ownership responsibilities
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
  - constructs `RegistryBackedLocalExecutionAgentTickResolver(getGlobalAgentRegistry(), getGlobalRunnerRegistry())`
  - this is composition for runtime execution activation, not a read-only metadata access
- `src/scheduler/composition/default-scheduler.ts`
  - retains the fallback composition path that constructs the same registry-backed resolver when no resolver is injected
  - this is composition/runtime ownership residue, not a read-only consumer
- `src/infra/agents/subagent-process-manager.ts`
  - still defaults its registry provider to `getGlobalAgentRegistry()`
  - this sits closer to runtime execution ownership than to read-only metadata access and should stay out of the first slice

### 4. Runner-registration owners

These call sites are specifically about runner availability and should remain out of scope for the first cut:

- `src/scheduler-daemon/daemon.ts`
  - `getGlobalRunnerRegistry()`
  - `runnerRegistry.register('default', schemaRunner)`
  - `runnerRegistry.register('market_listener', schemaRunner)`
  - this is explicit runner-registration ownership
- `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
  - `RegistryBackedLocalExecutionAgentTickResolver` consumes both agent and runner registries to answer execution-time definition/runner questions
  - this is a runtime execution boundary, not a read-only metadata/model-hint boundary

### 5. Compatibility/global access residue

These call sites are useful residue markers but are not the safest first coding cluster:

- `src/infra/scheduler/capabilities.ts`
  - compatibility/reporting read path that opportunistically loads agents
- `src/scheduler/composition/default-scheduler.ts`
  - fallback global composition path preserved for compatibility/default assembly
- `src/infra/agents/subagent-process-manager.ts`
  - default registry-provider fallback

## Where The Mixed Access Happens

`getGlobalAgentRegistry()` is currently doing all of the following:

- read-only model-hint lookup for conversation/provider-manager consumers
- loaded-definition lookup for gateway request materialization
- startup-time agent loading and cron reconciliation
- runtime execution support through registry-backed resolver creation
- compatibility/reporting reads

`getGlobalRunnerRegistry()` is currently doing all of the following:

- scheduler/daemon composition fallback for execution-time runner resolution
- daemon startup runner registration

That is why a cosmetic wrapper around the globals would be insufficient. The codebase needs a boundary that separates ownership classes, not merely a renamed accessor.

## Plausible First Slices

Only slices supported by the current codebase are evaluated here.

### Slice A: Explicit read-only agent-definition/model-hint boundary

Definition:

- introduce a narrow read-only boundary for model-hint and lightweight agent metadata access
- first consumers would be `SessionManager` and `WorkloadModelResolver`
- do not include `agent.command.submit`
- do not include daemon startup, scheduler composition, runner registration, or resolver wiring

Evaluation:

- Structural gain: good
  - separates the cleanest low-risk consumers from startup/runtime ownership
  - creates a real ownership boundary instead of one more direct global read
- Semantic risk: low
  - current reads are narrow and derived from already-loaded definitions
  - does not require changing goal materialization or startup sequencing
- Scope tightness: high
  - two concrete call sites in one concern class
- True ownership/composition/boundary cleanup: yes
  - it isolates read-only metadata access from runtime owners
- Drift risk: low
  - does not require startup/bootstrap redesign
  - does not require gateway/runtime rewiring
  - does not require broad singleton cleanup

Judgment:

This is the strongest first slice.

### Slice B: Narrow loaded-definition boundary for gateway materialization

Definition:

- introduce an explicit gateway-facing access boundary for `agent.command.submit`
- boundary would own loading/reading a full enabled agent definition for request materialization

Evaluation:

- Structural gain: medium
  - would make the gateway materialization seam more explicit
- Semantic risk: medium
  - `agent.command.submit` derives workdir, policy, route context, approval flags, and definition hash
  - this is broader than simple read-only metadata access
- Scope tightness: moderate
  - single call site, but it is a dense one
- True ownership/composition/boundary cleanup: yes
  - but it is request materialization, not the cleanest low-risk first cut
- Drift risk: medium
  - can easily slide into gateway wiring redesign or into bundling materialization with startup access concerns

Judgment:

Plausible later phase, but not the safest first coding session.

### Slice C: Startup/runtime owner boundary

Definition:

- introduce an explicit startup/runtime owner boundary around agent loading, cron reconciliation, execution resolver composition, and/or runner registration

Evaluation:

- Structural gain: medium to high
  - these are real ownership sites
- Semantic risk: high
  - touches daemon startup order, scheduler composition, execution activation, and runner availability
- Scope tightness: poor
  - spans `daemon.ts`, daemon bootstrap, scheduler composition, and runner registry use
- True ownership/composition/boundary cleanup: yes
  - but much broader than this block should start with
- Drift risk: high
  - very likely to become startup/bootstrap redesign, runtime-graph rewiring, or broad singleton cleanup

Judgment:

Not a safe first slice.

## Selected Safest First Slice

The safest first slice is:

**an explicit read-only agent-definition/model-hint boundary**

### The current problematic seam

The current seam is that read-only model-hint consumers are still reaching through the same global registry surface that startup/runtime owners use for agent loading, cron reconciliation, execution resolver composition, and runner registration. That keeps a low-risk metadata concern artificially coupled to higher-risk runtime ownership.

### In-scope call sites for the first slice

- `src/app/conversation/session-manager.ts`
  - session preferred-model/model-hint lookup only
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
  - workload model-hint lookup only

These are the only clearly safe first consumers because both only need narrow runner-config hint data and neither owns agent loading or request materialization.

### Out-of-scope call sites for the first slice

- `src/gateway/rpc/handlers/goal-handlers.ts`
  - `agent.command.submit` stays out because it needs a loaded definition for request materialization
- `src/scheduler-daemon/daemon.ts`
  - stays out because it owns startup loading, cron reconciliation, runner registration, and agent scheduler activation
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
  - stays out because it is runtime execution composition
- `src/scheduler/composition/default-scheduler.ts`
  - stays out because it is compatibility/runtime composition fallback
- `src/runtime/execution-boundary/local-execution-agent-tick-resolver.ts`
  - stays out because it is execution-time definition/runner resolution
- `src/infra/scheduler/capabilities.ts`
  - stays out because it is compatibility/reporting residue, not the highest-value first cluster
- `src/infra/agents/subagent-process-manager.ts`
  - stays out because it is closer to runtime execution ownership than to simple read-only model-hint access

### Boundary to introduce first

The first boundary should be a narrow read-only access surface that answers questions in the shape of:

- get model hint for an agent/workload id
- optionally get lightweight agent metadata only if a current read-only consumer actually needs it

The important design property is not the exact name. The important property is that the boundary is explicitly read-only and intentionally does not own:

- `loadAgents(...)`
- full request materialization
- cron reconciliation
- runner registration
- execution-time runner resolution

### Why this is the right first cut

- it isolates the cleanest concern class first
- it produces a real ownership boundary rather than a wrapper around the singleton
- it preserves current startup/bootstrap and gateway materialization semantics
- it avoids forcing request-materialization and startup ownership into the same session
- it gives the new block a small coding cluster with low semantic risk and clear stop conditions

## What Is Not Next

The next session should explicitly not do any of the following:

- broad singleton/global cleanup
- broad startup/bootstrap rewrite
- broad gateway/runtime graph rewiring
- reopening `RF-036` by default
- forcing gateway materialization and startup ownership into the same first slice
- cosmetic wrapping of globals without a real ownership boundary

Also not next:

- moving `agent.command.submit` into the first coding cluster
- changing daemon startup ordering or cron reconciliation ownership
- changing runner registration ownership
- broad compatibility cleanup in `src/infra/scheduler/capabilities.ts`

## Practical Phased Roadmap

### Phase 1

Introduce one explicit read-only agent-definition/model-hint access boundary and migrate:

- `SessionManager`
- `WorkloadModelResolver`

### Phase 2

Re-review whether gateway request materialization should get its own loaded-definition boundary:

- `agent.command.submit`

Only proceed if that stays separate from startup/runtime ownership.

### Phase 3

Re-review startup/runtime ownership only if Phase 1 and any Phase 2 boundary make the remaining ownership seam materially clearer:

- daemon startup loading
- cron reconciliation ownership
- scheduler/daemon execution resolver composition
- runner registration ownership

## Recommended Session 124

Recommend exactly one next session:

**one bounded coding session for the first read-only/model-hint slice**

Target:

- add the explicit read-only agent-definition/model-hint access boundary
- migrate `SessionManager`
- migrate `WorkloadModelResolver`

Constraints for Session 124:

- no runtime-semantic changes
- no gateway materialization migration
- no daemon/bootstrap changes
- no runner-registration changes
- no broad singleton cleanup

## Session Outcome

Session 123 defines the new block as a boundary-cleanup line with three distinct concern classes, rejects bundling them together, and selects the read-only model-hint/metadata side as the single safest first coding cluster.
