# Session 31: Daemon-Safe Replay and Replacement-Attempt Policy

This session implements a narrow hardening step on the existing manual replay line.

It does:

- make the existing manual replay action safe to use while the scheduler daemon is active
- add explicit operator-facing surfacing for the case where the replacement replay attempt itself later becomes stale/orphaned

It does not:

- change gateway behavior
- add automatic replay
- add retry
- add replay-of-replay
- add worker reattachment
- broaden into tool worker or conversation worker scope

## What changed

### 1. Manual replay now has a daemon-safe path

Before this session, `pb scheduler replay-run <runId>` only worked by constructing a local scheduler/execution stack in the CLI process.
That was intentionally blocked when the scheduler daemon was live, because the daemon already owned the active execution plane.

This session adds a narrow scheduler-daemon control socket and reuses the existing scheduler command handler so the CLI can ask the active daemon to run the same replay operation itself.

Operationally:

- if the scheduler daemon is not running, `pb scheduler replay-run` keeps the prior local CLI replay path
- if the scheduler daemon is running, `pb scheduler replay-run` sends a narrow `replay_run` command to the active daemon control socket
- the daemon then calls the existing `scheduler.replayRun(runId)` path

That means daemon-live replay now uses the same scheduler-owned evented dispatch flow as normal evented execution ownership, instead of trying to duplicate daemon execution ownership inside the CLI process.

### 2. Replacement-attempt stale/orphan policy is now surfaced explicitly

The system still does not permit replay-of-replay.
That remains an explicit safety boundary.

What changed is operator surfacing.
`pb scheduler inspect-run <runId>` now derives and prints a stable operator-facing policy block when the replacement replay attempt is itself later classified as stale/orphaned:

- `replayChainState: replay_replacement_orphaned`
- `replayChainOutcome: unresolved`
- `operatorPolicyState: replacement_attempt_orphaned`
- `operatorPolicyReason: replacement_attempt_stale_timeout`
- `operatorNextStep: inspect the replacement attempt; do not replay it again; no automatic follow-up exists`

This is derived from durable state already present on the replacement run:

- replay lineage (`replay_of_run_id`)
- replacement run orphan classification (`orphan_classification = stale_timeout`)
- replacement continuation status (`result_continuation_applied = false`)

No new automatic behavior is introduced.
The system stays conservative and makes the condition explicit instead of leaving operators to infer it from raw lineage plus orphan fields.

## How replay safety rules are preserved

This session does not weaken the replay model from Sessions 24 through 29.

The daemon-safe path still preserves all existing invariants:

1. Same work item only
   - replay still creates a new run on the same work item

2. New replacement run only
   - the original run is not rewritten into the replacement attempt

3. Original continuation is durably suppressed before replay dispatch
   - replay still goes through `repository.startEventedManualReplay(...)`
   - that durable step still records original-run continuation suppression before replacement dispatch starts

4. Replacement run is dispatched through the existing evented path
   - daemon-live replay now calls `scheduler.replayRun(...)` inside the daemon
   - that is the same path that publishes the replacement attempt into the evented execution flow

5. Duplicate replay suppression still holds
   - replay eligibility and duplicate suppression remain repository-driven
   - the daemon-safe path does not bypass those checks

6. Direct mode remains unaffected
   - if the scheduler is running in direct mode, replay still rejects with the same `not_evented_execution` result
   - non-daemon direct behavior is unchanged

## Operator-facing behavior now

### When the daemon is active

Operators can now run:

`pb scheduler replay-run <runId>`

without first stopping the daemon.

The daemon executes the replay request and the CLI prints the same replay outcome/inspection surfaces afterward.

### When the replacement replay attempt later becomes stale/orphaned

Operators should treat that as a terminal policy boundary for this phase, not as permission to issue another replay.

Expected operator action:

1. Inspect the original or replacement run with `pb scheduler inspect-run <runId>`
2. Confirm the derived policy state/reason:
   - `replacement_attempt_orphaned`
   - `replacement_attempt_stale_timeout`
3. Do not replay the replacement attempt
4. Do not expect automatic follow-up, retry, or reattachment
5. Treat the chain as unresolved and escalate/operator-handle it outside the replay path

The important point is clarity:
the system now says explicitly that the first replacement attempt became the new stale/orphaned problem, and that Phase 2D still stops there on purpose.

## What did not change

- gateway IPC and gateway RPC behavior did not change
- replay eligibility gates are not weaker
- replay-of-replay is still forbidden
- no retry path was added
- no automatic recovery path was added
- no worker reattachment path was added
- no tool worker or conversation worker behavior changed

## Why this is still conservative

This session improves operational safety and operator clarity, but it does not claim full recovery completeness.

The daemon-safe replay path solves the ownership problem of using manual replay while the daemon is active.
The replacement-attempt policy surfacing solves the ambiguity problem when the replacement attempt later stalls.

What still remains before broader-use readiness:

- broader workflow validation around daemon-live replay in more realistic restart/operator sequences
- a more explicit operator audit trail if replay actions need stronger provenance than run metadata
- a later architecture decision for what the system should do beyond surfacing `replacement_attempt_orphaned`
- broader evented-mode hardening before default-mode reconsideration

So after Session 31:

- direct mode still remains the default
- evented mode is still controlled-rollout ready, not default-ready
- manual replay is safer to operate with the daemon live, but still remains a guarded intervention tool rather than a broad routine-use feature
