# Session 37: Authoritative Local ToolWorker

## Scope

This session makes the local in-process `LocalToolWorker` the authoritative tool dispatch seam for `ReActIntegration`.

It does not:

- change gateway behavior
- change IPC
- add evented tool dispatch
- change direct vs evented execution semantics
- redesign execution or recovery
- extract conversation work into a worker
- redesign MCP lifecycle ownership
- redesign permission or policy ownership
- redesign prompt or tool schema generation

## What Changed

`ReActIntegration` no longer treats `LocalToolAdapter` or an arbitrary `ToolPort` as the authoritative call seam.

Instead, the local flow is now:

1. build `ToolRequest`
2. dispatch it through `LocalToolWorker.dispatch(...)`
3. await `Promise<ToolResult>`
4. keep all result formatting, transcript append, and loop progression inside `ReActIntegration`

`LocalToolWorker` still delegates actual execution to the existing `ToolPort` implementation. In the default execution path that remains `LocalToolAdapter`, so policy checks, local-tool execution, and MCP-backed registry execution still run through the same implementation as before.

`ExecutionService` now wires `ReActIntegration` with the already-constructed local worker so the worker is authoritative in the default in-process path instead of remaining parallel-only.

## What Stayed The Same

- `ReActIntegration` is still the synchronous continuation owner after each tool result resolves.
- `complete_task` handling still lives in `ReActIntegration`.
- tool result formatting for model consumption still uses the existing `formatToolResultForModel(...)`.
- tool transcript append logic still lives in `ReActIntegration`.
- next-step loop decisions still live in `ReActIntegration`.
- `LocalToolAdapter` still owns actual local execution against `ToolEnforcer` and the tool registry.
- MCP-backed and built-in local tools still share one local execution path behind the worker.
- duplicate suppression is still in-process only and keyed by `toolRequestId`.

## Why ReActIntegration Still Owns Continuation

This session only changes the authoritative dispatch seam.

It does not introduce a second orchestration loop, event-driven handoff, or scheduler-visible tool-result continuation model. The safest first step is still to synchronously await the worker result in the same ReAct loop that issued the tool call.

That keeps one continuation owner:

- the worker owns dispatch and normalized result production
- `ReActIntegration` owns what happens after the `ToolResult` exists

This preserves direct-mode stability and avoids broadening into recovery, event delivery, or process-topology changes before the first authoritative worker step is proven safe.

## Preserved Invariants

- every dispatched request still carries a deterministic `toolRequestId`
- the consumed result must match the dispatched `toolRequestId`
- mismatched `toolRequestId` values are normalized into an invalid failed `ToolResult` at the worker boundary
- `ReActIntegration` still consumes exactly one awaited `ToolResult` per dispatch attempt
- success and failure both stay normalized through the existing `ToolResult` envelope
- duplicate in-process suppression still returns the same promise for the same `toolRequestId`
- scheduler-facing execution and recovery behavior is unchanged

## Next Safest ToolWorker Step

The next safe step is not evented tool execution.

The next step should be a narrow hardening pass around the now-authoritative local worker seam, for example:

- tighten any remaining correlation or integrity validation beyond `toolRequestId` if needed
- decide whether additional worker-owned result auditing is necessary while keeping continuation local
- document the exact conditions required before any future evented or durable tool-result handoff is attempted

Anything broader than that would expand scope into execution/recovery or process-topology redesign before the first authoritative local worker step has been validated sufficiently.
