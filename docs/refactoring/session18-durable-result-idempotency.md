# Session 18: Durable Result Idempotency

This session adds a narrow scheduler-side durable idempotency guard for evented execution result application.

## What changed

Evented result continuation is now claimed durably from `runs.context.evented_dispatch` before the scheduler applies the existing post-execution continuation path.

The scheduler uses the existing durable checkpoint fields:

- `evented_dispatch.execution_mode`
- `evented_dispatch.result_continuation_applied`
- `evented_dispatch.result_continuation_applied_at`

The repository now exposes a narrow compare-and-set style claim for evented result continuation:

- only `runs.status = 'running'`
- only runs with `context.evented_dispatch.execution_mode = 'evented'`
- only runs where `context.evented_dispatch.result_continuation_applied = false`

If those durable conditions still hold, the repository flips:

- `result_continuation_applied = true`
- `result_continuation_applied_at = <now>` if it was not already set

Only after that durable claim succeeds does the scheduler proceed through the existing scheduler-owned continuation.

## How durable idempotency is determined

Durable idempotency is determined from the run row, not from in-memory scheduler state.

Before applying an `execution.completed` or `execution.failed` result in evented mode, the scheduler checks durable checkpoint state by attempting to claim the continuation through the repository.

That claim succeeds at most once for a given `runId` because the durable update is conditioned on:

- the run still being durable `running`
- a valid `evented_dispatch` checkpoint existing
- `result_continuation_applied` still being `false`

If a later duplicate result arrives, the durable row already shows `result_continuation_applied = true`, so the scheduler suppresses the duplicate and does not re-apply work item or goal mutations.

## What state is checked before applying continuation

For evented result handling, the scheduler now checks:

1. active in-memory execution context still exists
2. durable checkpoint claim succeeds for the run

If there is no active in-memory context, the scheduler does not try to recover or replay continuation in this session. It only inspects durable run state read-only to classify the event as one of:

- already applied duplicate
- stale event after terminal durable state
- missing checkpoint / no resumable context yet

Direct mode does not use this path and remains unchanged.

## Duplicate delivery behavior

On the first evented result for a run:

- the scheduler claims durable continuation
- the run checkpoint records `result_continuation_applied = true`
- the existing success/failure continuation executes once

On duplicate `execution.completed` or duplicate `execution.failed`:

- the durable checkpoint already shows continuation applied
- the scheduler logs a narrow debug suppression message
- no second completion, retry, verification, escalation, or work item state mutation is applied

On a stale result event after the run is already terminal in durable state:

- the scheduler suppresses the event
- no continuation is re-applied

## What did not change

- no gateway behavior changes
- no IPC changes
- no direct vs evented execution mode semantic changes
- no replay or recovery implementation
- no worker reattachment
- no timeout policy changes
- no new operator-facing control surface

## Remaining limitations

This session only prevents duplicate scheduler-side continuation for evented result application when a live scheduler still has the relevant execution context.

It does not yet solve:

- recovering continuation after a restart when the run is still durable `running` but the in-memory execution context is gone
- replaying missed `execution.completed` / `execution.failed` events
- worker reattachment or authoritative worker liveness tracking
- deciding timeout or orphan handling policy for long-running evented dispatches

Those remain follow-up sessions. This session only makes duplicate result delivery durably suppressible.
