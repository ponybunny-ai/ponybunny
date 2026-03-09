# Session 40: Promise-Bridged Authoritative Tool Handoff Design

## Scope

This session is documentation only.

It defines the authoritative handoff model required before any future less-direct tool path is attempted.

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

## Why This Session Exists

Session 39 concluded that the architecture does not need a formal `toolExecutionMode` setting yet.

What it does need is a stricter handoff design for the first future cut where tool dispatch becomes less direct internally while still preserving the current caller contract:

- `ReActIntegration` dispatches one tool request
- `ReActIntegration` awaits one `Promise<ToolResult>`
- `ReActIntegration` resumes the same continuation after exactly one terminal result exists

The main architectural problem is not dispatch selection. It is continuation safety.

If a future tool path becomes less direct without a strict handoff contract, the likely failures are hung ReAct loops, split ownership over completion, double continuation, or misrouted results.

## Current Authoritative Local Tool Handoff Model

The current model is single-process, await-based, and continuation-owned by `ReActIntegration`.

### 1. Request creation

`ReActIntegration.executeToolCall(...)` creates the authoritative `ToolRequest` through `buildToolRequest(...)`.

That request currently includes:

- `toolRequestId`
- `runId`
- `workItemId`
- `goalId`
- `toolCallId`
- `toolName`
- arguments and local route context

`toolRequestId` is currently built as:

`{runId}:{toolCallId}:{toolName}`

That identity represents one concrete dispatch attempt from the active ReAct loop.

### 2. LocalToolWorker dispatch

After request creation, `ReActIntegration` calls:

`await toolWorker.dispatch(request)`

`LocalToolWorker` is the authoritative local dispatch seam. It:

- validates request identity
- suppresses duplicate in-process dispatches by `toolRequestId`
- delegates actual execution to `ToolPort.execute(...)`
- normalizes mismatched or invalid results into failed `ToolResult`s
- emits local visibility events (`tool.requested`, `tool.started`, `tool.completed`, `tool.failed`)

`LocalToolAdapter` remains the underlying local executor. It still owns:

- argument normalization
- permission and policy enforcement through `ToolEnforcer`
- tool lookup
- local built-in and already-registered MCP-backed tool execution
- normalization of execution failure into the `ToolResult` envelope

### 3. Synchronous await

The dispatch call is awaited synchronously at the point where the tool call was issued.

From the ReAct loop’s point of view, the tool path is still:

1. create one request
2. await one result
3. continue the same loop

There is no scheduler-owned tool completion path, no event-bus-owned continuation, and no background consumer that can legally continue the tool call on behalf of the loop.

### 4. Result correlation

The local worker currently enforces correlation primarily through `toolRequestId` and also checks:

- `runId`
- `workItemId`
- `goalId` when present
- `toolCallId`
- `toolName`

If the returned result identity does not match the request identity, the worker does not pass through the raw result. It normalizes the outcome into a failed `ToolResult`.

`ReActIntegration` then asserts final `toolRequestId` correlation again before formatting the result for the model.

### 5. Continuation ownership in ReActIntegration

`ReActIntegration` is the continuation owner.

After the awaited result exists, `ReActIntegration` alone is responsible for:

- accepting the terminal `ToolResult`
- formatting it for model consumption
- appending the tool output into the transcript
- deciding the next loop step

The worker does not own continuation, retry, scheduler follow-up, or recovery.

## What "Promise-Bridged Authoritative Handoff" Means

A promise-bridged authoritative handoff means this:

The internal dispatch path may become less direct in the future, but the external contract visible to `ReActIntegration` must still remain one awaited `Promise<ToolResult>` for one dispatched `ToolRequest`.

In other words:

- the internal path may stop being a single immediate call stack
- the request may pass through a local registry or coordinator before terminal completion
- result arrival may become indirect inside that coordinator
- but the ReAct loop must still experience the same contract:

`const result = await dispatchTool(request)`

That promise is the bridge.

It allows the system to introduce a less-direct internal handoff without moving continuation ownership out of `ReActIntegration`.

### Authoritative implications

For the first safe non-local cut, authoritative means:

- there is one request registration for one dispatched `toolRequestId`
- there is one waiting promise for that request
- there is one terminal resolution path back into that promise
- `ReActIntegration` continues only after that promise resolves to one normalized `ToolResult`

The handoff becomes less direct internally, but not less authoritative from the caller’s point of view.

## Minimum Moving Parts Required For A Future Promise-Bridge

The first future promise-bridged handoff needs only a small number of moving parts.

### 1. Request registration

Before the less-direct dispatch path begins, the system must register the request in an in-memory request registry keyed by `toolRequestId`.

The registration record should minimally contain:

- the original `ToolRequest`
- `toolRequestId`
- `runId`
- `workItemId`
- `toolCallId`
- registration timestamp
- current state such as `pending`, `resolved`, `timed_out`, or `cancelled`
- the promise capability used to resolve the waiting caller

Registration must happen before the request leaves the direct callsite. Otherwise a result could arrive before there is an owner capable of resolving it safely.

### 2. Correlation by `toolRequestId`

`toolRequestId` remains the primary correlation key.

Any future less-direct result path must look up the pending request by `toolRequestId` first.

Additional identity checks should still validate:

- `runId`
- `workItemId`
- `toolCallId`
- `toolName`
- `goalId` when present

Those fields remain integrity anchors, but they should not replace `toolRequestId` as the primary lookup key.

### 3. Result resolution

Exactly one normalized terminal `ToolResult` must resolve the registered promise.

The resolution path should accept:

- success results
- ordinary failed results
- invalid-result normalization
- timeout-produced failed results
- cancellation-produced failed results if cancellation is introduced

All of those count as one terminal result for one request.

### 4. Timeout or missing-result behavior

If no result arrives within the bounded wait window chosen by the future implementation, the request must terminate locally as a normalized failed `ToolResult`.

That timeout failure should:

- preserve the original request identity
- use a stable failure code
- resolve the waiting promise exactly once
- mark the registry entry terminal

The first safe cut should prefer explicit timeout normalization over an indefinitely hung promise.

This is not a redesign of recovery. It is a local await-safety requirement.

### 5. Duplicate result suppression

If more than one completion arrives for the same `toolRequestId`, only the first terminal completion may resolve the waiting promise.

Later arrivals must be ignored for continuation purposes and recorded only as duplicate completions for diagnostics.

The key rule is:

duplicate completions must never produce multiple ReAct loop continuations.

### 6. Invalid result normalization

If a future less-direct path produces:

- missing identity
- mismatched identity
- malformed failed results without an error payload
- structurally invalid completion data

the bridge must normalize that completion into one failed `ToolResult` for the original request instead of surfacing a new control-flow shape.

This preserves the current invariant that the continuation sees one `ToolResult`, not an open-ended set of transport-specific failures.

### 7. Cancellation or abort interaction

Cancellation is not a required redesign in this session, but the future bridge should reserve a terminal path for it.

If the waiting context is aborted before a result arrives:

- the registry entry should become terminal once
- the waiting promise should resolve or reject in one consistent way chosen by the bridge contract
- any later completion must be suppressed as non-authoritative

For the first safe cut, the better fit is to normalize cancellation into a failed `ToolResult` rather than introducing promise rejection as a second ordinary completion channel.

That keeps the current "one awaited `ToolResult`" contract intact.

## Authoritative Ownership Model

The future promise-bridge needs explicit ownership rules.

### Who creates the promise

The authoritative dispatch owner should create the promise at request registration time, before the request enters the less-direct path.

For the first safe cut, that owner should remain the local authoritative dispatch seam directly beneath `ReActIntegration`.

That means:

- `ReActIntegration` still initiates dispatch
- the bridge-capable local worker or coordinator creates the registered promise
- `ReActIntegration` receives that promise immediately and awaits it

`ReActIntegration` should not create an externally-resolved promise and hand it outward. It should remain the caller, not the registry owner.

### Who resolves it

Only the authoritative bridge owner that controls the request registry may resolve the promise.

That owner resolves the promise after:

1. locating the pending entry by `toolRequestId`
2. validating correlation
3. normalizing the terminal result
4. atomically marking the entry terminal

The underlying executor, transport callback, event subscriber, or any future non-local courier should not resolve the caller promise directly. They should deliver a candidate completion into the authoritative bridge owner.

### Who is allowed to reject or fail it

For the first safe non-local cut, ordinary tool outcomes should still be delivered as resolved `ToolResult` values, not rejected promises.

That means the bridge owner is allowed to fail the request by resolving a normalized failed `ToolResult` when it sees:

- timeout
- invalid completion data
- correlation mismatch
- explicit cancellation if supported
- internal bridge exception that can be converted safely

Promise rejection should be reserved for truly unrecoverable bridge-internal defects only, and the preferred design is to avoid even that in the normal tool path.

### What happens if more than one result arrives

The first terminal completion wins.

After the registry entry becomes terminal:

- the promise must not change again
- later completions for the same `toolRequestId` must be ignored for continuation purposes
- duplicate arrivals may be emitted to inspection or diagnostics, but they must not re-enter `ReActIntegration`

### What happens if no result arrives

The registry owner must terminate the request locally through timeout normalization.

The waiting continuation must not hang indefinitely and must not transfer completion ownership to the scheduler, gateway, or another background subsystem.

## Preserved Invariants

Any first promise-bridged handoff must explicitly preserve these invariants:

- `ReActIntegration` remains the continuation owner
- one dispatched request yields one terminal `ToolResult`
- `toolRequestId` remains the primary correlation key
- `runId` and `workItemId` remain continuity anchors
- direct-mode stability is preserved
- no scheduler-owned tool continuation is introduced

The following should also remain true:

- success, failure, invalid, timeout, and cancellation-normalized outcomes all resolve into the same `ToolResult` envelope
- the bridge does not mint replacement execution identity
- the bridge does not create a second replay or recovery authority

## What Should Not Be Added In The First Non-Local Handoff Implementation

The first non-local handoff implementation should stay narrow.

It should not add:

- a durable tool ledger
- restart-safe tool reconciliation
- MCP lifecycle migration
- permission or policy authority migration
- scheduler-owned tool completion
- gateway-owned tool completion routing
- multi-process tool dispatch
- evented tool continuation owned by runtime event subscribers
- prompt or tool schema ownership changes
- a user-facing `toolExecutionMode` configuration setting

Those are separate architectural concerns. Pulling them into the first promise-bridge would blur ownership before the basic await-safe handoff is proven.

## What Could Go Wrong If Promise-Bridged Handoff Is Implemented Carelessly

Several failure modes become likely if the bridge is added without strict ownership.

### Hung ReAct loops

If request registration happens after dispatch leaves the callsite, the result can arrive before the promise owner exists. The loop then waits forever even though execution already happened.

### Double continuation

If both a bridge registry and a background subscriber can complete the same request, the same tool call can be appended twice and the model loop can continue twice.

### Misrouted results

If correlation is performed loosely by `runId` or `workItemId` instead of `toolRequestId`, one tool completion can be applied to the wrong waiting call in a run with multiple tool invocations.

### Hidden transport leakage

If transport-specific callback errors or event payloads leak directly into `ReActIntegration`, the loop stops receiving one normalized `ToolResult` contract and starts depending on non-local mechanics.

### Timeout without terminal ownership

If timeout detection exists but no single owner is authorized to terminate the request, the system can record a timeout and still later apply a second completion.

### Duplicate completion drift

If duplicate arrivals are not suppressed after the first terminal result, later completions can overwrite diagnostics, confuse inspection, or cause accidental retry logic to treat a finished request as live.

### Premature scheduler ownership

If scheduler or daemon code starts owning tool completion too early, the architecture gains a second continuation authority before it has a durable claim model. That is the fastest way to reproduce the complexity that earlier execution sessions had to remove or harden.

## Recommended Session 41

Recommend exactly one next session:

### Session 41: narrow local internal request-registry prototype

Rationale:

The promise-bridge design now has one central missing implementation seam: an internal request registry that can register one pending tool request, own one promise, accept one terminal completion, and suppress duplicates without changing gateway behavior, IPC, or execution semantics.

That is narrower and safer than extracting a generic promise-bridge abstraction first because the unresolved questions are mostly about ownership, terminal state transitions, and correlation integrity around real `toolRequestId` handling.

The next session should therefore prototype a local in-process request registry inside the authoritative tool handoff path and keep it entirely documentation-aligned with today’s direct behavior.

## Summary

The first future less-direct tool path should not introduce a second continuation owner.

It should introduce one promise-bridged authoritative handoff:

- register request first
- key it by `toolRequestId`
- expose one awaited `Promise<ToolResult>` back to `ReActIntegration`
- resolve exactly once through the authoritative bridge owner
- normalize timeout, invalid, and duplicate conditions into the existing terminal model

That preserves the current await-based execution loop while creating the smallest safe seam for any later non-local dispatch path.
