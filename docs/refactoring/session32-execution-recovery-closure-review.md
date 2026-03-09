# Session 32: Execution / Recovery Closure Review

This session is documentation-only.

It reviews the execution/recovery line after Sessions 10 through 31 and recommends whether that line should remain the primary focus.

It does not change gateway behavior, IPC, direct vs evented execution semantics, tool worker scope, conversation worker scope, replay behavior, retry behavior, automatic recovery, or worker reattachment.

## Executive judgment

The execution/recovery line is now stable enough to pause as the primary focus.

That does not mean the line is finished or broad-default ready.
It means the architectural objective for this phase has been met:

- the execution boundary is extracted
- evented execution has a real scheduler-owned dispatch/result boundary
- continuation ownership is durably constrained
- reconciliation/orphan inspection is operator-visible
- manual replay exists as a guarded recovery tool
- daemon-live replay ownership is no longer an open gap
- the replacement-attempt stop boundary is explicit instead of implicit

The remaining work is now short-tail hardening, not core architectural unblock work.
Those items still matter before any broader/default evented adoption, but they do not need to block the next refactor front.

## What is now implemented on the execution/recovery line

Sessions 10 through 31 established a coherent execution/recovery baseline:

1. Execution boundary extraction
   - `ExecutionPort`, `ExecutionRequest`, and `ExecutionResult` define the scheduler-facing execution seam.
   - `LocalExecutionWorker` exists and consumes the same dispatch contract through `task.ready`.
   - direct and evented modes share the same execution request shape.

2. Evented result authority and shared continuation
   - in evented mode, `execution.completed` and `execution.failed` are the authoritative result signals
   - scheduler post-result behavior converges through the shared `continueAfterExecutionResult(...)` boundary
   - evented failure handling has enriched payload support instead of a worker-error-only shape

3. Durable evented checkpoint and idempotent continuation claim
   - evented dispatch records `runs.context.evented_dispatch`
   - the checkpoint carries execution mode, lane, dispatch timing, and result-continuation durability
   - scheduler-side continuation is durably claimed exactly once through `result_continuation_applied`
   - duplicate or late result application is durably suppressed at the repository claim boundary

4. Reconciliation and stale/orphan marking
   - startup reconciliation inspects durable in-flight evented runs
   - stale/orphan detection exists with durable `orphan_classification = "stale_timeout"`
   - stale/orphan marking is idempotent and intentionally detection-only
   - operator inspection exists for in-flight, orphaned, summary, and single-run views

5. Conservative manual recovery workflow
   - operators can mark and clear `recovery_candidate`
   - operators can mark `replay_candidate`
   - manual replay exists only for evented orphan-classified runs that pass the durable gate set
   - replay creates one replacement run on the same work item
   - original-run continuation is durably suppressed before replacement dispatch
   - replay lineage is durably recorded on both original and replacement runs
   - duplicate replay creation is durably suppressed
   - replay precheck and replay post-run diagnostics exist

6. Daemon-safe replay execution and replacement-attempt policy surfacing
   - `pb scheduler replay-run <runId>` now works while the scheduler daemon is active
   - the daemon owns replay dispatch when it owns the evented execution plane
   - replacement replay attempts that later become stale/orphaned now surface an explicit operator policy boundary
   - replay-of-replay remains forbidden

## What remains intentionally conservative

The current line is narrow by design:

- direct mode remains the default
- evented reconciliation is detection/inspection first, not automatic recovery
- startup reconciliation is the main stale/orphan marking point; there is no broader automatic recovery loop
- replay remains evented-only, orphan-classified-only, same-work-item-only, and single-replacement-only
- replay does not reuse the original run, create a new work item, or allow replay-of-replay
- original history is preserved; the original run is suppressed for continuation, not rewritten
- worker reattachment, retry, automatic recovery, and replacement-attempt automation remain out of scope
- operator control remains narrow and mostly read-only or metadata-first until durable authority transfer is explicit

## What is stable enough for guarded operator use

The following are stable enough for guarded use now:

- direct mode as the ordinary/default operating path
- evented mode in controlled environments with operator familiarity
- startup reconciliation and orphan inspection as the primary evented diagnostic surface
- recovery-candidate and replay-candidate marking as conservative operator intent signals
- replay precheck before mutation
- one manual replay for a reviewed orphan-classified evented run
- replay lineage and replay outcome inspection from either side of the pair
- daemon-live replay through the scheduler daemon rather than a parallel CLI-owned execution stack

## What is still not ready for broader/default use

The following should still not be treated as broad/default-ready:

- making evented mode the default scheduler mode
- treating stale/orphan classification as if it were recovery completion
- treating manual replay as a routine low-friction operator action
- assuming replay fully addresses external/tool side effects
- assuming a replacement replay attempt has any automatic follow-up if it also becomes stale/orphaned
- assuming replay provenance/audit needs are fully satisfied by current run-context metadata alone

## Assessment A: Direct mode

### Current strengths

- It is still the simplest scheduler-owned execution path.
- It benefits from the extracted execution boundary and shared continuation without taking on evented recovery complexity.
- It remains operationally legible because dispatch and completion authority stay in one path.

### Remaining risks

- It does not advance worker isolation by itself.
- Long-term dual-mode maintenance remains architectural overhead if direct and evented both stay operational forever.

### Current recommended usage posture

Direct mode should remain the default and ordinary-use path.
It is the correct baseline when operational simplicity is more important than exercising the evented line.

### Is further immediate work required?

No immediate direct-mode work is required on the execution/recovery line.
Any further work here is downstream of later architectural decisions, not a Session 32 blocker.

## Assessment B: Evented mode

### Current strengths

- Evented dispatch and evented result authority are both real now.
- Post-result continuation is shared with direct mode, which reduces semantic drift.
- Evented dispatch writes a durable checkpoint before the line depends on later continuation.
- Continuation application is durably idempotent.
- Startup reconciliation and orphan inspection make the mode operable instead of opaque.

### Remaining risks

- Recovery after restart still stops at diagnosis/marking rather than authoritative completion recovery.
- Worker liveness and reattachment are still intentionally absent.
- Broader rollout would increase exposure to orphan/replay cases that still require operator judgment.
- External side effects are not under an exactly-once guarantee.

### Current recommended usage posture

Evented mode is stable enough for controlled rollout and guarded operator use.
It is not ready to become the default mode.

### Is further immediate work required?

No immediate blocker remains before moving primary focus away from execution/recovery.
Further work is required only before broader/default evented adoption.

## Assessment C: Manual replay workflow

### Current strengths

- Replay has a strict durable gate set.
- Original-run continuation suppression happens before replacement dispatch.
- Replacement creation is same-work-item and one-run-at-a-time.
- Replay lineage is durable and inspectable from both sides.
- Duplicate replay creation is durably suppressed.
- Precheck and post-run diagnostics make the workflow reviewable.

### Remaining risks

- Replay is still a specialist operator workflow, not an everyday recovery tool.
- Replay protects scheduler continuation authority, not arbitrary external side effects.
- The original run remaining durably `running` but superseded is safe, but can still be non-obvious operationally.
- Replay provenance is inferable, but still not a strong dedicated operator audit model.

### Current recommended usage posture

Manual replay is ready for disciplined, reviewed operator use in the narrow orphan-classified evented cases it was designed for.
It should still be treated as guarded/manual only, not routine first-line recovery.

### Is further immediate work required?

No immediate work is required before handing off to the next module.
Additional audit/workflow validation remains desirable before broader routine use.

## Assessment D: Daemon-safe replay path

### Current strengths

- The active scheduler daemon now owns replay dispatch when it owns the execution plane.
- The daemon-safe path reuses the same scheduler replay logic rather than introducing a parallel replay implementation.
- This closes the main operational ownership gap that previously made replay awkward with a live daemon.
- Replacement-attempt stale/orphan policy is now surfaced explicitly to operators.

### Remaining risks

- The current policy boundary for a stale/orphaned replacement attempt is explicit but still terminal and manual-only.
- Broader operational validation of restart plus daemon-live replay sequences is still limited.
- Audit provenance is still run-context-centric rather than a dedicated action log.

### Current recommended usage posture

Daemon-safe replay is stable enough to use for the guarded replay workflow that already exists.
It should not be mistaken for full recovery completeness or for permission to broaden replay semantics.

### Is further immediate work required?

No immediate daemon-safe replay work is required before moving focus.
Only short-tail validation and audit tightening remain.

## Is the execution/recovery line now stable enough to pause as the primary focus?

Yes.

The primary architectural goals for this line have been achieved, and the remaining issues are short-tail hardening tasks rather than reasons to keep this as the main refactor front.

## Remaining short-tail tasks

1. Add a narrow operator-action audit record or equivalent stronger replay provenance.
2. Run a tighter end-to-end validation pass around restart, stale/orphan marking, daemon-live replay, and late-result suppression together.
3. Improve operator documentation/playbook clarity for the superseded-original and replacement-attempt-orphaned cases.

## Which remaining tasks are must-fix before moving on?

None of the short-tail tasks are must-fix before moving primary focus to the next module.

## Which remaining tasks are must-fix before broader/default use?

The first two are must-fix before any serious attempt to make evented mode or manual replay broader/default-use features:

- stronger replay provenance/auditability
- end-to-end workflow validation of the restart/reconciliation/replay path

The operator-documentation/playbook item is lower risk and can follow shortly after.

## Which tasks can safely be deferred?

The following can be deferred without blocking the transition away from execution/recovery as the main focus:

- dedicated operator playbook polish
- any richer replay UX beyond the existing CLI surfaces
- any broader architecture decision beyond the current explicit stop boundary for replacement-attempt orphaning

## Recommended handoff to next module

### Should Session 33 begin ToolWorker extraction?

Yes.

### Why now?

The execution/recovery line now has the durable invariants it needed before the next worker-facing extraction starts:

- scheduler-owned execution identity is explicit
- evented dispatch/result authority is explicit
- continuation ownership is durably constrained
- reconciliation and guarded replay give operators a usable containment model when evented execution stalls

That is enough closure for this phase.
Continuing to stay on execution/recovery would mostly produce incremental hardening rather than unlock a new architectural seam.

### If no, what single execution/recovery task would block that transition?

Not applicable.
There is no single remaining execution/recovery task that should block beginning ToolWorker extraction design.

## Do not lose these invariants

Future refactors must preserve these execution/recovery invariants:

- Scheduler-owned run identity remains the authoritative correlation key for execution dispatch and result handling.
- `runs.context.evented_dispatch` remains the durable checkpoint for scheduler-owned evented dispatch state.
- Evented dispatch checkpoint semantics stay explicit:
  `execution_mode`, `lane_id`, `dispatched_at`, `result_continuation_applied`, and `result_continuation_applied_at` remain durable scheduler-owned facts.
- Evented scheduler continuation is durably claim-once.
  Duplicate or late results must not re-apply continuation after `result_continuation_applied = true`.
- Original-run continuation suppression must happen durably before replay replacement dispatch.
- Replay must continue to create a new replacement run on the same work item rather than mutating the original run into a second attempt.
- Replay lineage semantics must remain explicit on both sides:
  original-side `manual_replay.replacement_run_id` and replacement-side `replay_of_run_id`.
- Replay duplicate suppression must remain repository-owned and durable, not in-memory best effort.
- Direct-mode semantics must remain unaffected by evented replay/reconciliation features.
- Stale/orphan marking must remain conservative and idempotent.
  Detection/inspection must not silently become automatic recovery.
- Replacement-attempt orphaning must remain an explicit stop boundary unless a later session intentionally changes that policy.
- Daemon-owned replay dispatch must not be bypassed when the active scheduler daemon owns the evented execution plane.

## Deferred execution/recovery backlog

1. Add explicit replay operator-action audit/provenance beyond run-context inference.
2. Add a focused end-to-end validation matrix for restart, stale/orphan marking, daemon-live replay, and late-result suppression.
3. Tighten operator playbook language around superseded originals and orphaned replacement attempts.

## Recommended Session 33

Session 33 should begin `RF-021`: produce the ToolWorker extraction design and dependency map.

Rationale:
the execution/recovery line is now sufficiently closed for guarded use, while ToolWorker remains the next major architectural seam that still lacks even a design baseline.
