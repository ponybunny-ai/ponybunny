# Session 43: Local Tool Timeout Normalization

## Scope

This session implements the first narrow local timeout path for the authoritative `LocalToolWorker` request-registry handoff.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery
- broaden scope into conversation worker extraction
- implement evented or multi-process tool dispatch
- redesign MCP lifecycle ownership
- redesign permission or policy ownership
- redesign prompt or tool schema generation
- add durable tool ledgers
- redesign global timeout policy

## Where Timeout Now Lives

Timeout ownership now lives inside `LocalToolWorker`.

For the first authoritative registration of a request, the worker starts one local timer after `ToolRequestRegistry.register(...)` succeeds and before the underlying `ToolPort.execute(...)` path is awaited.

`ToolRequestRegistry` did not become a timeout-policy owner. It still only:

- registers by `toolRequestId`
- owns the caller-facing promise
- allows one terminal resolution
- records narrow terminal metadata

The worker now accepts a narrow local timeout option for construction-time override, but keeps a local default for normal runtime use. No scheduler-facing or user-facing timeout mode/config surface was added.

## How Timeout Resolves The Caller-Facing Promise

If the timer fires before a terminal result is produced, `LocalToolWorker` builds one normalized failed `ToolResult` from the original request identity and resolves the registry-owned promise through the existing failure path.

The normalized timeout result shape is:

```ts
{
  toolRequestId: request.toolRequestId,
  runId: request.runId,
  workItemId: request.workItemId,
  goalId: request.goalId,
  toolCallId: request.toolCallId,
  toolName: request.toolName,
  success: false,
  error: {
    code: 'TOOL_EXECUTION_TIMEOUT',
    message: `Tool '${request.toolName}' did not produce a terminal result before the local worker timeout`,
    recoverable: true,
  },
}
```

This keeps the caller contract unchanged:

- `ReActIntegration` still dispatches one `ToolRequest`
- it still awaits one `Promise<ToolResult>`
- it still continues exactly once

Timeout resolves the same promise shape as other worker outcomes. It does not introduce promise rejection as a second normal control-flow path.

## What Happens To Late Completions

If timeout wins first, the registry-owned promise is already terminal for that `toolRequestId`.

Any later success or failure from the underlying execution path is ignored for continuation purposes:

- it does not change the already-resolved promise
- it does not publish a second authoritative terminal worker event
- it increments the registry entry's ignored-completion count as narrow diagnostics

The first terminal completion still wins.

## What Did Not Change

The following behavior remains unchanged:

- `LocalToolWorker` is still the authoritative local seam
- `ToolRequestRegistry` is still a narrow registration + single-terminal-resolution primitive
- `toolRequestId` remains the primary correlation key
- local tools and MCP-backed tools still execute through the same `ToolPort` / `LocalToolAdapter` path
- `ReActIntegration` still owns continuation after `ToolResult` resolution
- scheduler-facing execution and recovery semantics remain unchanged
- gateway behavior, IPC, and process topology remain unchanged
- no broader cancellation, lifecycle, permission, or prompt/schema redesign was introduced

## Focused Validation

Focused coverage now includes:

- a hanging request normalizes to exactly one failed `ToolResult` with `TOOL_EXECUTION_TIMEOUT`
- timeout preserves request identity fields in the returned result
- late completion after timeout does not create a second terminal continuation path
- ordinary success and ordinary failure normalization still behave the same
- local and MCP-backed tool execution remain compatible through the same worker seam

## Next Safest ToolWorker Step

The next safest step is still narrow:

Improve local inspection around timed-out requests and late completions if additional operator visibility is needed, while keeping:

- timeout ownership inside `LocalToolWorker`
- `ToolRequestRegistry` as a narrow primitive
- one awaited `Promise<ToolResult>`
- no scheduler-owned or multi-process timeout handling

Anything broader should remain out of scope until this local timeout normalization proves sufficient.
