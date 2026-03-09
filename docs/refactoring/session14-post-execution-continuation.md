# Session 14: Post-Execution Continuation Cleanup

## What changed

This session narrows the scheduler-owned continuation boundary after an execution result exists.

`SchedulerCore` now routes both:

- direct-mode `ExecutionPort.execute(...)` results
- evented-mode `execution.completed` / `execution.failed` worker results

through a single internal helper:

- `continueAfterExecutionResult(...)`

That helper is now the scheduler's explicit post-execution continuation entry point.

## Unified continuation entry point

Once an `ExecutionResult` exists, `continueAfterExecutionResult(...)` owns the scheduler-side work that still belongs to the scheduler:

1. record budget usage
2. complete the run record
3. emit `run_completed`
4. clean up scheduler execution state at the mode-appropriate moment
5. branch into the existing success or failure continuation

The success branch still:

- moves the work item to `verify`
- emits verification lifecycle events
- runs `qualityGateRunner.runVerification(...)`
- marks the work item `done` when required gates pass
- routes verification failure back through the existing failure path

The failure branch still:

- emits `work_item_ended`
- invokes the existing retry policy
- queues the work item, blocks it, or fails it based on the current retry decision
- creates escalations when the retry strategy remains `escalate`
- advances goal failure state using the existing semantics

## What is now shared by direct and evented modes

Direct mode and evented mode now share the same narrow scheduler continuation for:

- budget usage recording
- run completion bookkeeping
- `run_completed` event emission
- transition into verification
- `qualityGateRunner` invocation
- work item done/failure progression
- retry/escalation continuation
- goal completion/failure progression after execution result handling

This keeps direct mode as the safe default while making evented mode converge on the same scheduler-owned continuation boundary after result availability.

## What remains asymmetric

The cleanup timing is still intentionally asymmetric:

- direct mode cleans up `activeExecutions` and lane occupancy in a `finally` path after the shared continuation returns
- evented mode cleans up `activeExecutions` and lane occupancy before entering the continuation, preserving the Session 13 worker-result ownership behavior

That asymmetry remains because direct mode is still the synchronous safe-default path, and this session does not redesign the broader scheduler lifecycle.

Evented failure payloads also remain asymmetric in practice:

- `execution.completed` carries a full `ExecutionResult`
- current `execution.failed` worker events still normally carry only an error payload

As a small safe improvement, the scheduler now accepts an optional full failed `result` payload on `execution.failed` and will record usage/accounting from it when present. Current worker behavior was not changed, so zeroed usage remains the normal fallback for evented failure handling today.

## What did not change

- gateway behavior
- IPC behavior
- event names
- tool worker architecture
- conversation worker architecture
- verification internals
- retry policy internals
- direct mode as the default

## Remaining gaps before evented mode is production-ready

Evented mode still should not be treated as production-ready because this session does not address:

- recovery for missed result events
- restart/replay hardening across process boundaries
- richer authoritative failure accounting emitted by the worker by default
- cancellation/abort redesign outside the current active execution window
- broader scheduler architecture cleanup beyond this narrow continuation boundary

## Validation focus

Focused scheduler tests cover:

- direct mode entering `continueAfterExecutionResult(...)`
- evented mode entering `continueAfterExecutionResult(...)`
- verification still running through the shared continuation
- failure/retry/escalation semantics remaining intact
- optional richer failure-side accounting when an evented failure includes a full failed result
