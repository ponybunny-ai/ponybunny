# Session 27: Replay Hardening and Duplicate Suppression

This session hardens the existing manual `replay-run` action.

It stays narrow:

- no new replay actions
- no automatic recovery
- no retry behavior
- no worker reattachment
- no gateway or IPC changes
- no direct-vs-evented execution semantic changes

The goal is only to make the current manual replay path safer and more predictable.

## What replay requests are now rejected

Manual replay now rejects the target run when any of these durable checks fail:

- the run does not have a valid `runs.context.evented_dispatch` checkpoint
- the run is itself a replay attempt because `evented_dispatch.replay_of_run_id` is already set
- the run already has `evented_dispatch.manual_replay.replacement_run_id`
- another durable replay lineage row already points back to this run through `evented_dispatch.replay_of_run_id`
- the run status is no longer `running`
- the work item status is no longer `in_progress`
- `evented_dispatch.result_continuation_applied = true`
- `evented_dispatch.recovery_candidate !== true`
- `evented_dispatch.replay_candidate !== true`
- `evented_dispatch.orphan_classification` is missing

The replay action continues to require evented execution context.
Direct-mode runs still fail the evented checkpoint gate and are unaffected.

## How duplicate replay suppression works

Duplicate replay suppression remains durable and repository-owned.

The decisive write is still the original-run update that records:

- `evented_dispatch.manual_replay.requested_at`
- `evented_dispatch.manual_replay.requested_reason`
- `evented_dispatch.manual_replay.replacement_run_id`
- `evented_dispatch.manual_replay.replacement_run_created_at`
- `evented_dispatch.manual_replay.original_continuation_suppressed_at`

Replay creation is allowed only if the original row still matches the conservative replay predicate at update time.
That predicate now also requires that no existing run already points back to the original via:

- `runs.context.evented_dispatch.replay_of_run_id = <originalRunId>`

This means another replay request cannot create a second replacement run once either side of durable lineage already exists.

If the update loses the race or sees changed state, the repository re-reads durable state and returns an explicit rejection reason instead of collapsing back to a generic checkpoint error.

## Durable fields and checks used

This session reuses the existing narrow replay and evented-dispatch metadata.
No broad schema redesign was introduced.

The hardening relies on:

- `runs.status`
- `work_items.status`
- `runs.context.evented_dispatch.execution_mode`
- `runs.context.evented_dispatch.result_continuation_applied`
- `runs.context.evented_dispatch.recovery_candidate`
- `runs.context.evented_dispatch.replay_candidate`
- `runs.context.evented_dispatch.orphan_classification`
- `runs.context.evented_dispatch.manual_replay.replacement_run_id`
- `runs.context.evented_dispatch.replay_of_run_id`

No in-memory duplicate guard is authoritative.
The repository transaction and durable lineage fields remain the source of truth.

## Operator-visible rejection reasons

The replay command continues to return stable rejection codes and now prints a short operator-facing explanation beside the code.

Current replay rejection reasons are:

- `run_not_found`
- `missing_evented_dispatch`
- `already_applied`
- `already_terminal`
- `work_item_not_in_progress`
- `recovery_candidate_required`
- `replay_candidate_required`
- `missing_orphan_classification`
- `already_replayed`
- `replay_attempt_not_allowed`
- `not_evented_execution`

The CLI now surfaces both the stable code and a short explanation, for example when a replay candidate marker is missing.

## Remaining replay risks after this hardening step

This step hardens eligibility and duplicate suppression, but it does not solve every replay risk.

Remaining gaps include:

- no automatic repair for inconsistent lineage if one side was mutated manually outside the normal flow
- no replay cancellation flow
- no operator batching or replay queueing
- no daemon-live replay orchestration changes
- no new policy for what to do after a replay run itself later becomes orphaned

Those remain follow-up concerns and are intentionally outside this session.
