# Session 42: Tool Timeout and Missing-Result Design

## Scope

This session is documentation only.

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

## Why This Session Exists

Session 41 established the first local in-process request-registry handoff:

- `ReActIntegration` still creates one `ToolRequest`
- `LocalToolWorker` registers that request before execution
- the registry owns the caller-facing `Promise<ToolResult>`
- `LocalToolWorker` remains the authoritative local resolver
- duplicate terminal completion is suppressed for continuation purposes

That closed the registration-before-execution gap, but it did not yet answer the next failure mode:

what happens when a request is registered and the caller is awaiting the registry-owned promise, but no terminal `ToolResult` ever arrives, arrives too late, or arrives after the promise has already been resolved through another terminal path?

The risk is no longer only duplicate completion. It is also indefinite wait, split terminal ownership, and continuation ambiguity around a registered `toolRequestId`.

## Current Local Request-Registry Handoff Model

The current authoritative path is still local, single-process, and await-based.

### 1. Request creation

`ReActIntegration.executeToolCall(...)` creates one authoritative `ToolRequest` containing:

- `toolRequestId`
- `runId`
- `workItemId`
- `goalId` when present
- `toolCallId`
- `toolName`
- arguments and route context

`toolRequestId` remains the primary correlation key.

### 2. Registration before execution

`LocalToolWorker.dispatch(...)` now registers the request in `ToolRequestRegistry` before the underlying `ToolPort.execute(...)` path begins.

The registry currently owns:

- one in-memory entry keyed by `toolRequestId`
- one caller-facing `Promise<ToolResult>`
- one narrow resolution owner for the first authoritative registration
- duplicate registration suppression for matching identity
- duplicate terminal completion suppression after the first winning resolution

### 3. Local authoritative execution

After registration succeeds:

- `LocalToolWorker` validates request identity
- emits `tool.requested` and `tool.started`
- awaits `toolPort.execute(request)`
- normalizes mismatches, invalid failed results, and worker exceptions into failed `ToolResult`s
- resolves the registry-owned promise exactly once

`ReActIntegration` still remains continuation owner after the promise resolves.

## Where Timeout / Missing-Result Risk Exists Now

The new risk surface exists between:

1. successful request registration, and
2. eventual terminal resolution of the registry-owned promise

Today the registry has no timeout policy and no missing-result backstop. If the authoritative local path fails to produce a terminal `ToolResult`, the request can remain `pending` indefinitely and `ReActIntegration` can wait forever on the registry-owned promise.

That risk now exists even though registration happens correctly, because registration by itself does not guarantee that a terminal resolver path will complete.

The risk is local to the authoritative `LocalToolWorker` handoff path. It does not require gateway, IPC, scheduler, or multi-process redesign to address safely.

## Scenario Analysis

### A. Request registered, execution never returns

This is the clearest hang case.

The request is already registered, so the caller is now blocked on a real registry-owned promise. If `toolPort.execute(...)` never settles, nothing currently transitions that request out of `pending`.

Without local timeout normalization:

- the promise never resolves
- `ReActIntegration` never regains control
- no later scheduler-owned continuation is allowed to take over

The first safe implementation must terminate that wait locally.

### B. Execution path throws before normal result resolution ownership completes

The current worker already tries to normalize thrown exceptions into `TOOL_WORKER_EXCEPTION`.

That is still the primary path and should remain so.

The remaining risk is defensive: if a future edit introduces a path where the request is registered but the code exits before reaching a terminal owner resolution, the system would again leave a `pending` registry entry behind.

Timeout should act as a backstop for unresolved registered requests, not as a replacement for normal exception normalization.

### C. Result arrives after a timeout-based failure has already resolved the promise

This is the most important ownership rule.

Once timeout resolves the registry-owned promise for a given `toolRequestId`, the caller contract is already satisfied with one terminal `ToolResult`.

Any later arriving success or failure result:

- must not change continuation outcome
- must not replace transcript-visible tool output
- must not trigger a second ReAct continuation

It is non-authoritative and should be ignored for continuation purposes.

### D. Duplicate late completions after a terminal result

This is an extension of the existing duplicate-completion rule.

Whether the first terminal result was:

- a success
- an ordinary failure
- an invalid-result normalization
- a timeout-produced failure

all later completions for the same `toolRequestId` must be treated as ignored duplicates.

The same rule should apply regardless of why the first terminal result won.

### E. MCP-backed call internally hangs while still inside the local authoritative path

This is architecturally important because MCP-backed tools already run through the same local `ToolPort` / `LocalToolAdapter` seam in the current design.

For Session 42, that means an MCP-backed hang is not a special topology problem. It is the same local await-safety problem:

- the authoritative caller still awaits one local registry-owned promise
- the local worker still owns the only safe terminal resolution path
- the first timeout implementation should not redesign MCP lifecycle or introduce broader cancellation semantics

The timeout design therefore needs to work for both:

- local built-in tools that hang
- MCP-backed tools that hang while still under the same local worker authority

## Invariants That Must Remain True

The first timeout implementation must preserve these current invariants:

- `ReActIntegration` remains continuation owner after the promise resolves
- exactly one terminal `ToolResult` exists per `toolRequestId` for continuation purposes
- `toolRequestId` remains the primary correlation key
- no scheduler-owned tool continuation is introduced
- no durable tool ledger is introduced yet

## Recommended Timeout Ownership

### Who should own timeout policy in the first safe implementation?

`LocalToolWorker` should own timeout policy in the first safe implementation.

### Should timeout live in `LocalToolWorker`, `ToolRequestRegistry`, or another narrow owner?

It should live in `LocalToolWorker`, with `ToolRequestRegistry` remaining a narrow storage-and-resolution primitive.

The registry should not become the policy owner because it currently has a smaller and cleaner job:

- register by `toolRequestId`
- hold the caller-facing promise
- permit one terminal resolution
- suppress later completions

If timeout policy moved into the registry now, the registry would need to own timers, timeout configuration, execution semantics, and possibly future cancellation interactions. That would broaden a narrow primitive into a lifecycle coordinator too early.

`LocalToolWorker` is the correct first owner because it already:

- controls registration-before-execution
- owns the authoritative local execution handoff
- normalizes failures into `ToolResult`
- already distinguishes success, failure, and invalid completion
- already sits at the narrowest place that covers both local and MCP-backed execution under the same local seam

If a helper is introduced, it should remain private to the worker path rather than becoming a new global framework.

## Recommended Timeout Resolution Model

### How should timeout resolve the caller-facing promise?

Timeout should resolve, not reject, the caller-facing promise.

The worker should produce one normalized failed `ToolResult` for the original request and use the same single terminal resolution path already used for other terminal outcomes.

That keeps the external caller contract unchanged:

`const result = await toolWorker.dispatch(request)`

The caller still receives one `ToolResult`, not a mix of ordinary result resolution plus promise rejection as a second normal control-flow shape.

### Recommended normalized `ToolResult` shape

The first safe timeout / missing-result normalization should be:

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

Recommendation:

- use one stable code: `TOOL_EXECUTION_TIMEOUT`
- use the original request identity unchanged
- treat missing terminal result as the same normalized external symptom as timeout in the first cut
- do not add a separate missing-result envelope yet

For the first implementation, "missing result" is not a separate continuation shape. It is a timeout-normalized failed result because the caller-visible problem is the same: the authoritative local path did not produce a terminal result within the allowed wait window.

## Recommended Registry / Worker State Handling

The safest minimal model is still narrow:

- keep the registry as the owner of one promise and one terminal resolution
- allow the worker to schedule one local timeout per authoritative registration
- when timeout wins, resolve through the same owner path as other failures
- record timeout as terminal diagnostics on the registry entry and inspection record

The first implementation does not need a global timeout framework.

It may add a terminal outcome such as `timeout` to registry metadata for diagnostics, but it should not redesign the broader state machine beyond what is needed to show that a request resolved by timeout rather than by ordinary success or failure.

## What Should Happen To Late Results After Timeout

Late results after timeout should be ignored for continuation purposes.

Specifically:

- they should not change the already-resolved caller-facing promise
- they should not change transcript or continuation outcome
- they should not reopen the registry entry
- they should not cause a second terminal event to become authoritative

They may be recorded only for diagnostics, such as:

- incrementing ignored-completion counts
- recording that a late completion arrived after timeout
- surfacing that fact through local inspection or debug visibility

They should never change continuation outcome in the first implementation.

## Safest Minimal Timeout Model For Session 43

The recommended next implementation should stay narrow and local:

1. `LocalToolWorker` starts a local timer only after successful authoritative registration.
2. The worker races normal terminal resolution against that timer.
3. If the timer fires first, the worker resolves the registry-owned promise with one normalized failed `ToolResult` using `TOOL_EXECUTION_TIMEOUT`.
4. The registry entry becomes terminal exactly once for that `toolRequestId`.
5. Any later completion from the underlying execution path is ignored for continuation purposes and recorded only as diagnostics.

Important boundaries for this first cut:

- no gateway changes
- no IPC changes
- no change to direct vs evented semantics
- no scheduler-owned timeout handling
- no cancellation propagation redesign
- no multi-process timeout logic
- no durable timeout ledger

This keeps timeout as a local await-safety mechanism, not a broader recovery system.

## What Should Not Be Done In The First Timeout Implementation

The first implementation should not:

- add durable timeout ledgers or durable timeout claims
- move timeout ownership into the scheduler
- redesign cancellation propagation across tool, MCP, or worker layers
- broaden into multi-process or evented timeout handling
- introduce user-facing tool timeout mode/config selection
- redesign MCP lifecycle ownership
- redesign permission or policy ownership
- add a second ordinary caller control-flow shape through promise rejection
- allow late results to override a timeout-resolved continuation outcome

## What Could Go Wrong If Timeout Handling Is Implemented Carelessly

- If timeout is owned in more than one place, two different components can each believe they are allowed to terminate the same `toolRequestId`.
- If timeout rejects promises while other paths resolve `ToolResult`, callers will need two ordinary completion channels and continuation logic will drift.
- If late results are allowed to overwrite timeout outcomes, one tool call can produce multiple transcript-visible outcomes.
- If timeout correlation is keyed by anything looser than `toolRequestId`, the wrong waiting call can be terminated.
- If timeout is pushed into scheduler or IPC layers now, the design will broaden far beyond the local handoff risk this session is supposed to contain.
- If timeout tries to solve cancellation, recovery, and MCP lifecycle ownership all at once, the next step will stop being a small safe implementation.
- If timeout produces a special out-of-band control message instead of a normal failed `ToolResult`, `ReActIntegration` stops having one stable awaited contract.

## Recommended Session 43

### Session 43: Implement narrow local timeout normalization in `LocalToolWorker`

Rationale:

This is the smallest safe follow-up because it closes the only newly exposed continuation-safety gap in the current local request-registry handoff without changing topology, caller ownership, or broader execution architecture. It uses the existing registry-owned promise, preserves one terminal `ToolResult` per `toolRequestId`, and keeps late-result handling local and diagnostic-only.
