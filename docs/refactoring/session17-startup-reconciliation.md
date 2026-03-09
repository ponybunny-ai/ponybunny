# Session 17: Evented Startup Reconciliation

This session adds the first hardening step for evented execution mode:

1. a minimal durable checkpoint that marks scheduler-owned evented dispatch on the run
2. a scheduler-daemon startup reconciliation pass that classifies durable in-flight candidates

This is intentionally detection and classification only. It does not introduce retry, replay, worker reattachment, or automatic recovery actions.

## What changed

### Durable checkpoint on the run

The scheduler now writes a narrow checkpoint into `runs.context.evented_dispatch` when an evented work item is dispatched through `task.ready`.

The checkpoint records:

- `execution_mode: "evented"`
- `lane_id` when available
- `dispatched_at`
- `result_continuation_applied`
- `result_continuation_applied_at` once the scheduler has durably consumed the authoritative result

This reuses the existing durable `runs.context` field rather than adding a new table or changing gateway / IPC contracts.

### Repository support for startup reconciliation

The repository now exposes:

- `mergeRunContext(...)` for narrow durable updates to run context
- `listInFlightRunReconciliationCandidates()` for querying `runs.status = "running"` joined with the current durable work item status

The query intentionally stays conservative. It surfaces in-flight durable state; classification decides whether a row is actually an evented candidate.

### Scheduler-daemon startup reconciliation

On scheduler-daemon startup, when `scheduler.executionMode === "evented"`, the daemon now:

1. queries in-flight run reconciliation candidates from the repository
2. inspects `run.context.evented_dispatch`
3. classifies each candidate
4. logs a startup summary and per-run findings

Direct mode skips this pass entirely.

## Classifications

The first pass uses these buckets:

- `not_evented_candidate`
  - the run is still durable `running`, but there is no valid `evented_dispatch` checkpoint
- `already_terminal_in_db`
  - the run or work item durable state already shows execution moved past the evented dispatch boundary, or the checkpoint says continuation was already applied
- `maybe_reattachable`
  - the run has a valid evented checkpoint, still looks in-flight, and the dispatch is recent enough that the daemon should treat it as possibly still live
- `likely_orphaned`
  - the run has a valid evented checkpoint, still looks non-terminal, but the durable state is stale or inconsistent enough that it is more likely orphaned than live

The current implementation uses a small recency window for the `maybe_reattachable` vs `likely_orphaned` split. This is only a classification heuristic; no automatic action follows from it yet.

## What the daemon now does on startup

The daemon now:

- performs the reconciliation scan before normal scheduler startup continues
- stores a reconciliation summary in memory for inspection/testing
- writes startup logs with counts and per-run findings

The daemon does not:

- retry or replay the run
- requeue the work item
- resume or reattach worker execution
- change gateway behavior
- change IPC contracts
- change direct vs evented execution semantics

## Why this is useful

Before this session, evented execution state depended heavily on volatile `activeExecutions`. After a daemon restart, durable `running` / `in_progress` rows existed, but there was no scheduler-owned durable marker that the run had entered evented dispatch and was still awaiting result continuation.

The new checkpoint closes that gap enough for startup inspection:

- the scheduler can now durably tell that a run crossed into evented dispatch
- startup code can distinguish direct-mode `running` rows from evented handoff rows
- operators get a conservative summary of possibly orphaned work without any risky automatic recovery

## What remains before real recovery can be introduced

This session does not make evented mode recovery-capable. Remaining work includes:

- durable authoritative result persistence for the scheduler-daemon evented spine
- idempotent replay / result-application rules based on durable state, not only in-memory correlation
- a real policy for timeouts, worker liveness, and safe reattachment
- explicit recovery actions for orphaned runs and `in_progress` work items

Until those exist, evented mode is better classified and easier to inspect, but it is not yet performing automated recovery.
