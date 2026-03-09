# Session 28: Replay Precheck and Confirmation Surface

This session adds a narrow, read-only operator surface for manual replay:

- `pb scheduler replay-precheck <runId>`

The command exists to answer a single question before `replay-run` is attempted:

- is this run eligible for manual replay right now, and if so, what will replay do?

It does not add any new recovery action and it does not change replay behavior.

## What changed

Session 27 hardened the durable replay gate set used by `replay-run`, but operators still had to infer eligibility by attempting the replay or by manually reading inspection fields.

Session 28 adds a dedicated precheck path that:

- evaluates the same durable replay eligibility rules used by `replay-run`
- reports `eligible: yes` or `eligible: no`
- prints stable rejection codes when replay is not allowed
- prints operator-facing expected consequences when replay is allowed
- remains strictly read-only

## Durable fields and checks used by the precheck

The precheck reuses the existing repository-side replay rejection classifier already used by `startEventedManualReplay`.

That means the command relies on the same durable state in `runs.context.evented_dispatch` and related work item state:

- `execution_mode`
- `result_continuation_applied`
- `orphan_classification`
- `recovery_candidate`
- `replay_candidate`
- `manual_replay.replacement_run_id`
- reverse replay lineage via `replay_of_run_id` on replacement runs
- run status
- current work item status

The read-only precheck returns the same stable rejection-style codes already used by replay start where applicable:

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

At the CLI level, the command also preserves the existing scheduler-mode gate:

- `not_evented_execution`

## Operator-visible output

When replay is eligible, the command prints:

- `eligible: yes`
- no rejection codes
- expected consequences in plain operator language:
  - original run continuation will be durably suppressed before replay dispatch
  - a replacement run will be created on the same work item
  - the replacement run will be linked to the original run
  - the replacement run will be dispatched through the existing evented path

When replay is not eligible, the command prints:

- `eligible: no`
- one stable rejection code plus a human-readable explanation
- no expected consequences

For consistency with prior inspection work, the command also prints the existing run inspection view when the run exists.

## How this differs from `replay-run`

`replay-precheck` is read-only.

It does not:

- mutate `runs`
- mutate `work_items`
- suppress continuation
- create a replacement run
- dispatch `task.ready`
- invoke scheduler continuation

`replay-run` still owns the actual replay mutation sequence:

- durable suppression of original continuation
- creation of the replacement run
- replay lineage linking
- evented dispatch

## What did not change

This session does not change:

- gateway behavior
- IPC
- direct vs evented execution semantics
- replay execution behavior
- retry behavior
- automatic recovery
- worker reattachment
- tool worker or conversation worker scope

## Remaining gap before a richer confirmation UX

This command is intentionally a narrow CLI inspection surface, not a full confirmation workflow.

What still remains for a richer UX or UI later:

- a dedicated confirmation prompt or interactive approval flow
- a structured machine-readable precheck output format if needed by future UI layers
- richer consequence detail such as predicted lane/model metadata if that becomes necessary
- any broader recovery dashboard or operator UI
