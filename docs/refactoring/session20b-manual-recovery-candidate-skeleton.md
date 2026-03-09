# Session 20B: Manual Recovery Candidate Skeleton

This session adds the smallest safe operator-facing preparation step for future manual recovery work in evented execution.

It does not change gateway behavior, IPC, worker lifecycle, or direct vs evented execution semantics.
It does not add replay, retry, worker reattachment, or automatic recovery.

## What changed

Two narrow CLI surfaces now exist under `pb scheduler`:

- `inspect-run <runId>`
- `mark-recovery-candidate <runId>`

Both operate on durable scheduler state in the existing runs table.

## `inspect-run`

`pb scheduler inspect-run <runId>` is read-only.

It prints one durable run record with the small set of fields an operator needs before any future manual recovery workflow, including:

- `runId`
- `goalId`
- `workItemId`
- `runStatus`
- `workItemStatus`
- `executionMode`
- `lane`
- `dispatchedAt`
- `age`
- `resultContinuationApplied`
- `resultContinuationAppliedAt`
- `orphanClassification`
- `orphanDetectedAt`
- `recoveryCandidate`
- `recoveryCandidateMarkedAt`
- `recoveryCandidateReason`

For direct runs, evented-only fields remain empty. This keeps direct mode behavior unchanged while still allowing a narrow inspect-one-run surface.

## `mark-recovery-candidate`

`pb scheduler mark-recovery-candidate <runId>` is a conservative manual action.

It only writes an operator-intent marker into the existing durable evented checkpoint at `runs.context.evented_dispatch`.

The marker fields are:

- `recovery_candidate = true`
- `recovery_candidate_marked_at = <timestamp>`
- `recovery_candidate_reason = "manual_operator_mark"`

The command is intentionally narrow:

- it only applies to runs with an existing evented dispatch checkpoint
- it only applies while the durable run is still `running`
- it does not mutate work item state
- it does not mutate goal state
- it does not requeue or restart execution
- it does not consume or publish any result event

## Idempotency

The manual mark is durable and idempotent.

If an operator marks the same run again:

- no second state transition is created
- the original `recovery_candidate_marked_at` is retained
- the original `recovery_candidate_reason` is retained
- the command reports that the run was already marked

## What operators still cannot do

This session does not provide any actual recovery capability.

Operators still cannot:

- replay a run
- retry a run
- reattach a worker
- force result continuation
- move work items or goals to new states
- trigger automatic recovery

## Why this matters

Earlier sessions established durable evented execution checkpoints, orphan classification, and result continuation idempotency.

This session adds the smallest missing operator preparation step: a durable way to inspect one run and intentionally label it for future manual recovery handling.

That gives later sessions a stable, explicit operator marker to build on when manual replay or recovery policy is introduced, without changing current execution behavior now.
