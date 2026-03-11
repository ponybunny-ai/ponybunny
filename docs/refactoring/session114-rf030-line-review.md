# Session 114: RF-030 Line Review

## Scope

Session 114 is a bounded review / re-ranking session for `RF-030` after the first major coding cluster landed in Session 113.

This session is documentation only. It does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused Sessions 95-100, 101-103, 104-109, or `RF-062`
- redesign scheduler semantics
- redesign conversation lifecycle semantics
- redesign startup/bootstrap semantics
- redesign gateway/daemon transport semantics
- change provider execution/fallback behavior
- change existing RPC/event/status payload shapes
- change TUI behavior

## Current Post-113 State Reviewed

Reviewed current code in:

- `src/app/conversation/session-manager.ts`
- `src/app/conversation/task-bridge.ts`
- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `src/scheduler-daemon/conversation-bootstrap/conversation-task-materializer.ts`
- `src/scheduler-daemon/session-intake.ts`
- focused tests under `test/scheduler-daemon/`

## What Session 113 Achieved

Session 113 completed the first major RF-030 coding cluster and materially improved the live ownership shape.

What changed in the actual codebase:

- conversation-triggered goal/work-item materialization plus scheduler-submit moved out of `SchedulerTaskBridge`
- scheduler-daemon-owned `ConversationTaskMaterializer` now owns:
  - effective selected-model compatibility projection
  - goal creation
  - first work-item creation
  - scheduler submit sequencing
- `SchedulerTaskBridge.createGoalFromConversation(...)` is now a thin delegate to that materializer
- bootstrap now constructs `ConversationTaskMaterializer` separately and injects it into `SchedulerTaskBridge`

What intentionally remained in `SchedulerTaskBridge`:

- the `SessionManager`-facing `createGoalFromConversation(...)` method shape
- repository-backed `getTaskStatus(...)`
- `subscribeToProgress(...)`
- `cancelTask(...)`

What did not change:

- `SessionManager` still decides when conversation analysis becomes executable work
- `SessionManager` still stores `activeGoalId` and later monitors by `goalId`
- observation/status reads are still repository-backed on the bridge
- payload shapes and runtime behavior are unchanged on this path

## Remaining Plausible RF-030 Candidates

Only candidates grounded in the current codebase are included here.

### Candidate 1: Split observation/status responsibilities from the `SessionManager`-facing bridge

Current evidence:

- `SessionManager.handleExecuting(...)` still calls `taskBridge.subscribeToProgress(...)`
- `SessionManager.handleMonitoring(...)` still calls `taskBridge.getTaskStatus(...)`
- `SchedulerTaskBridge` still mixes creation delegation with repository-backed reads/cancel

Evaluation:

- Structural gain: moderate. It would make creation vs observation responsibilities explicit.
- Semantic risk: low to moderate. Constructor shape changes are easy; avoiding lifecycle drift is the real constraint.
- Scope tightness: moderate. A narrow interface split is possible, but it touches `SessionManager`, bootstrap wiring, and tests.
- True ownership/composition cleanup: yes, but smaller than the Session 113 extraction.
- Drift risk: moderate. It can slide into conversation lifecycle redesign if it starts changing who owns monitoring flow rather than only dependency shape.

Judgment:

This is the most plausible remaining RF-030 slice, but the payoff is now limited because the heavy materialization/submit knot is already gone and `subscribeToProgress(...)` on the live daemon bridge is currently a no-op stub.

### Candidate 2: Rename or reshape the remaining bridge so scheduler-daemon ownership is more explicit

Current evidence:

- bootstrap still constructs `SchedulerTaskBridge`
- `SchedulerSessionIntake` still re-exports `SchedulerTaskBridge`
- the class name still reads like a broad mixed bridge even though the touched path is now mostly delegation plus observation

Evaluation:

- Structural gain: low.
- Semantic risk: low.
- Scope tightness: good.
- True ownership/composition cleanup: only partly. Most of the remaining work is naming/publication hygiene.
- Drift risk: high relative to benefit because this starts to overlap with already-closed compatibility/public-surface rationalization work.

Judgment:

Not a good next cluster. The current naming is mildly misleading, but changing it now would be mostly cosmetic or RF-059-adjacent churn.

### Candidate 3: Narrow bootstrap publication so it does not expose a wider seam than necessary

Current evidence:

- `createDefaultConversationBootstrap(...)` still constructs and injects one `taskBridge` dependency into `SessionManager`
- that single dependency still carries creation, status read, subscription, and cancel surfaces

Evaluation:

- Structural gain: low to moderate.
- Semantic risk: low.
- Scope tightness: moderate.
- True ownership/composition cleanup: only if paired with Candidate 1.
- Drift risk: moderate to high if treated as a bootstrap rewrite rather than a small composition consequence.

Judgment:

This is not a stand-alone high-value target. On the current codebase it is a consequence of an observation split, not a separate justified cluster.

### Candidate 4: Pull another adjacent conversation-to-scheduler seam out of `SessionManager`

Current evidence:

- `SessionManager` still initiates creation and monitoring for executable goals
- it still stores `activeGoalId` and frames the user-facing start/monitoring flow

Evaluation:

- Structural gain: potentially moderate in the abstract.
- Semantic risk: high.
- Scope tightness: poor.
- True ownership/composition cleanup: no longer clearly bounded; it would push into conversation lifecycle semantics.
- Drift risk: very high.

Judgment:

This should not be the next step. It would drift directly into conversation lifecycle redesign, which is explicitly out of scope.

## Conclusion

`RF-030` should pause now and be re-ranked against broader remaining candidates.

Why:

- Session 113 already removed the one clearly high-value mixed-owner knot: concrete materialization plus scheduler-submit no longer lives in `SchedulerTaskBridge`.
- The strongest remaining candidate is only the observation split, and that is now a smaller interface/composition cleanup rather than another major structural repair.
- The live daemon bridge observation side is thin: `getTaskStatus(...)` is a simple repository read, `cancelTask(...)` is a small repository status mutation, and `subscribeToProgress(...)` is currently a no-op stub.
- Pushing another RF-030 session immediately would risk stretching the line into lifecycle reshaping, bootstrap churn, or naming cleanup for limited structural gain.

This is the point of diminishing returns for the current RF-030 line.

## Practical Re-Ranking Against Broader Remaining Candidates

With `RF-030` paused, the currently live documented candidates rank approximately as follows.

### 1. RF-036 event protocol cleanup

Best next major block.

Why:

- it is still a live task in the master list rather than an intentionally deferred topology-dependent line
- the current code still has active `task.*` protocol surfaces across scheduler, runtime worker, gateway typing, and TUI consumption
- it is broader project-level cleanup, not just residual interface tidying on one already-improved seam

Current code signals:

- `src/scheduler/core/scheduler.ts` emits `task.ready`
- `src/runtime/workers/execution-worker.ts` consumes `task.ready`
- `src/gateway/types.ts` still exposes `task.narration` / `task.result`
- the TUI still handles those gateway task events directly

This should begin as a bounded review/design session, not immediate protocol changes.

### 2. RF-024 tool mode switch

Still lower priority.

Why:

- Session 39 already concluded a formal mode switch should not exist yet
- nothing in the current tree suggests that this became less speculative

### 3. RF-026 tool hardening

Keep deferred.

Why:

- Session 45 explicitly paused broader durable/cross-process hardening until a non-local tool topology is justified
- current code still reflects the same local-authoritative ToolWorker shape

## What Should Not Be Done Next

- Do not force another RF-030 coding session just to split `getTaskStatus(...)` / `cancelTask(...)` out for symmetry.
- Do not move goal materialization authority into `ConversationWorker` or otherwise reopen conversation-worker lifecycle boundaries.
- Do not redesign how `SessionManager` owns `activeGoalId`, monitoring, or conversation-state progression.
- Do not turn bootstrap tightening into a broader conversation bootstrap rewrite.
- Do not spend a session on renaming `SchedulerTaskBridge` or trimming exports unless bundled into a stronger structural line.
- Do not reopen `RF-059` through public-surface cleanup disguised as RF-030.

## Recommended Session 115

Recommend exactly one next session:

Start `RF-036` with a bounded review/design session that inventories the live `task.*` protocol surfaces and identifies whether there is one semantics-preserving first normalization slice worth doing.

That is a better use of Session 115 than forcing one more weaker RF-030 cleanup cluster.

## Validation

Validation for Session 114 was review-oriented:

- reviewed the current post-113 RF-030 code paths listed above
- reviewed the focused `SchedulerTaskBridge`, `ConversationTaskMaterializer`, bootstrap, and session-intake tests
- confirmed no runtime source files required changes for this session
