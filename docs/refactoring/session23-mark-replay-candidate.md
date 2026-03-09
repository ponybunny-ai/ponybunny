# Session 23: Mark Replay Candidate

This session adds one more conservative manual-recovery-preparation action for evented execution:

- `pb scheduler mark-replay-candidate <runId>`

The action is metadata-only.
It does not implement replay, retry, worker reattachment, or automatic recovery.
It does not change gateway behavior, IPC, or direct vs evented execution semantics.

## What the new action does

The command lets an operator record a narrower intent than `recovery_candidate`:
this run has been reviewed enough to be considered a candidate for a future manual replay workflow.

The command only operates on one durable run record and only mutates metadata inside the existing evented dispatch checkpoint.

It is intentionally gated behind the broader recovery marker.
An operator must first mark the run as a recovery candidate before it can be marked as a replay candidate.

## Durable fields written

The command writes only these fields under `runs.context.evented_dispatch`:

- `replay_candidate = true`
- `replay_candidate_marked_at = <timestamp>`
- `replay_candidate_reason = "manual_operator_mark"`

The implementation reuses the existing durable run context / `evented_dispatch` checkpoint.
No new table, IPC path, or scheduler continuation path is introduced.

## Preconditions

The command is allowed only when all of the following are true:

- the run exists
- the run has a valid `evented_dispatch` checkpoint
- `execution_mode = "evented"`
- `runs.status = "running"`
- `result_continuation_applied = false`
- `recovery_candidate = true`

If `recovery_candidate` is not already set, the command fails with `recovery_candidate_required` and does not mutate durable state.

## Idempotency

The action is idempotent.

On first success:

- `replay_candidate` becomes `true`
- the original mark timestamp and reason are stored

On repeated invocation:

- no additional side effects occur
- the existing timestamp and reason are preserved
- the command reports that the replay candidate was already marked

## What the action does not do

This command does not:

- replay execution
- retry execution
- mutate work item state
- mutate goal state
- mutate `runs.status`
- mutate `result_continuation_applied`
- mutate `orphan_classification`
- trigger scheduler continuation
- requeue work
- change direct-mode behavior

It is strictly an operator-intent marker.

## How it differs from `recovery_candidate`

`recovery_candidate` is the broad hold-for-review marker.
It says the run should remain visible in the manual recovery workflow.

`replay_candidate` is narrower.
It says the operator has additionally marked the run as a candidate for a future replay-oriented recovery action once replay safety exists.

In this session, `replay_candidate` does not grant replay authority and does not imply replay is safe today.

## Inspect output

`pb scheduler inspect-run <runId>` now shows:

- `replayCandidate`
- `replayCandidateMarkedAt`
- `replayCandidateReason`

For direct runs and runs without the marker, those fields remain empty.

## What still remains before actual manual replay can be implemented safely

The system still lacks the invariants required for real replay.
At minimum, future work still needs:

- an authoritative replay boundary and replay source of truth
- late-result suppression or quarantine semantics
- durable attempt ownership transfer rules
- proof that replay cannot double-apply continuation or side effects
- a defined relationship between original orphaned attempts and replacement attempts

Until those exist, `mark-replay-candidate` remains a metadata-only preparation step.
