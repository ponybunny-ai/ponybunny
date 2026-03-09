# Session 24: Manual Replay Design

This session is documentation-only.

It defines the safest first manual replay model for evented execution runs.
It does not implement replay.
It does not change gateway behavior, IPC, direct vs evented execution semantics, tool worker behavior, or conversation worker behavior.
It does not introduce retry, worker reattachment, automatic recovery, or force-terminalization.

## Current baseline

After Sessions 17 through 23, the system already has:

- a durable evented dispatch checkpoint in `runs.context.evented_dispatch`
- durable scheduler-side idempotency for `result_continuation_applied`
- startup reconciliation and stale/orphan marking
- operator inspection for one run
- `recovery_candidate` as the broad manual-review marker
- `replay_candidate` as the narrower "this may later be replay-safe" marker

What does not yet exist is an authoritative replay action model.
In particular, the current architecture still needs an explicit rule for:

- where replay intent is recorded durably
- how a replayed attempt is linked to the original attempt
- which attempt owns scheduler continuation after replay starts
- how late result events from the original attempt are prevented from driving continuation

## What "manual replay" means

For PonyBunny Phase 2D, the safest manual replay model is:

- do not reuse the same run
- do not create a replacement work item
- create one new run against the same existing work item
- treat that new run as the replacement execution attempt
- durably mark the original run as superseded for scheduler continuation before the replacement run is dispatched

This is the smallest model that preserves auditability while keeping scope narrow.

### Why not reuse the same run

Reusing the same run would collapse two different execution attempts into one durable row.
That would break audit clarity and make late-result handling ambiguous, because the original and replayed execution would share the same `runId` even though result events and durable idempotency are keyed around the run record.

### Why not create a replacement work item

A replacement work item would broaden scheduler semantics unnecessarily.
The scheduler already supports multiple runs for the same work item through `run_sequence`.
Introducing a second work item would change ownership and state semantics at the wrong layer.

### Why a new run on the same work item is safest

This keeps the recovery action inside the already existing run-attempt model:

- the work item remains the unit of scheduler progress
- the original run remains immutable history
- the replayed attempt gets its own durable `runId`
- result idempotency remains run-scoped
- lineage can be expressed with narrow additional fields instead of a broader redesign

## Recommended authoritative durable model

Replay intent and replay lineage should remain evented-only and should live inside `runs.context.evented_dispatch`.

The authoritative source of truth should be:

- on the original run: a narrow replay linkage object under `evented_dispatch`
- on the replay run: a narrow back-reference to the original run under `evented_dispatch`

Recommended first-shape fields:

### Original run

`runs.context.evented_dispatch.manual_replay`

- `requested_at: number`
- `requested_reason: "manual_operator_request"`
- `replacement_run_id: string`
- `replacement_run_created_at: number`
- `original_continuation_suppressed_at: number`

### Replay run

- `runs.context.evented_dispatch.replay_of_run_id: string`
- `runs.context.evented_dispatch.replay_started_at: number`

The original run should be authoritative for replay intent.
That is the row the operator explicitly targeted, and it already owns the stale/orphan and candidate metadata.

The replay run should mirror lineage for inspection convenience, but the decisive durable record is the original run's `manual_replay` block.

## Relationship between the major entities

### Original orphaned or stale run

The original run remains the historical first attempt.
It is not deleted, rewritten, or converted into the replay attempt.
After replay starts, it is no longer allowed to drive scheduler continuation.

### Replay candidate marker

`replay_candidate` remains only an operator-intent prerequisite.
It does not itself start replay and it is not authoritative lineage.
It is simply part of the gate set that says the run was manually reviewed enough to allow the replay action.

### Replayed execution attempt

The replayed attempt is a newly created run row for the same work item.
It gets a fresh `runId`, an incremented `run_sequence`, and its own `evented_dispatch` checkpoint.
That new run becomes the only run allowed to claim scheduler continuation after replay start.

### Scheduler-owned continuation

Scheduler continuation must remain single-owner.
Before the replacement `task.ready` is published, the original run must be durably marked as no longer authoritative for continuation.
The replacement run then becomes the only attempt whose result may claim continuation.

### Late arrival of old result events

Late `execution.completed` or `execution.failed` events for the original run must be suppressed at the durable continuation-claim boundary.
They may still exist as runtime events, but they must not change work item state, goal state, or apply post-result continuation once replay has begun.

## Replay safety issues

### A. Late result from the original run arrives after replay has started

Durable checks required:

- original run still exists
- original run has valid `evented_dispatch`
- original run has `manual_replay.replacement_run_id`
- original run has `manual_replay.original_continuation_suppressed_at`

What should be suppressed:

- claiming `result_continuation_applied` for the original run
- any scheduler continuation from the original run
- any work item or goal mutation caused by that old result

What should be recorded for audit/history:

- the original run remains linked to the replacement run
- a durable suppression reason must be inferable from `manual_replay`
- operator inspection should show that the original run was superseded by replay

What should block the action:

- replay start must be blocked if the system cannot durably mark the original run as continuation-suppressed before dispatching the replacement run

### B. Duplicate replay request from the operator

Durable checks required:

- read the original run's current `evented_dispatch`
- if `manual_replay.replacement_run_id` already exists, treat the action as already performed

What should be suppressed:

- creation of any second replacement run
- any second `task.ready` publication for the same manual replay action

What should be recorded for audit/history:

- the original `requested_at`
- the existing `replacement_run_id`
- optionally a CLI result such as `already_replayed`, but no new durable mutation is required

What should block the action:

- block creation of a new replay attempt whenever the original run already has replay linkage

### C. Replay started for a run that is no longer eligible

Durable checks required:

- `execution_mode = "evented"`
- `recovery_candidate = true`
- `replay_candidate = true`
- `result_continuation_applied = false`
- `runs.status = "running"`
- `orphan_classification` is present
- target work item still exists and is still `in_progress`
- target run is not already a replay attempt
- target run does not already have `manual_replay.replacement_run_id`

What should be suppressed:

- all replay creation if any gate fails

What should be recorded for audit/history:

- no durable mutation on failure
- the operator should receive the blocking reason from the command result

What should block the action:

- any failed gate above

### D. Replay lineage and auditability between original and replayed attempt

Durable checks required:

- both original and replacement run rows must exist
- original run must record `replacement_run_id`
- replacement run must record `replay_of_run_id`

What should be suppressed:

- silent creation of unlinked replay runs

What should be recorded for audit/history:

- original run id
- replacement run id
- request timestamp
- replay start timestamp
- fixed reason value for first implementation: `manual_operator_request`

What should block the action:

- block replay completion of the action if either side of the lineage link cannot be written durably

### E. Preventing old and new attempts from both driving scheduler continuation

Durable checks required:

- original run must be durably marked continuation-suppressed before replacement dispatch
- replacement run must have its own fresh `evented_dispatch.result_continuation_applied = false`
- result-claim logic must consult the original run's replay-suppression metadata

What should be suppressed:

- continuation claim from the original run after replay begins
- any second continuation path caused by a late original result

What should be recorded for audit/history:

- suppression timestamp on the original run
- replacement linkage on the original run and replay back-reference on the new run

What should block the action:

- replay must not start unless the original run can be durably transitioned into the continuation-suppressed state first

## Required preconditions for allowing manual replay

The safest minimal gate set for the first implementation is:

- evented mode only
- valid `runs.context.evented_dispatch`
- `execution_mode = "evented"`
- `recovery_candidate = true`
- `replay_candidate = true`
- `runs.status = "running"`
- `result_continuation_applied = false`
- `orphan_classification` is present
- work item still exists and is still `in_progress`
- target run is not already a replay attempt
- target run has not already been replayed

### Why this gate set is intentionally strict

`recovery_candidate` and `replay_candidate` together ensure the operator has explicitly walked through the existing manual-review flow before starting replay.

Requiring `runs.status = "running"` and `result_continuation_applied = false` avoids replaying a run whose continuation has already been durably claimed or whose durable status already became terminal.

Requiring `orphan_classification` keeps the first implementation tied to the already existing conservative stale/orphan policy instead of opening replay for arbitrary evented failures.

Requiring the work item to remain `in_progress` avoids replaying after scheduler state has already moved elsewhere.

## Single safest first implementation shape

The first implementation should be one concrete operator action:

- `pb scheduler manual-replay <runId>`

The command should:

1. load the target run and verify the full gate set
2. atomically write replay intent onto the original run
3. atomically create one replacement run for the same work item
4. write replay lineage onto the replacement run
5. publish one new `task.ready` for the replacement run

The critical semantic rule is:

- the original run is preserved as history but is durably suppressed from future continuation
- the replacement run becomes the only authoritative continuation owner

This is the safest first shape because it reuses:

- the existing work item
- the existing run-attempt model
- the existing evented dispatch checkpoint
- the existing evented `task.ready` path

And it avoids:

- gateway changes
- IPC changes
- work item replacement
- worker reattachment
- retry-policy redesign

## What the first manual replay implementation should not attempt

It should not attempt to:

- replay direct-mode runs
- replay runs that are not already orphan-classified
- replay a replayed run
- create replacement work items
- mutate goal state as part of starting replay
- mutate old-result events into terminal state on the original run
- kill or reattach workers
- perform automatic replay
- implement automatic stale-result cleanup
- implement generic retry semantics
- implement multi-step lineage chains beyond one original-to-replacement link

The first version should stay narrowly focused on one manual operator action that starts one replacement run safely.

## Recommended Session 25 implementation scope

The smallest safe coding session after this design is:

- implement `pb scheduler manual-replay <runId>` for evented orphaned runs only
- add the narrow replay metadata fields inside `runs.context.evented_dispatch`
- add the durable repository action that atomically:
  - re-validates the gate set
  - writes replay intent onto the original run
  - marks the original run as continuation-suppressed
  - creates the replacement run with the next `run_sequence`
  - writes `replay_of_run_id` onto the replacement run
- update the evented result-continuation claim path so original runs with replay-suppression metadata cannot claim continuation
- reuse the existing `task.ready` publication path for the replacement run
- extend inspect-one-run output so operators can see replay linkage on both the original and replacement run

Exact durable fields/checks needed in Session 25:

- original run:
  - `evented_dispatch.manual_replay.requested_at`
  - `evented_dispatch.manual_replay.requested_reason`
  - `evented_dispatch.manual_replay.replacement_run_id`
  - `evented_dispatch.manual_replay.replacement_run_created_at`
  - `evented_dispatch.manual_replay.original_continuation_suppressed_at`
- replay run:
  - `evented_dispatch.replay_of_run_id`
  - `evented_dispatch.replay_started_at`
- gate checks:
  - valid evented checkpoint
  - `execution_mode = "evented"`
  - `recovery_candidate = true`
  - `replay_candidate = true`
  - `runs.status = "running"`
  - `result_continuation_applied = false`
  - `orphan_classification IS NOT NULL`
  - work item status is still `in_progress`
  - no existing replay linkage on the target run

Exact things to postpone:

- replay of non-orphaned runs
- replay of already terminal runs
- replay of replay attempts
- automatic recovery workflows
- worker kill or reattachment mechanics
- forced terminalization of the original run
- generic retry/restart policy
- richer operator audit tables or multi-actor provenance
- broader readiness review for evented-as-default

## Open risks that remain even after first manual replay implementation

- The original run may remain durable `running` forever, only annotated as superseded by replay, because first implementation should not also solve terminal override policy.
- External side effects inside the original attempt may already have happened before replay starts; replay can prevent duplicate scheduler continuation, but it cannot retroactively undo side effects.
- If the replay attempt also goes stale, first implementation should not yet support replay-of-replay or chained recovery.
- Auditability will improve, but first implementation still relies on run-context metadata rather than a dedicated operator-action log.
- The design suppresses late original continuation at the scheduler boundary, but it does not solve deeper exactly-once guarantees for arbitrary tool or model side effects.

## Final recommendation

Manual replay should mean: create one new evented run for the same work item, durably mark the original run as superseded for scheduler continuation, and link the two runs through narrow replay metadata inside `runs.context.evented_dispatch`.

That is the safest first model because it preserves the existing work-item topology, keeps lineage explicit, and prevents old and new attempts from both driving scheduler continuation without broadening scope into gateway, IPC, retry, or worker-management redesign.
