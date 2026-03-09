# Session 26: Replay Lineage Inspection

This session adds narrow, read-only operator visibility for manual replay lineage and replay state.

It stays inside the existing inspection surface:

- `pb scheduler inspect-run <runId>`

It does not change gateway behavior, IPC, direct vs evented semantics, replay eligibility, replay dispatch, retry behavior, recovery behavior, or worker topology.

## What operators can now inspect

`inspect-run` now makes replay lineage explicit for three cases:

- a normal non-replay run
- an original evented run that has already been manually replayed
- a replacement run that is itself the replay attempt

The output now explicitly surfaces:

- `runId`
- `goalId`
- `workItemId`
- run status
- work item status
- execution mode
- `isReplayAttempt`
- `replay_of_run_id`
- `replacement_run_id`
- `replay_started_at`
- `original_continuation_suppressed_at`
- `recoveryCandidate`
- `replayCandidate`
- `orphanClassification`
- `resultContinuationApplied`
- `dispatchedAt`
- age since dispatch

It also adds two small derived helpers in the CLI output:

- `replayLineageRole`: `none`, `original`, or `replacement`
- `replayLineagePeerRunId`: the other run in the lineage when one exists

That gives operators a direct way to inspect lineage from either side without adding a second mutating or query-heavy replay command.

## Durable fields used

The inspection output remains read-only and is derived from existing durable state already written by Sessions 20A through 25.

For evented reconciliation and operator intent it reads:

- `runs.context.evented_dispatch.execution_mode`
- `runs.context.evented_dispatch.lane_id`
- `runs.context.evented_dispatch.dispatched_at`
- `runs.context.evented_dispatch.result_continuation_applied`
- `runs.context.evented_dispatch.result_continuation_applied_at`
- `runs.context.evented_dispatch.orphan_classification`
- `runs.context.evented_dispatch.orphan_detected_at`
- `runs.context.evented_dispatch.recovery_candidate`
- `runs.context.evented_dispatch.recovery_candidate_marked_at`
- `runs.context.evented_dispatch.recovery_candidate_reason`
- `runs.context.evented_dispatch.replay_candidate`
- `runs.context.evented_dispatch.replay_candidate_marked_at`
- `runs.context.evented_dispatch.replay_candidate_reason`

For replay lineage specifically it reads:

- `runs.context.evented_dispatch.manual_replay.replacement_run_id`
- `runs.context.evented_dispatch.manual_replay.requested_at`
- `runs.context.evented_dispatch.manual_replay.original_continuation_suppressed_at`
- `runs.context.evented_dispatch.replay_of_run_id`
- `runs.context.evented_dispatch.replay_started_at`

No new durable write paths were introduced in this session.

## How to tell original vs replacement

Operators can now distinguish the lineage roles with a narrow set of rules:

- non-replay run:
  - `isReplayAttempt = false`
  - `replayLineageRole = none`
  - `replay_of_run_id` absent
  - `replacement_run_id` absent
- original replayed run:
  - `isReplayAttempt = false`
  - `replayLineageRole = original`
  - `replacement_run_id` present
  - `original_continuation_suppressed_at` present
  - `replay_of_run_id` absent
- replacement replay attempt:
  - `isReplayAttempt = true`
  - `replayLineageRole = replacement`
  - `replay_of_run_id` present
  - `replay_started_at` present
  - `replacement_run_id` absent

This is intentionally inspection-only.
The command reports durable lineage/state; it does not decide whether replay was correct or whether any later recovery action should be allowed.

## What operators still cannot do

From this surface, operators still cannot:

- start a replay
- retry a run
- clear or rewrite replay lineage
- recover a work item automatically
- reattach a worker
- force continuation application
- mutate any run, work item, or goal state

The session is strictly read-only visibility.

## Why this supports future replay hardening

Session 25 added the first safe manual replay path, but replay lineage was still awkward to inspect once a replacement run existed.

This session closes that visibility gap without broadening behavior:

- operators can inspect replay state from either the original run or the replacement run
- replay suppression state is visible on the original run
- replay attempt ancestry is visible on the replacement run
- non-replay and direct-mode inspection still remain clean

That gives future replay hardening work a stable operator-visible baseline before any later scope such as richer replay UX, stronger auditing, retry policy, or automated recovery is considered.
