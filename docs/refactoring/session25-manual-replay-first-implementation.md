# Session 25: Manual Replay First Implementation

This session implements the first safe manual replay action for evented execution runs.

It stays narrow:

- one operator-triggered replay action
- same work item
- one new replacement run
- original-run continuation durably suppressed before replay dispatch
- replacement run dispatched through the existing evented `task.ready` path

It does not change gateway behavior, public RPC behavior, IPC transport shape, tool worker behavior, conversation worker behavior, direct-mode semantics, or automatic recovery policy.

## Exact replay action now implemented

The new operator action is:

- `pb scheduler replay-run <runId>`

The command is intentionally conservative.
It refuses to run while the scheduler daemon is still active.
That keeps this first implementation inside one process boundary and avoids introducing new gateway or IPC behavior for replay dispatch.

When allowed, the action:

1. validates the target run against the conservative replay gate set
2. durably suppresses the original run's continuation authority
3. creates one replacement run on the same work item
4. records original-to-replacement and replacement-to-original lineage durably
5. dispatches the replacement run through the existing scheduler evented dispatch path, which publishes `task.ready`

## Durable gate checks

Replay start now requires all of the following durable checks to pass:

- target run exists
- target run has a valid `runs.context.evented_dispatch`
- `runs.context.evented_dispatch.execution_mode = "evented"`
- target run status is still `running`
- target work item is still `in_progress`
- `result_continuation_applied = false`
- `recovery_candidate = true`
- `replay_candidate = true`
- `orphan_classification` is present
- target run is not already a replay attempt (`replay_of_run_id` absent)
- target run has not already been replayed (`manual_replay.replacement_run_id` absent)

If any gate fails, replay is rejected and no durable mutation is written.

## How original-run continuation is suppressed

The suppression marker lives in the existing narrow evented checkpoint area:

- `runs.context.evented_dispatch.manual_replay`

On the original run, replay start writes:

- `requested_at`
- `requested_reason = "manual_operator_request"`
- `replacement_run_id`
- `replacement_run_created_at`
- `original_continuation_suppressed_at`

That write happens in the same database transaction that creates the replacement run.
Within that transaction, the original run is updated first and the replacement run is inserted second.

Scheduler-side continuation claim now consults this durable marker.
`claimEventedResultContinuation(...)` refuses to claim a run whose `manual_replay.original_continuation_suppressed_at` is present and returns `suppressed_by_replay` instead.

## How replacement run lineage is recorded

Lineage is recorded on both sides in `evented_dispatch`.

On the original run:

- `manual_replay.replacement_run_id`

On the replacement run:

- `replay_of_run_id`
- `replay_started_at`

This is enough to answer:

- which run was replayed from which original
- which original run has already been replayed
- which run is itself a replay attempt

## What happens if a late original result arrives

Late `execution.completed` or `execution.failed` for the original run can still arrive.
They are now durably suppressible.

The suppression path is:

1. scheduler receives the late result
2. scheduler calls the existing durable continuation-claim boundary
3. repository sees `manual_replay.original_continuation_suppressed_at`
4. claim is rejected as `suppressed_by_replay`
5. scheduler drops the late original continuation attempt

That means the late original result does not become the authoritative continuation-driving attempt and does not re-apply scheduler continuation.
The replacement run remains the only attempt allowed to claim continuation.

## Remaining hardening gaps

This session intentionally stops at the smallest safe manual replay action.
Before replay should be considered hardened, the system still needs:

- a cleaner operator path for replay while a long-lived scheduler daemon is running
- stronger replay-specific operator UX and inspection output
- broader coverage around end-to-end replay command execution
- clearer lifecycle treatment for the superseded original run beyond continuation suppression alone
- explicit policy for repeated operator interaction while a replacement replay run is itself still in flight
- any later work on automatic replay, retry, worker reattachment, or batch replay

Those are follow-up hardening steps, not part of this session.
