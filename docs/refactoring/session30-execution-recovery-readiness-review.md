# Session 30: Execution / Recovery Readiness Review

This session is documentation-only.

It reviews the execution/recovery line after Sessions 10 through 29.
It does not change gateway behavior, IPC, direct vs evented execution semantics, tool worker scope, conversation worker scope, replay behavior, retry behavior, automatic recovery, or worker reattachment.

## Scope of this review

This review covers four linked areas that now exist on the same line of work:

- execution boundary extraction
- evented execution handoff and continuation
- evented reconciliation and operator inspection
- manual replay as a guarded operator workflow

It does not treat broader worker extraction, gateway changes, or tool/conversation isolation as part of the readiness decision for this session.

## Executive judgment

The execution/recovery line is materially stronger than it was at Session 16.
It now has a coherent evented dispatch boundary, durable continuation idempotency, stale/orphan detection, operator-visible inspection, and a first safe manual replay path with lineage and diagnostics.

However, it is not yet ready for broad default adoption.
The missing pieces are no longer basic architecture gaps. They are hardening gaps around durable recovery authority, daemon-live replay ergonomics, and operator safety when the first replay attempt itself becomes the new in-flight problem.

Current judgment:

- direct mode is production-adjacent and remains the safest default
- evented mode is production-adjacent for controlled rollout, not default-ready
- manual replay is usable for careful operator intervention, not yet ready as routine low-friction operator practice

## What is now implemented

Sessions 10 through 29 established the following execution/recovery baseline:

1. Execution boundary and worker-aligned dispatch
   - `ExecutionPort`, `ExecutionRequest`, and `ExecutionResult` now define the scheduler-facing execution boundary.
   - `LocalExecutionWorker` exists and consumes the same request contract through `task.ready`.
   - direct and evented modes share the same request shape and the same post-result scheduler continuation boundary.

2. Evented result authority and durable continuation control
   - in evented mode, `execution.completed` and `execution.failed` are now the authoritative result signals
   - scheduler continuation converges through a shared post-result path
   - failure payloads are enriched enough for evented continuation/accounting symmetry
   - scheduler-side result continuation is durably claimed and idempotent via `runs.context.evented_dispatch.result_continuation_applied`

3. Reconciliation and conservative orphan handling
   - evented dispatch writes a durable checkpoint into `runs.context.evented_dispatch`
   - startup reconciliation inspects in-flight candidates and classifies likely stale/orphaned work
   - stale timeout marking exists and is durable, idempotent, and intentionally detection-only
   - operator-visible read-only inspection exists for in-flight, orphaned, summary, and single-run views

4. Manual recovery preparation and guarded manual replay
   - operators can mark and clear `recovery_candidate`
   - operators can mark `replay_candidate`
   - manual replay exists for evented orphan-classified runs only
   - replay durably suppresses original-run continuation before replacement dispatch
   - replay lineage is recorded on both original and replacement runs
   - replay duplicate creation is durably suppressed
   - replay precheck exists before mutation
   - replay post-run diagnostics exist after mutation

## What is still incomplete

The line is still incomplete in the areas that matter most for broader operational trust:

- evented continuation after restart still depends on conservative inspection rather than durable recovery authority
- the system can classify stale/orphaned evented runs, but it still does not recover, reattach, retry, or automatically resume them
- manual replay remains a narrow first action, not a complete recovery model
- replay is intentionally awkward while the scheduler daemon is live
- the architecture still does not define what to do when a replacement replay attempt itself later becomes stale/orphaned
- there is still no dedicated operator-action audit model beyond run-context metadata
- external/tool side effects remain outside any exactly-once guarantee

## What is intentionally conservative

Several current limitations are deliberate, not accidental:

- direct mode remains default
- evented hardening is detection-first and metadata-first before control-plane changes
- reconciliation only classifies and marks; it does not recover
- replay is evented-only, orphan-classified-only, one-run-at-a-time, and same-work-item-only
- replay does not rewrite original history, force terminalization, or permit replay-of-replay
- operator surfaces are mostly read-only or metadata-only until durable authority transfer is explicit
- daemon-live replay orchestration was intentionally deferred to avoid broadening gateway or IPC semantics

Those choices have kept the migration safe, but they also define the current readiness ceiling.

## Production-adjacent vs experimental

### Production-adjacent

- direct execution path through the extracted execution boundary
- evented dispatch/result handoff within a controlled single-daemon deployment
- durable evented result idempotency
- startup reconciliation and stale/orphan marking
- read-only operator inspection for reconciliation and replay lineage/state
- guarded manual replay for carefully reviewed evented orphan cases

### Experimental or still guarded

- making `evented` the default scheduler mode
- treating manual replay as a routine operator action without extra review
- operating replay as a daemon-live everyday tool
- relying on replay as the answer for every orphaned evented run
- assuming replacement replay attempts have a complete follow-up policy if they also stall

## Readiness Assessment A: Direct Mode

### Current strengths

- direct mode still follows the most established execution path
- it benefits from the Session 10 boundary cleanup and Session 14 continuation convergence without taking on worker/result-handoff dependency
- it remains operationally simpler because execution dispatch and completion authority stay in one synchronous scheduler-owned path
- none of the evented-only reconciliation or replay controls are required for direct mode to function

### Remaining risks

- direct mode still lives beside an in-progress evented architecture, so long-term architecture complexity remains higher than ideal
- it does not advance the worker-isolation goal by itself
- some future effort will still be needed to avoid maintaining two operationally meaningful modes forever

### What operators can safely do today

- treat direct mode as the baseline production path
- continue normal execution and verification workflows
- use it as the default fallback when evented hardening uncertainty is unacceptable

### What should still be treated as guarded/manual only

- any attempt to infer evented readiness from direct-mode stability
- any assumption that direct mode removes the need to finish execution/recovery hardening before broader worker extraction

### Readiness judgment

Direct mode is ready for ordinary use and should remain the default until the evented hardening set is closed.

## Readiness Assessment B: Evented Mode

### Current strengths

- the architectural cut is real now: dispatch is evented, result authority is evented, and post-result continuation is shared
- the scheduler writes a durable evented checkpoint before/at dispatch and durably claims continuation exactly once
- duplicate result application is durably suppressed
- startup reconciliation gives the daemon and operators a way to see incomplete in-flight evented runs after restart
- stale/orphan detection is conservative and durable rather than hidden in memory
- operator inspection makes evented state legible enough for controlled rollout

### Remaining risks

- evented mode still lacks a durable recovery path after restart; it has diagnosis and marking, not completion recovery
- the authoritative continuation path still needs live in-memory context at the moment the result is applied
- stale/orphan marking tells operators there is a problem, but the system still has no daemon-safe answer beyond manual review
- there is no worker reattachment or equivalent attempt-liveness authority
- broader adoption would increase the number of evented-orphan cases before the operator workflow is frictionless

### What operators can safely do today

- run evented mode in controlled environments
- use reconciliation inspection to identify in-flight and stale evented runs
- use recovery/replay candidate marking to hold specific runs for operator review
- use manual replay selectively for reviewed orphan-classified evented runs

### What should still be treated as guarded/manual only

- making evented mode the default for general deployment
- treating stale/orphan classification as if it were recovery
- assuming restart scenarios are fully handled because duplicate continuation is durable
- depending on evented mode without operator familiarity with inspection and replay diagnostics

### Is evented mode ready to become the default?

No.

It is close enough to be called production-adjacent for controlled rollout, but it is not yet default-ready because the line still stops at durable diagnosis plus guarded manual intervention.
Default mode should not depend on a workflow that still assumes significant operator judgment and has no daemon-safe answer for the next stale replay attempt.

### Minimum remaining hardening set before default could be considered

The minimum hardening set should stay narrow:

1. Define and implement the follow-up policy for replacement replay attempts that later become stale/orphaned.
   - Today the first replay attempt is safe to start, but the line does not yet have a clear terminal policy for the next failure on that same work item.

2. Add a daemon-compatible operator replay path or equivalent daemon-safe coordination rule.
   - The current replay path is intentionally awkward when the scheduler daemon is active.
   - Broader evented adoption should not depend on operators stopping or avoiding the daemon to use the primary manual recovery action.

3. Tighten operator safety/audit around replay execution.
   - A narrow operator-action audit record or equivalently explicit replay provenance is still missing.
   - For broader adoption, replay should be reviewable as an operator action, not only inferred from run-context mutations.

4. Validate the evented recovery path end to end around restart and stale-result scenarios at the workflow level.
   - The core pieces exist, but the line still needs a hardening pass that proves the operator workflow is coherent under restart, orphan marking, replay, and late-result suppression together.

That is a small hardening package, not a new architecture phase.

## Readiness Assessment C: Manual Replay Workflow

### Current strengths

- replay is guarded by a strict durable gate set
- replay suppresses original-run continuation before replacement dispatch
- replay lineage is durable and inspectable from either side
- duplicate replay creation is durably suppressed
- precheck exists before mutation
- post-run diagnostics exist after mutation
- replay remains narrowly scoped to evented orphan-classified runs, which keeps the safety argument coherent

### Remaining risks

- replay still relies on a constrained operator workflow rather than a smooth daemon-live path
- there is no replay-of-replay or replacement-run follow-up policy
- the original run may remain durably `running` but superseded, which is intentional yet operationally non-obvious
- there is still no dedicated operator audit trail beyond run metadata
- replay protects scheduler continuation authority, but it does not solve arbitrary external side effects that may already have happened in the original attempt

### What operators can safely do today

- inspect a candidate run
- mark `recovery_candidate`
- mark `replay_candidate`
- run `replay-precheck`
- perform one manual replay for a reviewed evented orphan/stale run
- inspect original/replacement lineage and post-run replay outcome afterward

### What should still be treated as guarded/manual only

- treating replay as a routine first-line operator action for every evented issue
- using replay without checking preconditions and lineage first
- assuming replay fully resolves all execution-side effects rather than only scheduler continuation authority
- using replay as if there were already a defined second-step policy when the replacement run also stalls

### Is manual replay ready for routine operator use?

Not yet.

It is ready for disciplined operator use in reviewed cases.
It is not yet ready for routine, low-friction, everyday use because the workflow still has two missing safety rails: daemon-live operational ergonomics and a defined policy for the replacement-run failure/orphan case.

### Minimum additional safety rails required

1. One daemon-safe replay execution path.
   - Operators should not need a special process-state workaround to use the primary manual recovery action.

2. A defined replacement-run follow-up rule.
   - The system must say what operators should do when the replay attempt itself becomes stale/orphaned.
   - Even if the answer is still conservative and manual-only, it must be explicit.

3. Narrow operator-action auditability for replay initiation.
   - There should be an explicit durable record of who initiated replay and when, beyond inferring it from run-context linkage.

Those are the minimum rails for routine use.

## Gap classification

### Must-fix before broader adoption

- define and implement the follow-up policy for replay attempts that themselves become stale/orphaned
- add a daemon-safe operator replay path or equivalent daemon-compatible coordination model
- add narrow replay operator-audit/provenance that is explicit rather than only inferential
- run focused workflow validation for restart -> orphan marking -> precheck -> replay -> late-result suppression -> replay outcome inspection

### Should-fix soon

- clarify operator guidance for superseded original runs that remain durable `running`
- tighten documentation and CLI wording around what replay does not guarantee for external side effects
- strengthen inspection/reporting for inconsistent lineage or unresolved replay-chain states

### Can defer

- automatic recovery
- retry behavior
- worker reattachment
- replay-of-replay or broader chained recovery
- gateway or IPC redesign for this line
- ToolWorker or ConversationWorker semantics on the recovery path

## Top remaining tasks on the execution/recovery line

1. Define one explicit policy for replacement replay attempts that later become stale/orphaned.
2. Implement one daemon-safe manual replay path without changing gateway behavior or broadening IPC semantics.
3. Add one narrow durable operator-audit record for replay initiation.
4. Add focused end-to-end workflow validation for restart, orphan marking, replay start, late original result suppression, and replay outcome inspection.

## Strategic recommendation: execution/recovery hardening or ToolWorker next?

The next implementation sessions should stay on execution/recovery hardening first.

Reasoning:

- the remaining work is now a short hardening tail, not an open-ended architecture program
- ToolWorker extraction would start a second large migration front while the first one still has unresolved operational sharp edges
- evented execution and manual replay are already close enough that a small number of targeted sessions can convert them from controlled/guarded to genuinely broader-use ready
- starting ToolWorker now would increase concurrent migration risk and make any future evented/replay issue harder to isolate

This line is therefore not yet stable enough to pivot immediately into ToolWorker extraction.
It is stable enough to justify finishing the hardening package before opening the next architecture front.

## Recommended Session 31

### Session 31 recommendation

Implement a daemon-safe manual replay path and document the operator policy for replacement replay attempts that later become stale/orphaned.

### Rationale

This is the single most leverageable next session because it closes the two biggest blockers shared by both readiness questions:

- evented mode cannot approach default-ready while its primary manual recovery action remains awkward in daemon-live operation
- manual replay cannot become routine until the system defines what the next operator step is when the replay attempt itself becomes the new orphan/stale run

Keeping those together also preserves scope discipline: one hardening session, still inside execution/recovery, without opening retry, automatic recovery, worker reattachment, or ToolWorker extraction.

## What should not be done next

The following directions are tempting but premature:

- making evented mode the default before the hardening set above is closed
- beginning ToolWorker extraction immediately
- adding automatic replay or retry
- adding worker reattachment
- broadening replay beyond evented orphan-classified runs
- redesigning gateway or IPC as part of execution/recovery hardening

## Final readiness summary

- direct mode: ready and should remain default
- evented mode: controlled-rollout ready, not default-ready
- manual replay: guarded-operator ready, not routine-use ready
- next move: finish a narrow execution/recovery hardening package before starting ToolWorker extraction
