# Session 44: Local Tool Late-Result Diagnostics

## Scope

This session hardens local-only diagnostics for the authoritative `LocalToolWorker` path.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign tool execution or recovery
- broaden into conversation worker extraction
- add evented or multi-process tool dispatch
- redesign MCP lifecycle ownership
- redesign permission or policy ownership
- redesign prompt or tool schema generation
- add durable storage or tool ledgers
- move timeout ownership out of `LocalToolWorker`

## What Changed

The existing in-memory inspection and request-registry metadata now answer more explicit questions about local timeout, late-completion, and invalid-completion behavior.

### `LocalToolWorker.inspect()` now exposes explicit terminal-path diagnostics

Each inspection record now includes:

- `terminalPath`
  - `tool_completed`
  - `tool_failed_result`
  - `tool_invalid_request`
  - `tool_invalid_result`
  - `tool_timeout`
  - `tool_worker_exception`
- `timedOut`
- `lateCompletionObserved`
- `lateCompletionCount`
- `invalidCompletionObserved`
- `mismatchedCompletionObserved`

This keeps the existing request identity fields and normalized failure code/message, but makes the winning terminal path explicit instead of forcing developers to infer it indirectly from `outcome` and `failureCode`.

### `LocalToolWorker.inspect()` now includes a compact summary view

The top-level inspection snapshot now also includes `summary` with narrow counters:

- total request count
- in-flight count
- recent count
- success/failure/invalid counts
- timed-out request count
- requests that later observed a late completion
- total ignored late-completion count
- duplicate-dispatch suppression count
- invalid-completion count
- mismatched-completion count

This is still local, in-memory, and read-only.

### Request-registry terminal metadata is more explicit

`ToolRequestRegistry.inspect()` terminal metadata now includes:

- `terminalPath`
- `timedOut`
- `lateCompletionObserved`
- `invalidCompletionObserved`
- `mismatchedCompletionObserved`

The registry still does not own timeout policy or general execution policy. It only records narrower terminal metadata for the single promise it already owns.

## How Specific Cases Now Surface

### Timed-out requests

When the local timeout wins:

- the returned `ToolResult` remains the same normalized failure with `TOOL_EXECUTION_TIMEOUT`
- the worker inspection record shows:
  - `outcome: 'failure'`
  - `terminalPath: 'tool_timeout'`
  - `timedOut: true`
- the registry terminal metadata shows:
  - `terminalPath: 'tool_timeout'`
  - `timedOut: true`

This makes timeout visible without changing the caller contract.

### Late completions after timeout

If the underlying tool later resolves or throws after timeout already terminated the caller-facing promise:

- continuation behavior remains unchanged
- no second terminal worker event is published
- the registry still increments `ignoredCompletionCount`
- the registry also marks `lateCompletionObserved: true`
- the worker inspection record marks:
  - `lateCompletionObserved: true`
  - `lateCompletionCount`

This makes it visible that timeout won first and that a later completion was subsequently ignored.

### Invalid or mismatched completions

Invalid request identity and invalid/mismatched tool results now surface more explicitly:

- invalid request normalization records `terminalPath: 'tool_invalid_request'`
- invalid result normalization records `terminalPath: 'tool_invalid_result'`
- invalid completion cases mark `invalidCompletionObserved: true`
- mismatched correlation cases also mark `mismatchedCompletionObserved: true`

The existing normalized failure codes remain the detailed reason:

- `TOOL_REQUEST_INVALID`
- `TOOL_RESULT_INVALID`
- `TOOL_RESULT_MISMATCH`

The new fields make the category visible without changing result semantics.

### Duplicate completion suppression

Duplicate dispatch suppression remains unchanged and still reports:

- `duplicateSuppressed`
- `duplicateDispatchCount`

Late completions after a prior terminal result are now easier to distinguish from duplicate dispatch suppression because they surface separately through:

- registry `ignoredCompletionCount`
- registry `lateCompletionObserved`
- worker `lateCompletionObserved`
- worker `lateCompletionCount`

## What Did Not Change

- `LocalToolWorker` still owns local timeout policy.
- `ToolRequestRegistry` still owns registration, one caller-facing promise, one terminal resolution, and narrow terminal metadata only.
- `ReActIntegration` still dispatches one request, awaits one `Promise<ToolResult>`, and continues once.
- Local and MCP-backed tools still run through the same `ToolPort` boundary.
- No durable inspection surface was added.
- No scheduler-facing behavior changed.

## Remaining Gaps Before Any Broader ToolWorker Review / Closure Session

This session is still inspection-only hardening. The following remain outside scope:

- durable tool request/result inspection history
- cross-process or daemon-visible tool inspection surfaces
- evented tool dispatch/result ownership
- restart-safe late-result accounting
- any broader timeout/cancellation redesign
- MCP lifecycle redesign
- permission/policy ownership changes
- broader ToolWorker closure or default-readiness review

Those should be handled only in a later review/closure session if still justified.

## Validation

Validated with:

- `npx jest test/runtime/tool-boundary/request-registry.test.ts test/runtime/workers/tool-worker.test.ts --runInBand`
- `npx jest test/autonomy/react-integration.test.ts --runInBand`
- `npm run build`
