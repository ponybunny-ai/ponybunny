# Session 20A: Operator-Visible Reconciliation Inspection

## What changed

This session adds a narrow, read-only inspection surface for evented execution reconciliation state.

Two layers now expose the same durable reconciliation picture:

- repository query helpers for evented in-flight inspection, orphaned inspection, and a small summary
- scheduler CLI subcommands for operators:
  - `pb scheduler in-flight`
  - `pb scheduler orphaned`
  - `pb scheduler reconciliation-summary`

The new surface is intentionally inspection-only. It does not replay, retry, recover, reattach workers, or mutate run/work item state.

## Repository/query surfaces

The persistence layer now exposes three narrow helpers:

- `listEventedInFlightRunInspections()`
- `listEventedOrphanedRunInspections()`
- `getEventedRunReconciliationSummary()`

These helpers avoid a broader repository redesign. They return only the data needed for operator inspection of evented reconciliation state.

The inspection record is built from existing durable run and work item state:

- `runs.status`
- `work_items.status`
- `runs.context.evented_dispatch.execution_mode`
- `runs.context.evented_dispatch.lane_id`
- `runs.context.evented_dispatch.dispatched_at`
- `runs.context.evented_dispatch.result_continuation_applied`
- `runs.context.evented_dispatch.result_continuation_applied_at`
- `runs.context.evented_dispatch.orphan_classification`
- `runs.context.evented_dispatch.orphan_detected_at`

No new gateway, IPC, or execution-mode semantics were introduced.

## What operators can now see

`pb scheduler in-flight` lists durable evented runs that are still `running` and whose scheduler-side result continuation has not been applied yet.

`pb scheduler orphaned` lists the subset of those runs that already carry an orphan marker.

`pb scheduler reconciliation-summary` provides a simple count snapshot for:

- `in_flight_evented`
- `stale_orphaned`
- `continuation_applied`
- `already_terminal`

The CLI output surfaces practical operator fields from durable state:

- `runId`
- `goalId`
- `workItemId`
- run status
- work item status
- execution mode
- lane
- `dispatchedAt`
- age since dispatch
- `resultContinuationApplied`
- `orphanClassification`
- `orphanDetectedAt`

This gives operators a built-in way to inspect which evented runs are still awaiting continuation, which ones have already been conservatively marked stale/orphaned, and how large each category is.

## What operators still cannot do

This session does not add any recovery or control plane behavior.

Operators still cannot:

- replay an event
- retry a run
- recover a stale/orphaned run
- reattach a worker
- force result continuation
- mutate run/work item durable state from the new commands

Direct mode behavior remains unchanged. The new queries are scoped to evented checkpoint state and do not change direct execution semantics.

## Why this matters for later recovery work

Sessions 18 and 19 established durable reconciliation signals:

- continuation application is durably idempotent
- stale evented runs can be durably marked as orphaned

Session 20A makes those signals operator-visible without introducing recovery actions yet.

That prepares the next manual recovery sessions by establishing a shared read-only inspection surface first:

- operators can identify affected runs from the CLI
- future manual recovery commands can target already-visible durable records
- recovery policy can be added later without first redesigning how reconciliation state is queried

This session only adds visibility. Recovery remains future work.
