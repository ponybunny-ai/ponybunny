# ADR-001: GoalHarness Composition Over SchedulerCore

**Status:** implemented (Phases 1-4 verified, Phase 5 complete 2026-03-28)
**Date:** 2026-03-28
**Deciders:** Architecture session
**Scope:** Goal lifecycle unification across all execution paths

---

## Context

PonyBunny has two independent execution engines that each hold a subset of the required goal lifecycle capabilities. Neither provides the full lifecycle on its own.

### AutonomyDaemon (src/autonomy/daemon.ts, ~190 lines)

Provides harness lifecycle stages: elaborate, plan, execute, verify, evaluate. Injects GlobalKnowledgeService pitfalls during elaboration.

Missing: budget tracking, error pattern retry, escalation blocking, metrics emission, the 15-type event system, model selection, 4-lane execution, quality gate control, pause/resume.

### SchedulerCore (src/scheduler/core/scheduler.ts, ~1400 lines)

Provides all production execution infrastructure: budget enforcement, retry with error pattern detection, escalation, metrics, events, model selection, lane-based concurrency, quality gates, pause/resume, and lifecycle state management.

Missing: elaboration, GlobalKnowledgeService injection, plan-before-execute.

### Three goal paths, three different treatments

| Entry point | Elaboration | Knowledge injection | Budget/retry/events |
|---|---|---|---|
| main.ts (AutonomyDaemon) | Yes | Yes | No |
| Gateway goal.submit | No | No | Yes |
| CLI `pb work` | Yes | Yes | No |

No path receives both harness lifecycle and production infrastructure. This is the core problem.

### Gateway path detail

The gateway's `goal.submit` handler creates a stub "analysis" work item and sends it directly to SchedulerCore, bypassing AutonomyDaemon's elaborate-plan-execute lifecycle entirely. Goals submitted via the gateway never receive GlobalKnowledgeService pitfall injection or proper planning. This gap is documented in CLAUDE.md failure patterns.

---

## Decision

Create a **GoalHarness** layer that composes over SchedulerCore. GoalHarness owns the pre-execution lifecycle (elaboration, knowledge injection, plan generation). SchedulerCore owns execution and all production infrastructure. Every goal path routes through GoalHarness before reaching SchedulerCore.

```
All Entry Points --> GoalHarness (elaborate --> plan) --> SchedulerCore (execute + all infra)
```

GoalHarness wraps SchedulerCore; it does not extend or modify it.

---

## Interface Contract

```typescript
interface GoalSubmission {
  title: string;
  description: string;
  success_criteria: Goal['success_criteria'];
  priority?: number;
  budget_tokens?: number;
  budget_time_minutes?: number;
  budget_cost_usd?: number;
  context?: Record<string, unknown>;
}

interface GoalHarnessResult {
  goal: Goal;
  elaborationApplied: boolean;
  planGenerated: boolean;
  workItemCount: number;
  escalations: string[];
  delegatedToScheduler: boolean;
}

interface IGoalHarness {
  submitGoal(submission: GoalSubmission): Promise<GoalHarnessResult>;
  cancelGoal(goalId: string): Promise<void>;
}
```

GoalHarness delegates execution via `ISchedulerCore.submitGoal(goal: Goal): Promise<void>`, which is the existing SchedulerCore interface defined in `src/scheduler/core/types.ts`. That interface is not modified.

---

## GoalHarness Internal Sequence

1. Create Goal record in repository.
2. Elaborate via ElaborationService -- inject GlobalKnowledgeService pitfalls, validate success criteria.
3. If escalations are raised, block the goal and return result with `delegatedToScheduler: false`.
4. Plan via PlanningService -- generate WorkItem DAG from elaborated goal.
5. Mark goal status `active`.
6. Delegate to `ISchedulerCore.submitGoal()`.

GoalHarness is stateless. It has no polling loop, no timers, no internal scheduling. Polling responsibility belongs to the caller (HarnessDaemon or gateway handler).

---

## Migration Phases

### Phase 1: Create GoalHarness (new files only)

New files:
- `src/harness/goal-harness-interface.ts` -- IGoalHarness, GoalSubmission, GoalHarnessResult
- `src/harness/goal-harness.ts` -- GoalHarness implementation
- `src/harness/harness-daemon.ts` -- polling replacement for AutonomyDaemon
- `src/harness/index.ts` -- barrel exports

Zero modifications to existing files. All existing tests must remain green.

### Phase 2: Wire into scheduler-daemon's materialize_goal path

Modified files:
- `src/scheduler-daemon/daemon.ts` -- accept optional GoalHarness dependency, route through it in materialize_goal handler
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` -- assemble GoalHarness with its dependencies

When GoalHarness is active, the gateway's stub "analysis" work item (initialWorkItemSpec) is not created. PlanningService generates real work items instead.

### Phase 3: Replace main.ts AutonomyDaemon with HarnessDaemon

Modified:
- `src/main.ts` -- use HarnessDaemon (polling loop + GoalHarness) instead of AutonomyDaemon

### Phase 4: Deprecate and remove AutonomyDaemon ✅ (2026-03-28)

Removed `src/autonomy/daemon.ts`, deprecated export from `src/public.ts`, and two dedicated test files. Updated CLAUDE.md failure pattern, architecture-discovery.md, and gateway comment. No external consumers affected. Test count: 1897 (was 1905; delta = 8 tests in deleted files).

### Phase 5: Add post-goal evaluation hook ✅ (2026-03-28)

PostGoalEvaluator subscribes to SchedulerCore's `goal_completed` and `goal_failed` events. For each completed goal, evaluates every work item's final run via EvaluationService and produces a GoalEvaluationReport. Wired into both HarnessDaemon (main.ts) and SchedulerDaemon entry points. The `replan` decision path is logged as unactionable (no replanning infrastructure exists). Test count: 1925 (was 1897; +22 unit + 6 integration).

---

## Key Sub-Decisions

1. **GoalHarness wraps SchedulerCore, does not extend it.** This preserves ~1400 lines of tested execution code without modification risk.

2. **When GoalHarness is active, the gateway's initialWorkItemSpec stub is ignored.** PlanningService generates real work items, replacing the stub path.

3. **GoalHarness is stateless.** No polling, no timers. Polling responsibility stays with the caller (HarnessDaemon or gateway request handler). This makes GoalHarness testable without concurrency concerns.

4. **Post-execution evaluation is deferred to Phase 5.** SchedulerCore already has retry and escalation. EvaluationService's "replan" capability has no working implementation today; adding it prematurely would create dead code.

5. **Feature flag via optional dependency.** The scheduler-daemon can run with or without GoalHarness injected. When GoalHarness is absent, behaviour is unchanged (the current stub path). This allows safe rollback at Phase 2.

---

## Invariants

1. Every goal passes through elaboration before work items are created.
2. Every work item executes through SchedulerCore (budget, retry, events, quality gates).
3. GoalHarness never performs execution.
4. SchedulerCore never performs elaboration or planning.
5. Gateway RPC contract is unchanged.
6. All existing tests remain green at each migration phase.
7. `ISchedulerCore` interface (src/scheduler/core/types.ts) is not modified.
8. GlobalKnowledgeService injection is available in all goal paths.
9. Audit trail continuity is preserved -- no goal or work item records are lost or silently redirected.

---

## Consequences

### Positive

- Every goal path gets both elaboration and production execution infrastructure.
- GlobalKnowledgeService pitfall injection becomes universal, not path-dependent.
- SchedulerCore remains unchanged, reducing regression risk.
- AutonomyDaemon's ~190 lines of incomplete infrastructure can be removed rather than extended.
- Stateless GoalHarness is straightforward to test in isolation.
- Optional injection allows incremental rollout with rollback safety.

### Negative

- Planning latency is added to the gateway path. Goal submission currently returns fast; with GoalHarness it waits for LLM-driven planning (estimated 5-30 seconds). Mitigation: the materialize_goal handler can split into async elaborate-then-plan if latency is unacceptable.
- ElaborationService may block goals that lack success criteria. This is correct harness behaviour but changes the effective acceptance surface of the gateway.
- During Phase 2 transition, dual work item creation is a risk. When GoalHarness is active, materialize_goal must skip initialWorkItemSpec to avoid creating both stub and planned work items.

### Neutral

- Post-execution evaluation (Phase 5) is deferred. This is an honest acknowledgement that the replan loop has no working implementation. It can be added when the evaluation loop is proven.

---

## Open Questions

1. **Should goal.submit return immediately or block until the plan is ready?** Affects gateway RPC latency and client expectations. Current behaviour is near-instant; GoalHarness planning is not.
2. **Should GoalHarness emit its own events (e.g. `goal.elaborated`, `goal.planned`)?** Would improve observability of the pre-execution lifecycle but adds to the event taxonomy.
3. **Can Phase 5 evaluation hook be deferred indefinitely?** It depends on whether SchedulerCore's retry and escalation are sufficient without a replan loop.

---

## File Impact Summary

| Category | Files |
|---|---|
| New | `src/harness/goal-harness-interface.ts`, `src/harness/goal-harness.ts`, `src/harness/harness-daemon.ts`, `src/harness/index.ts` |
| Modified (Phase 2) | `src/scheduler-daemon/daemon.ts`, `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts` |
| Modified (Phase 3) | `src/main.ts` |
| Deprecated (Phase 4) | `src/autonomy/daemon.ts` |
| Unchanged | `src/scheduler/core/scheduler.ts`, `src/scheduler/core/types.ts`, all gateway files, all lifecycle service files |

---

## References

- SchedulerCore interface: `src/scheduler/core/types.ts` (ISchedulerCore)
- AutonomyDaemon: removed in Phase 4 (was `src/autonomy/daemon.ts`)
- Gateway lifecycle gap: documented in `CLAUDE.md` failure patterns (2026-03-28)
- ElaborationService: `src/app/lifecycle/` (stage-interfaces.ts defines IElaborationService)
- GlobalKnowledgeService: wiring verified in harness migration Phase 3
