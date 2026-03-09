# Session 29: Replay Post-Run Diagnostics

This session extends the existing read-only operator inspection surface:

- `pb scheduler inspect-run <runId>`

The change is intentionally narrow. It adds post-replay outcome visibility for an inspected run and its replay peer when one exists. It does not add any new replay or recovery action.

## What the new diagnostics surface shows

`inspect-run` still prints the existing run inspection block and replay lineage fields.

It now also prints a derived `Replay Outcome` block that helps an operator answer the post-replay questions that were still awkward after Sessions 25 through 28:

- whether replay has been initiated
- whether a replacement run exists
- whether the original run continuation was durably suppressed
- which run currently acts as the original and which acts as the replacement
- whether the replacement run is still active or has reached a terminal state
- whether scheduler result continuation has been applied on the replacement run
- whether the replay chain currently appears active, completed, failed, or unresolved

The block is available when inspecting either side of the replay pair:

- inspecting the original run shows replacement-run status and outcome
- inspecting the replacement run shows origin linkage and the same derived chain state
- non-replay and direct-mode runs still inspect cleanly and report `replay_not_started`

## Durable fields and checks used

The new output stays read-only and relies on durable state that already exists in `runs`, `work_items`, and `runs.context.evented_dispatch`.

It uses the inspected run plus its linked replay peer, when the peer run record can be found, based on:

- `run.id`
- `run.goal_id`
- `run.work_item_id`
- `run.status`
- `work_items.status`
- evented-vs-direct inspection derived from the presence of `evented_dispatch`
- `evented_dispatch.dispatched_at`
- `evented_dispatch.result_continuation_applied`
- `evented_dispatch.result_continuation_applied_at`
- `evented_dispatch.orphan_classification`
- `evented_dispatch.recovery_candidate`
- `evented_dispatch.replay_candidate`
- `evented_dispatch.replay_of_run_id`
- `evented_dispatch.replay_started_at`
- `evented_dispatch.manual_replay.requested_at`
- `evented_dispatch.manual_replay.replacement_run_id`
- `evented_dispatch.manual_replay.original_continuation_suppressed_at`

For original-side inspection, `inspect-run` also falls back to reverse lineage lookup by `replay_of_run_id` if a replacement run exists but the original-side `manual_replay.replacement_run_id` field is absent. This keeps the read-only inspection surface more robust without changing replay behavior.

## Derived replay-chain interpretation

The CLI derives two operator-facing summaries:

- `replayChainState`
- `replayChainOutcome`

Current state labels:

- `replay_not_started`
- `replay_dispatched`
- `replay_in_progress`
- `replay_result_applied`
- `replay_terminal_failed`
- `replay_terminal_unapplied`
- `replay_unresolved`

Current outcome labels:

- `not_started`
- `active`
- `completed`
- `failed`
- `unresolved`

Interpretation:

- `replay_not_started` / `not_started`: no durable replay lineage or replay-start markers are present
- `replay_dispatched` / `active`: replay durable state exists but no replacement run record is currently resolvable yet
- `replay_in_progress` / `active`: replacement run exists, is still `running`, and has not yet applied result continuation
- `replay_result_applied` / `completed`: replacement run has durably claimed/applied scheduler continuation
- `replay_terminal_failed` / `failed`: replacement run reached `failure`, `timeout`, or `aborted` without result continuation being applied
- `replay_terminal_unapplied` / `unresolved`: replacement run reached `success`, but continuation-applied durability is still absent
- `replay_unresolved` / `unresolved`: the durable replay chain is incomplete or inconsistent for inspection purposes, such as a missing peer run record

The output also prints enough raw fields alongside the derived state that operators can verify the reasoning directly.

## What this surface still cannot do

This session remains inspection-only.

The new `inspect-run` output does not:

- mutate `runs`, `work_items`, or `goals`
- create replacement runs
- suppress continuation
- dispatch execution
- retry anything
- trigger scheduler continuation
- reattach workers
- alter gateway behavior, IPC, or execution-mode semantics

## Why this matters for future replay hardening

This gives operators a stable, narrow post-replay visibility surface before any broader recovery workflow is attempted.

That prepares the codebase for future work by separating:

- replay execution
- replay precheck
- replay post-run inspection

Future sessions can build on this diagnostic view for stronger replay hardening or broader recovery workflows without changing the current replay action model in this session.
