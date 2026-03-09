# Session 15 - Failure Payload Enrichment

## What changed

`execution.failed` now carries a normalized failed execution result by default from `LocalExecutionWorker`, instead of only the bare worker error payload.

The event payload remains backward-compatible:

- `payload.request` is unchanged
- `payload.error` is still present for legacy consumers
- `payload.result` is now included by default and is shaped like a failed `ExecutionResult`

The normalized failed result contains:

- `runId`
- `goalId` when available from the execution request
- `workItemId`
- `source` set to the execution worker source
- `success: false`
- `outcome: "failure"`
- `error`
- `tokensUsed`
- `timeSeconds`
- `costUsd`
- `artifacts`
- `actualModel` / `endpointId` when already available from the execution path

When `ExecutionPort.execute(...)` throws, the worker synthesizes the same failed-result shape with zeroed usage and the worker exception details.

## Structural convergence

Success and failure payloads are now closer structurally in evented mode:

- `execution.completed` continues to carry `payload.result`
- `execution.failed` now also carries `payload.result`

The two paths still differ slightly because failure events retain the legacy top-level `payload.error` field for compatibility, while success events do not need an equivalent shim.

## Evented mode improvements

This improves scheduler-side continuation in evented mode without changing continuation ownership or execution mode semantics.

The scheduler can now consume richer failure results by default for:

- usage accounting
- run completion persistence
- endpoint/model diagnostics already present in the execution result
- consistent failure status/error handling without depending on ad hoc reconstruction

This removes the normal need for zero/default usage fallback when the local worker is the event source and the execution boundary already knew real failure-side usage.

## What did not change

- Gateway behavior
- IPC behavior
- execution mode switching semantics
- direct mode behavior
- retry, recovery, or restart design
- worker extraction scope beyond the local execution worker failure payload

## Remaining gaps

Failure handling is still not fully symmetrical with success handling.

Remaining gaps include:

- legacy or third-party `execution.failed` publishers may still send only `payload.error`, so the scheduler keeps a compatibility fallback that synthesizes a minimal failed result
- failed results still only include diagnostics that are already naturally available at the execution boundary; this session does not add deeper provenance or recovery metadata
- broader restart/reconciliation guarantees for missed worker result events are still out of scope
