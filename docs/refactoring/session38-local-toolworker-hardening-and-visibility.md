# Session 38: Local ToolWorker Hardening and Visibility

## Scope

This session hardens the now-authoritative local in-process `LocalToolWorker` seam and adds a narrow read-only inspection surface for local tool dispatch/result handling.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- add evented or multi-process tool dispatch
- add durable tool request/result ledgers
- redesign execution or recovery ownership
- redesign MCP lifecycle ownership
- redesign permission or policy ownership
- redesign prompt or tool schema generation
- broaden into conversation worker extraction

## What Changed

### Integrity checks tightened at the worker boundary

`LocalToolWorker` now validates request identity context before execution starts. Missing or empty `toolRequestId`, `runId`, `workItemId`, `toolCallId`, or `toolName` values are normalized into a failed `ToolResult` with `TOOL_REQUEST_INVALID` and the underlying `ToolPort` is not called.

Returned `ToolResult` correlation is now checked against more than just `toolRequestId`. The worker now rejects mismatches in:

- `toolRequestId`
- `runId`
- `workItemId`
- `toolCallId`
- `toolName`
- `goalId` when the original request carried one

Any correlation break is normalized into a failed `ToolResult` with `TOOL_RESULT_MISMATCH`, using the original request identity as the authoritative envelope so the awaiting `ReActIntegration` continuation still consumes one safe result shape.

Failed results that omit an `error` payload are also normalized at the worker boundary into `TOOL_RESULT_INVALID`.

### Narrow inspection surface added

`LocalToolWorker` now keeps an in-memory read-only inspection snapshot of local dispatches. The new `inspect()` surface reports:

- dispatched request identity (`toolRequestId`, `runId`, `workItemId`, `goalId`, `toolCallId`, `toolName`)
- outcome (`success`, `failure`, or `invalid`)
- whether request/result correlation matched
- whether duplicate suppression was involved
- duplicate dispatch count for the same `toolRequestId`
- dispatch/completion timestamps
- normalized failure code/message when present

This remains local and in-process only. No durable ledger or new cross-process query path was added.

### Existing runtime tool events now carry inspection summaries

The existing `tool.requested`, `tool.started`, `tool.completed`, and `tool.failed` runtime events now include the current inspection summary in their payloads.

That gives developers and narrow debug/event consumers more immediate visibility into:

- which request was issued
- whether it stayed correlated
- whether the outcome was successful, failed, or invalid
- whether duplicate suppression occurred

## What Operators and Developers Can Now See

For the local ToolWorker path, they can now inspect:

- the exact request identity dispatched through the authoritative worker seam
- whether the returned result matched that identity context
- whether the worker normalized the outcome as `success`, `failure`, or `invalid`
- whether the same `toolRequestId` was deduplicated in-process
- the normalized failure code/message when correlation or request integrity broke

This is intentionally narrow visibility. It is sufficient for local-path diagnosis without introducing a full tool-result UI, cross-process command surface, or durable audit model.

## What Stayed The Same

- `ReActIntegration` still builds the `ToolRequest`, awaits one `ToolResult`, formats it for the model, and owns all post-result continuation.
- `LocalToolAdapter` still performs the underlying local/MCP-backed tool execution.
- duplicate suppression is still in-process only and keyed by `toolRequestId`.
- scheduler-facing behavior and direct-mode semantics are unchanged.
- policy checks, permission ownership, prompt generation, and tool schema generation are unchanged.

## Remaining Gaps Before Any Future Tool Mode Switch or Durable Tool Result Path

This session only hardens the local in-process seam. The following are still intentionally unresolved:

- durable request/result claims or ledgers
- restart-safe duplicate suppression
- evented tool-result ownership and scheduler-side continuation handoff
- late-result replay/reconciliation policy for tools
- multi-process or daemon-owned tool worker execution
- broader operator CLI/UI surfaces for tool execution history

Those remain future sessions. This session only proves and exposes the local authoritative seam more clearly before any broader tool-result architecture change is considered.

## Validation

Validated with:

- `npx jest test/runtime/workers/tool-worker.test.ts test/autonomy/react-integration.test.ts --runInBand`
- `npm run build`
