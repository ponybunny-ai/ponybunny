# Session 52: Local Conversation Timeout Normalization

## Scope

This session implements only the narrow local timeout normalization described in Session 51.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery
- redesign `ToolWorker`
- move goal/work item creation authority into `ConversationWorker`
- move gateway session routing ownership into `ConversationWorker`
- redesign session or memory repository ownership
- redesign persona or prompt strategy
- implement multi-process or evented `ConversationWorker` behavior
- add durable conversation ledgers
- redesign global timeout policy

## Where Timeout Now Lives

Timeout is now owned locally by `ConversationWorker`.

The worker starts one local timer only after `ConversationRequestRegistry.register(request)` succeeds with an authoritative `registered` result and the request has passed the existing local validation path that still runs inside the worker.

`ConversationRequestRegistry` remains a narrow primitive:

- register by `conversationRequestId`
- return the caller-facing promise
- allow exactly one terminal settlement
- reject later terminal attempts

It does not become a general timeout-policy owner in this session.

## How Timeout Settles The Caller-Facing Promise

The caller contract remains:

`SchedulerSessionIntake`
-> dispatch one `ConversationRequest`
-> await one `Promise<ConversationResult>`
-> continue exactly once on success
-> follow one failure path on rejection

When the local timeout fires before orchestration produces a terminal outcome, `ConversationWorker` settles the registry-owned promise through the existing failure path by calling `ConversationRequestResolutionOwner.resolveFailure(...)`.

No new result union was introduced. Timeout still rejects the same caller-facing promise rather than resolving a special timeout-shaped `ConversationResult`.

## Normalized Timeout Failure

Timeout now uses one stable failure code:

- `CONVERSATION_EXECUTION_TIMEOUT`

The worker rejects with a local `ConversationWorkerTimeoutError` carrying the current request identity that is already safely available at the seam:

- `conversationRequestId`
- `sessionId` when present
- `personaId` when present
- `userProfileId` when present
- `agentId` when present
- `messageDigest`

The timeout message is:

`Conversation request '<conversationRequestId>' did not produce a terminal result before the local worker timeout`

## What Happens To Late Completions After Timeout

The first terminal completion still wins.

If timeout settles the registry-owned promise first:

- later success does not change the caller-visible outcome
- later failure does not change the caller-visible outcome
- `SchedulerSessionIntake` does not get a second continuation path
- no success event publication occurs after the timeout rejection

Late completion is tracked only as narrow local inspection data on `ConversationWorker`:

- `timedOut`
- `lateCompletionObserved`
- `lateCompletionCount`

This is diagnostic-only and stays local to the worker inspection surface.

## What Did Not Change

- `SchedulerSessionIntake` still owns the outer await-and-continue contract
- gateway-facing transport behavior is unchanged
- IPC is unchanged
- direct vs evented execution semantics are unchanged
- `ConversationRequestRegistry` remains local and in-memory
- task materialization authority remains outside `ConversationWorker`
- gateway session routing ownership remains outside `ConversationWorker`
- ordinary success normalization remains unchanged
- ordinary failure and invalid-result normalization remain unchanged

## Validation Added

Focused tests now cover:

- hanging conversation request rejects exactly once with `CONVERSATION_EXECUTION_TIMEOUT`
- timeout failure preserves request identity fields
- late completion after timeout does not produce a second continuation outcome
- ordinary successful execution still returns the same `ConversationResult`
- ordinary failure/invalid normalization remains unchanged
- `SchedulerSessionIntake` still publishes only the started event on timeout rejection

## Next Safest ConversationWorker Step

The next safest step is still local and narrow: add minimal local diagnostics for non-timeout ignored completions or terminal-path inspection if later sessions need more visibility into why a registered request resolved as success, invalid, worker exception, or timeout.

That follow-up should still avoid:

- durable timeout ledgers
- gateway-owned timeout handling
- scheduler-owned timeout handling
- cancellation propagation redesign
- multi-process conversation completion handling
