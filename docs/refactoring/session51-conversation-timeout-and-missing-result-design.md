# Session 51: Conversation Timeout And Missing-Result Design

## Scope

This session is documentation-only.

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
- implement timeout behavior yet

## Why This Session Exists

Session 50 moved the local conversation seam onto an explicit `ConversationRequestRegistry`.

That closed the registration-before-execution gap and made the local promise lifecycle explicit:

- `SchedulerSessionIntake` creates one `ConversationRequest`
- `ConversationWorker` registers it by `conversationRequestId`
- the registry owns the single caller-facing `Promise<ConversationResult>`
- the registry suppresses duplicate in-flight registration for matching identity
- the registry allows exactly one first terminal resolution

What is still unresolved is the next failure mode:

what should happen when a request is successfully registered, but a terminal conversation outcome never arrives, arrives too late, or arrives after some timeout-driven terminal path has already settled the registry-owned promise?

The current seam now has clear request identity and terminal ownership, but no timeout or missing-result policy. That means the main remaining risk is indefinite wait or ambiguous late completion on a registered `conversationRequestId`.

## Current Local Request-Registry Handoff Model

The authoritative path is still local, in-process, and await-based.

### 1. Request creation

`SchedulerSessionIntake.processMessage(...)` creates one authoritative `ConversationRequest` containing:

- `conversationRequestId`
- `message`
- optional `sessionId`
- optional `personaId`
- optional `userProfileId`
- optional `agentId`
- optional `attachments`

`conversationRequestId` remains the primary correlation key.

### 2. Registration before orchestration

`ConversationWorker.process(...)` now calls `ConversationRequestRegistry.register(request)` before beginning orchestration.

The registry currently owns:

- one in-memory entry keyed by `conversationRequestId`
- one caller-facing `Promise<ConversationResult>`
- pending vs resolved lifecycle state
- duplicate in-flight reuse for matching identity
- local rejection of conflicting duplicate identity
- first terminal resolution ownership
- terminal metadata for `success`, `failure`, and `invalid`

### 3. Local authoritative orchestration

After registration succeeds:

- `ConversationWorker` validates request shape
- it starts the authoritative local orchestration path through `SessionManager.processMessage(...)`
- it normalizes invalid output into a local invalid failure
- it normalizes thrown exceptions into a local failure
- it resolves or rejects the registry-owned promise exactly once

### 4. Outer continuation still lives outside the worker

After the promise settles, `SchedulerSessionIntake` remains the outer façade and continuation owner.

It still owns:

- `conversation.message.started` publication before the await
- session binding updates after a valid successful result
- `conversation.response` publication
- `conversation.message.succeeded` publication
- the final transport-facing response

Gateway routing, scheduler task materialization, and repository ownership remain outside `ConversationWorker`.

## Where Timeout / Missing-Result Risk Exists Now

The risk now exists between:

1. successful registry registration, and
2. terminal settlement of the registry-owned promise

Today:

- the registry has no timeout policy
- the worker has no timeout policy
- the caller-facing promise can remain pending indefinitely if the authoritative local seam never produces a terminal outcome

This means the architecture now protects duplicate completion better than missing completion.

The risk is local to the authoritative `ConversationWorker` request-registry handoff. It does not require gateway, IPC, scheduler, or multi-process redesign to address safely.

## Scenario Analysis

### A. Request registered, orchestration never returns

This is the clearest hang.

The request is already registered and the caller is awaiting a real registry-owned promise. If `SessionManager.processMessage(...)` never settles, nothing currently moves that request out of `pending`.

Without local timeout normalization:

- the registry entry stays pending indefinitely
- `SchedulerSessionIntake` never regains control
- no later continuation path is clearly authorized to terminate that wait

The first safe implementation must terminate that wait locally.

### B. Orchestration path throws before normal result resolution ownership completes

The current worker already catches thrown exceptions inside `executeRequest(...)` and normalizes them into failure rejection.

That should remain the primary path.

The timeout need is narrower: it is a backstop in case a request is registered but some path exits without a terminal owner resolution ever completing. That could come from a future regression, an unreturned hung dependency, or a path that never reaches the ordinary success/failure resolution point.

Timeout should not replace ordinary exception normalization. It should protect against registered requests that otherwise remain unresolved.

### C. Result arrives after a timeout-based failure has already settled the promise

This is the most important ownership rule.

Once timeout has settled the registry-owned promise for a given `conversationRequestId`, the caller contract is already complete.

Any later success or failure result:

- must not change continuation outcome
- must not cause `SchedulerSessionIntake` to publish success events for that request
- must not trigger a second caller-visible completion

It is non-authoritative for continuation purposes.

### D. Duplicate late completions after a terminal result

This extends the current first-terminal-wins rule.

Whether the winning terminal path was:

- success
- normalized failure
- invalid-result rejection
- timeout-produced failure

all later completions for that same `conversationRequestId` must be treated as ignored duplicates for continuation purposes.

The rule should be the same regardless of why the first terminal outcome won.

### E. Conversation path internally hangs while still inside the authoritative local seam

This is the architectural point that matters most for the first implementation.

The hang might be inside:

- `SessionManager`
- memory recall/indexing
- persona resolution
- input analysis
- response generation
- another local dependency invoked by the same seam

As long as the system is still inside the authoritative local `ConversationWorker` path, this is still one local await-safety problem rather than a transport or process-topology problem.

The first timeout design therefore needs to protect the whole local seam, not only one narrow helper inside it.

## Invariants That Must Remain True

The first timeout implementation must preserve these current invariants:

- `SchedulerSessionIntake` remains the outer façade and continuation owner after the promise settles
- exactly one terminal outcome exists per `conversationRequestId`
- `conversationRequestId` remains the primary correlation key
- gateway routing remains outside the worker
- `SchedulerTaskBridge` authority remains outside the worker
- no durable conversation ledger is introduced yet

## Recommended Timeout Ownership

### Who should own timeout policy in the first safe implementation?

`ConversationWorker` should own timeout policy in the first safe implementation.

### Should timeout live in `ConversationWorker`, `ConversationRequestRegistry`, or another narrow owner?

It should live in `ConversationWorker`, possibly with a tiny worker-private helper, while `ConversationRequestRegistry` remains a narrow registration and first-terminal-resolution primitive.

The registry should not own timeout policy yet because its current job is intentionally smaller:

- register by `conversationRequestId`
- hold the caller-facing promise
- expose one resolution owner for the first authoritative registration
- suppress later terminal attempts
- expose inspection metadata

If timeout moved into the registry now, the registry would start owning timers, policy, and execution-lifecycle semantics. That would broaden a narrow primitive into a lifecycle coordinator too early.

`ConversationWorker` is the right first owner because it already:

- controls registration-before-orchestration
- owns the authoritative local seam
- normalizes invalid and failure outcomes
- is the narrowest place that can protect the full local path without redesigning scheduler, gateway, or repositories

## Recommended Timeout Resolution Model

### How should timeout resolve the caller-facing promise?

Timeout should reject the registry-owned promise through the existing failure path.

More specifically:

- the worker should create one normalized timeout failure
- it should settle the registry-owned promise by calling `owner.resolveFailure(...)`
- `SchedulerSessionIntake` should regain control because the awaited `ConversationPort.process(...)` promise rejects

The first timeout implementation should not widen `ConversationPort` from `Promise<ConversationResult>` into a union of success and failure result shapes. The current seam already uses:

- success via fulfilled `ConversationResult`
- failure/invalid via rejected promise

Timeout should follow that existing contract instead of introducing a second success-shaped failure envelope.

### What normalized `ConversationResult` or failure shape should represent timeout / missing-result failure?

The first safe implementation should use a normalized failure shape, not a widened `ConversationResult`.

Recommended shape:

```ts
class ConversationWorkerTimeoutError extends Error {
  code = 'CONVERSATION_EXECUTION_TIMEOUT';
}
```

Expected payload semantics:

```ts
{
  name: 'ConversationWorkerTimeoutError',
  code: 'CONVERSATION_EXECUTION_TIMEOUT',
  message: `Conversation request '${request.conversationRequestId}' did not produce a terminal result before the local worker timeout`
}
```

For the first cut, missing-result and timeout should use the same normalized external failure shape:

- do not add a separate caller-facing missing-result envelope yet
- do not widen `ConversationResult`
- do not introduce a new scheduler-owned failure channel

The caller-visible symptom is the same: the authoritative local seam did not produce a terminal successful `ConversationResult` within the allowed local wait window.

## Safest Minimal Timeout Model For The Next Implementation Session

The next implementation should stay narrow and local.

Recommended model:

1. `ConversationWorker` schedules one local timeout after authoritative registration succeeds.
2. The timeout is keyed by `conversationRequestId`.
3. Any ordinary terminal outcome clears that timeout.
4. If the timeout fires first, `ConversationWorker` creates one normalized timeout error and calls `owner.resolveFailure(...)`.
5. The registry-owned promise rejects exactly once.
6. `SchedulerSessionIntake` remains the outer await/continuation owner after that rejection.
7. If orchestration later returns or throws, those later completions are ignored for continuation purposes because the owner is already terminal.

This first implementation may add narrow local diagnostics showing that terminal resolution happened by timeout rather than by ordinary failure or success, but it should not become a global timeout framework.

## What Should Happen To Late Results After Timeout

Late results after timeout should be ignored for continuation purposes.

That means:

- they do not change the already-settled outcome
- they do not trigger success event publication
- they do not trigger a second continuation
- they do not overwrite timeout terminal metadata

They may be recorded only for local diagnostics if that can be done narrowly and safely.

The first implementation should treat them as:

- ignored for behavior
- optionally recorded for inspection
- never authoritative for continuation once timeout has already won

Late results should not be allowed to change the caller-visible outcome unless a future session explicitly redesigns continuation ownership, which this session does not recommend.

## What Should Not Be Done In The First Timeout Implementation

The first implementation should not:

- add a durable timeout ledger
- move timeout handling into gateway code
- move timeout handling into `SchedulerSessionIntake`
- make scheduler-owned conversation timeout the authoritative owner
- redesign broad cancellation propagation
- redesign execution or recovery around timed-out conversation requests
- redesign `ToolWorker`
- redesign session or memory repository ownership
- implement multi-process or evented conversation timeout handling
- add user-facing conversation timeout mode/config selection
- widen `ConversationResult` into a new failure union just to carry timeout
- allow late results to override a timeout-settled outcome

This keeps timeout as a narrow local await-safety mechanism for the existing authoritative seam, not a broader recovery or transport framework.

## What Could Go Wrong If Timeout Handling Is Implemented Carelessly

- If timeout ownership exists in more than one place, two components can each believe they are allowed to terminate the same `conversationRequestId`.
- If timeout is keyed by anything looser than `conversationRequestId`, the wrong waiting request can be terminated.
- If timeout resolves a fake success-shaped `ConversationResult`, `SchedulerSessionIntake` can be forced into confusing success/failure branching or accidental success-event publication.
- If late results are allowed to override timeout, one user message can produce multiple continuations.
- If timeout policy is moved into scheduler or gateway layers now, the design broadens far beyond the local handoff risk this session is supposed to contain.
- If timeout tries to solve cancellation, retry, recovery, and durable reattachment at the same time, the next implementation will stop being a small safe change.
- If a timeout path tries to retroactively undo already-triggered side effects inside the local conversation path, ownership boundaries around `SchedulerTaskBridge` and orchestration semantics can become ambiguous.

## Recommended Session 52

Implement one narrow local timeout normalization path in `ConversationWorker` for registered requests.

Rationale:

- the registry-backed local seam now has enough lifecycle ownership to support a safe timeout
- the remaining risk is specifically indefinite wait or non-authoritative late completion on a registered `conversationRequestId`
- this can be addressed locally without changing gateway behavior, IPC, scheduler authority, or repository ownership

