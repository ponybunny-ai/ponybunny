# Session 19: Conservative Timeout / Orphan Policy

## What changed

Evented in-flight runs now have a conservative stale-orphan policy that is limited to detection and durable marking.

A run is now treated as stale for this policy when all of the following are true:

- `runs.status = "running"`
- `runs.context.evented_dispatch.execution_mode = "evented"`
- `runs.context.evented_dispatch.result_continuation_applied = false`
- the associated work item is still `in_progress`
- `Date.now() - runs.context.evented_dispatch.dispatched_at > scheduler.eventedOrphanTimeoutMs`

The timeout threshold is configured by a new runtime config field:

- `scheduler.eventedOrphanTimeoutMs`
- env alias: `PONY_SCHEDULER_EVENTED_ORPHAN_TIMEOUT_MS`
- default: `1800000` ms (30 minutes)

This keeps the policy narrow and explicit without changing execution mode semantics.

## Durable marker

When the scheduler daemon detects a stale evented dispatch, it records the classification inside the existing durable checkpoint at `runs.context.evented_dispatch`:

- `orphan_classification = "stale_timeout"`
- `orphan_detected_at = <timestamp>`

The repository write is idempotent:

- it only applies to still-running evented runs whose result continuation has not already been recorded
- it does not overwrite an existing orphan marker
- repeated startup checks therefore do not create repeated durable mutations

No new top-level run status is introduced in this session.

## Daemon behavior

The scheduler daemon continues to scan evented in-flight runs during startup reconciliation.

During that startup pass it now:

1. classifies candidates using the configured stale timeout
2. marks only stale timeout cases durably
3. logs the startup summary and each finding
4. emits a debug event for newly marked stale runs when daemon debug emission is enabled

This session intentionally does not add a periodic sweep. Startup reconciliation is the smallest safe place in the current architecture to introduce conservative stale detection without broadening runtime behavior.

## What it does not do

This session does not implement:

- automatic replay
- automatic retry
- worker reattachment
- gateway changes
- IPC changes
- changes to direct mode semantics
- new UI surfaces
- scheduler-driven recovery beyond durable marking and diagnostics

Direct mode behavior remains unchanged.

## What remains before real recovery

Before broader recovery can be introduced, the system still needs explicit policy for what operators or future automation should do after a run has been marked with `orphan_classification = "stale_timeout"`.

That future work is still separate from this session and should cover, in order:

- how stale/orphaned runs are surfaced or queried operationally
- what recovery action types are allowed
- how replay or retry would be made safe against duplicate execution
- whether worker reattachment is possible in the current topology

Session 19 only establishes the conservative durable signal needed for that later work.
