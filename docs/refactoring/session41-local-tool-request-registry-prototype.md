# Session 41: Local Tool Request Registry Prototype

## Scope

This session implements the narrow local in-process request-registry prototype identified in Session 40.

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

## What Changed

A new local in-process `ToolRequestRegistry` now sits under the authoritative `LocalToolWorker` handoff path.

The registry is keyed by `toolRequestId` and stores the minimum identity and lifecycle metadata needed for the current prototype:

- `toolRequestId`
- `runId`
- `workItemId`
- `toolCallId`
- `toolName`
- `goalId` when present
- `registeredAt`
- terminal metadata after resolution

The registry owns the promise capability returned to the caller. `LocalToolWorker.dispatch(...)` now returns the registry-owned `Promise<ToolResult>` instead of directly returning the execution promise from the `ToolPort`.

## What The Registry Owns

For one local request lifecycle, the registry owns:

- request registration by `toolRequestId`
- the single promise awaited by the caller
- the pending vs resolved state for that request
- terminal metadata for the first winning completion
- duplicate registration suppression for matching identity
- duplicate completion suppression for continuation purposes

The current prototype keeps the smallest safe state model:

- `pending`
- `resolved`

Terminal outcome metadata records whether the winning resolution was:

- `success`
- `failure`
- `invalid`

No durable storage was added.

## When Registration Happens

Registration now happens inside `LocalToolWorker.dispatch(...)` before any actual tool execution begins.

That means:

1. `ReActIntegration` still creates one `ToolRequest`
2. `ReActIntegration` still calls `await toolWorker.dispatch(request)`
3. `LocalToolWorker` registers the request by `toolRequestId`
4. only after registration does the worker begin the authoritative local execution path

If a valid request reaches execution, a registry entry already exists before the underlying `ToolPort.execute(...)` path can complete.

## How Resolution Happens

`ToolRequestRegistry.register(...)` returns a narrow resolution owner only for the first authoritative registration.

That owner exposes the smallest completion surface needed by the current worker:

- `resolveSuccess(...)`
- `resolveFailure(...)`
- `resolveInvalid(...)`

`LocalToolWorker` remains the only component that receives that owner in the current implementation.

The worker still performs the same result normalization and integrity checks as before:

- invalid request normalization
- mismatched result identity normalization
- invalid failed-result normalization when `error` is missing
- exception normalization into failed `ToolResult`

After that normalization work is complete, the worker resolves the registry-owned promise exactly once with one terminal `ToolResult`.

## Duplicate Completion Suppression

Duplicate dispatch suppression is no longer just an in-memory map of raw execution promises.

It now works through the registry:

- a second registration with the same `toolRequestId` and matching identity gets the same pending or resolved promise
- only the first authoritative owner can resolve the request
- later completion attempts for that owner are ignored for continuation purposes
- ignored completion attempts are recorded only as narrow terminal diagnostics on the registry entry

This preserves the core invariant:

`ReActIntegration` still resumes exactly once for one dispatched request.

## What Did Not Change

The following behavior remains unchanged:

- `ReActIntegration` still owns continuation after `ToolResult` resolution
- the external caller contract is still one request dispatch and one awaited `Promise<ToolResult>`
- `toolRequestId` remains the primary correlation key
- `LocalToolWorker` is still the authoritative local seam
- local tools and MCP-backed tools still execute through the same underlying `ToolPort` / `LocalToolAdapter` path
- scheduler-facing execution and recovery semantics remain unchanged
- gateway behavior, IPC, and process topology remain unchanged

## Focused Validation

This session added focused coverage for:

- registry identity preservation
- registration-before-execution visibility
- single terminal resolution
- duplicate completion suppression
- duplicate dispatch promise reuse
- compatibility with both local and MCP-backed tool execution
- preservation of the await-based `ReActIntegration` contract

## Next Safest ToolWorker Step

The next safest step is still narrow and local:

Use this registry-backed promise handoff as the foundation for a less-direct internal local completion path, while keeping:

- `ReActIntegration` as continuation owner
- one awaited `Promise<ToolResult>`
- `toolRequestId` as the lookup key
- exactly one terminal normalized result per request

That next step should remain in-process first. It should not broaden into evented tool dispatch, durable ledgers, or ownership redesign.
