# Session 130: Daemon Activation Line Review

## Scope

Session 130 is a documentation/review-only session.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign startup/bootstrap behavior broadly
- redesign scheduler semantics
- redesign gateway/daemon transport semantics
- redesign provider execution/fallback behavior
- redesign full subagent process lifecycle
- redesign broader daemon activation ownership by default
- change existing RPC/event/status payload shapes
- change TUI behavior

The goal is to decide whether the current daemon-owned agent activation / recurring-schedule ownership block still has one more high-value, tightly bounded, semantics-preserving slice worth doing immediately after Session 129, or whether this line should now pause and yield priority to another remaining block.

## Reviewed Sources

Reviewed documentation:

- `docs/refactoring/session128-major-block-reranking-review.md`
- `docs/refactoring/session127-agent-registry-deep-line-review.md`
- `docs/refactoring/session129-subagent-execution-capability-boundary.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`

Reviewed current code:

- `src/infra/agents/subagent-execution-boundary.ts`
- `src/infra/agents/schema-driven-agent-runner.ts`
- `src/infra/agents/subagent-process-manager.ts`
- `src/infra/scheduler/capabilities.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/scheduler-daemon/agent-scheduler.ts`
- `src/infra/agents/runner-registry.ts`

## What Session 129 Achieved

Session 129 did land the first major coding cluster cleanly.

### New execution / capability boundary

`src/infra/agents/subagent-execution-boundary.ts` now owns the first explicit live subagent execution seam:

- capability listing for agent summaries via `listAgentCapabilities(...)`
- parent-run spawn-target resolution via `startExecution(...)`
- missing/disabled configured subagent skipping
- workdir qualification before the low-level process manager is invoked
- runtime-context projection for `subagentProcesses` and `subagentHeartbeats`

Codebase grounding:

- `RegistryBackedSubagentExecutionBoundary` owns both `listAgentCapabilities(...)` and `startExecution(...)` in `src/infra/agents/subagent-execution-boundary.ts:105`
- the branch that skips subagent ticks and resolves explicit spawn targets now sits in `resolveSpawnTargets(...)` in `src/infra/agents/subagent-execution-boundary.ts:147`

### Rewiring of touched execution-path / capability call sites

The touched live callers now delegate into that boundary instead of inlining the same decisions themselves.

- `DefaultAgentExecutionEngine.execute(...)` now calls `subagentExecutionBoundary.startExecution(...)` and then reads runtime context from the returned scope before building the stage payload in `src/infra/agents/schema-driven-agent-runner.ts:373`
- `getAgentsInfo()` now calls `getGlobalSubagentExecutionBoundary().listAgentCapabilities({ ensureLoaded: true })` and maps the existing outward payload shape in `src/infra/scheduler/capabilities.ts:236`

### Reduction of inline branching in touched callers

The structural win is real:

- the execution engine no longer decides in place whether this run should spawn configured subagents or stay inactive
- the execution engine no longer qualifies spawnable targets itself
- scheduler capability reporting no longer reads the global registry directly on this path
- `ProcessSubagentManager` stays focused on process start/ready/heartbeat/shutdown once explicit targets are provided

### What remained intentionally out of scope

Session 129 did not attempt to absorb:

- full subagent process lifecycle ownership
- daemon startup/bootstrap ownership
- broader scheduler capability redesign

That limit still matters in Session 130 because the strongest remaining seams now sit right at those excluded borders.

## Current Post-129 Inventory

Only codebase-grounded candidates that still exist now are included below.

| Candidate | Current files | Why it looks plausible |
|---|---|---|
| Runner registration plus recurring-agent scheduler enablement | `src/scheduler-daemon/daemon.ts`, `src/scheduler-daemon/agent-scheduler.ts`, `src/infra/agents/runner-registry.ts` | `SchedulerDaemon.start()` still registers the schema-driven runner and conditionally enables `AgentScheduler` after startup. |
| Remaining execution/capability branching on the live path | `src/infra/agents/subagent-execution-boundary.ts`, `src/infra/agents/schema-driven-agent-runner.ts` | The boundary still owns both capability listing and execution-path decisions, so it is fair to ask whether another split remains. |
| Daemon-owned startup preparation residue adjacent to the new boundary | `src/scheduler-daemon/daemon.ts` | daemon startup still loads agents, selects main agent, reconciles cron jobs, then later wires runners and recurring dispatch. |
| Scheduler capability reporting residue | `src/infra/scheduler/capabilities.ts`, `src/infra/agents/subagent-execution-boundary.ts` | `getAgentsInfo()` still depends on the same boundary that owns subagent execution-path logic. |

## Candidate Evaluation

### 1. Runner registration plus recurring-agent scheduler enablement

Codebase evidence:

- `SchedulerDaemon.start()` still registers the schema-driven runner through the global runner registry in `src/scheduler-daemon/daemon.ts:233`
- the same method immediately constructs and enables `AgentScheduler` when `agentsEnabled` is true in `src/scheduler-daemon/daemon.ts:239`
- `AgentScheduler.dispatchOnce()` still owns recurring dispatch against the injected registry in `src/scheduler-daemon/agent-scheduler.ts:79`
- `RunnerRegistry` itself is still a thin global map in `src/infra/agents/runner-registry.ts:4`

Evaluation:

- Structural gain: medium
- Semantic risk: medium to high
- Scope tightness: only moderate
- Still true ownership/composition/boundary cleanup: yes, but it is daemon activation ownership, not the Session 129 subagent execution seam
- Drift risk: high
  - this quickly becomes daemon startup sequencing, runner availability timing, and recurring-loop activation ownership
  - it would start pulling on `RF-073` directly rather than remaining a contained `RF-074` follow-up

Judgment:

This is a real remaining cluster, but it is not the next `RF-074` slice. It belongs to the daemon-owned activation block.

### 2. Remaining execution/capability branching still duplicated on the live path

Codebase evidence:

- `DefaultAgentExecutionEngine.execute(...)` delegates to the boundary once at `src/infra/agents/schema-driven-agent-runner.ts:373`
- the boundary now owns the only live branch for `isSubagent` plus `subAgents.length === 0` in `src/infra/agents/subagent-execution-boundary.ts:147`
- missing/disabled subagent filtering is likewise boundary-owned in `src/infra/agents/subagent-execution-boundary.ts:154`

Evaluation:

- Structural gain: low
- Semantic risk: low to medium
- Scope tightness: high
- Still true ownership/composition/boundary cleanup: only weakly; the main execution-path branch is already centralized
- Drift risk: medium
  - another split here would likely just separate helper-local details inside an already-correct owner
  - or it would widen into full lifecycle ownership if it tries to go beyond target resolution

Judgment:

No meaningful duplicate live-path branching remains. Session 129 already removed the high-value duplication.

### 3. Remaining daemon-owned startup preparation residue adjacent to the new boundary

Codebase evidence:

- `SchedulerDaemon.start()` still loads agents, derives available agent ids, resolves `mainAgentId`, and runs `reconcileCronJobsFromRegistry(...)` in `src/scheduler-daemon/daemon.ts:158`
- the same method later performs runner registration and recurring-loop enablement in `src/scheduler-daemon/daemon.ts:233`

Evaluation:

- Structural gain: high
- Semantic risk: high
- Scope tightness: poor to moderate
- Still true ownership/composition/boundary cleanup: yes
- Drift risk: very high
  - this is daemon startup/bootstrap and activation choreography
  - it is exactly the area the session constraints said not to redesign broadly
  - any immediate move here would naturally become `RF-073`, not another narrow Session 129 follow-up

Judgment:

This is the strongest remaining seam in the neighborhood, but it is outside the current line. It should be handled as the next major block, not stretched into `RF-074`.

### 4. Remaining scheduler capability reporting residue

Codebase evidence:

- `getAgentsInfo()` now reads through `listAgentCapabilities(...)` in `src/infra/scheduler/capabilities.ts:236`
- `listAgentCapabilities(...)` still lives on the same boundary that also owns `startExecution(...)` in `src/infra/agents/subagent-execution-boundary.ts:113`

Evaluation:

- Structural gain: low
- Semantic risk: low
- Scope tightness: high
- Still true ownership/composition/boundary cleanup: weakly
- Drift risk: medium
  - the only obvious next move would be splitting reporting from execution inside an already explicit owner
  - that is mostly tidiness unless a second real consumer class emerges

Judgment:

This residue exists, but it is not high-value enough to justify another session now.

## Conclusion

### Should this line continue now or pause?

It should pause now.

After Session 129, there is not one more clearly high-value, tightly bounded, semantics-preserving `RF-074` slice worth doing immediately.

The key reason is not that the surrounding code is finished. The key reason is that the remaining meaningful seams now change owner class:

- the best remaining cluster is daemon activation/startup ownership in `SchedulerDaemon.start()`
- the strongest adjacent runtime residue is runner registration plus recurring-agent scheduler enablement
- the remaining work inside the new subagent boundary itself is either already centralized or only low-yield reporting/helper-local cleanup

Pushing this line one more session would likely produce one of two bad outcomes:

- a small cosmetic/helper split with low structural return
- a scope leak into daemon startup redesign, scheduler capability redesign, or broader subagent lifecycle ownership

That is the point where diminishing returns are real rather than hypothetical.

## Practical Re-Ranking

If this line pauses now, the strongest remaining live candidates are:

| Rank | Candidate | Why now |
|---|---|---|
| 1 | `RF-073` daemon-owned agent activation boundary | The live startup cluster in `SchedulerDaemon.start()` still mixes agent loading, main-agent selection, cron reconciliation, runner registration, and recurring-loop enablement. That is now the clearest remaining ownership knot. |
| 2 | Paused `RF-030` / observation residue | Still viable for a bounded design follow-up, but Session 114's diminishing-returns conclusion still looks correct. |
| 3 | Paused `RF-071` / compatibility residue | Remaining work is mostly compatibility or singleton-adjacent cleanup, not a better major block than `RF-073`. |
| 4 | Paused singleton/source-of-truth follow-ups | Real residue remains, but the current seams are broader, weaker, or too entangled to beat the daemon activation block. |

## What Should Not Be Done Next

- Do not keep splitting `subagent-execution-boundary.ts` just to separate reporting from execution without a new owner class or consumer class.
- Do not turn the next session into full subagent process lifecycle redesign around `ProcessSubagentManager`.
- Do not pull daemon startup, runner registration, cron reconciliation, and recurring dispatch into a broad bootstrap rewrite.
- Do not redesign scheduler capability payloads or `system.capabilities` output shapes.
- Do not reopen paused singleton/source-of-truth lines just because nearby globals still exist.
- Do not broaden into provider execution/fallback, transport semantics, TUI behavior, or public RPC/status payload changes.

## Recommended Session 131

Recommend exactly one next session:

Start `RF-073` with a bounded review/design session for the daemon-owned agent activation / recurring-schedule startup cluster centered on `SchedulerDaemon.start()`, with the goal of selecting one first extraction that preserves startup ordering, cron reconciliation behavior, runner availability timing, and recurring-scheduler semantics.

Why this is the right next session:

- it follows the strongest remaining ownership knot actually visible in the current code
- it avoids forcing a low-yield third `RF-074` slice
- it keeps the next coding step honest and bounded before touching daemon startup choreography

## Validation

Validation for Session 130 should remain documentation-only:

- reviewed the current code paths named above against the completed Session 129 outputs
- verified that the only files updated in this session are:
  - `docs/refactoring/session130-daemon-activation-line-review.md`
  - `docs/refactoring/ponybunny_refactor_master_task_list.md`
- no runtime code changes were made or requested
