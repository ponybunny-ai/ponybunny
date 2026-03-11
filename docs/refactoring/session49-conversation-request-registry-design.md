# Session 49: Conversation Request Registry Design

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
- implement a conversation request registry

## Current Local Conversation Handoff Model

The current local path is still:

`SchedulerSessionIntake.processMessage(...)`
-> create `conversationRequestId`
-> build one `ConversationRequest`
-> publish `conversation.message.started`
-> `ConversationPort.process(request)`
-> local in-process `ConversationWorker`
-> existing `SessionManager.processMessage(...)`
-> return one awaited `ConversationResult`
-> `SchedulerSessionIntake` validates result, updates bindings, publishes success events, and returns the transport-facing response

### Where `ConversationRequest` is created

`SchedulerSessionIntake.processMessage(...)` creates the request. It generates the worker-local `conversationRequestId`, copies the current orchestration inputs into `ConversationRequest`, and remains the outer façade for gateway-facing message handling.

That means request creation is currently intake-owned, not worker-owned.

### Where duplicate suppression currently happens

Duplicate in-flight suppression currently happens inside `ConversationWorker.process(...)`.

The worker keeps an in-memory `inFlightByRequestId` map keyed by `conversationRequestId`. If a second dispatch arrives while the first one is still running:

- the worker returns the same in-flight promise when the duplicate fingerprint matches
- the worker rejects the duplicate when the same `conversationRequestId` is reused with conflicting identity inputs

This is exact in-flight suppression only. It is not a broader lifecycle owner.

### Where the awaited `Promise<ConversationResult>` effectively lives today

Today, the awaited promise effectively lives inside `ConversationWorker`.

More precisely:

- `ConversationWorker.process(...)` creates `const promise = this.executeRequest(...)`
- that raw execution promise is stored directly in `inFlightByRequestId`
- duplicate callers reuse that same execution promise
- the entry is deleted from `inFlightByRequestId` in `finally` after settlement

So there is local promise reuse, but there is no explicit registry object that owns request lifecycle independently from the execution call itself.

### Where result validation happens today

Result validation currently happens in two places.

Inside `ConversationWorker`:

- request shape is validated before dispatch
- the `SessionManager` result is normalized into `ConversationResult`
- invalid `sessionId` or non-string `response` is rejected as `CONVERSATION_RESULT_INVALID`

Inside `SchedulerSessionIntake`:

- the returned `ConversationResult` is validated again before any binding update or success event publication
- `conversationRequestId` must match the dispatched request
- `sessionId`, `response`, and `state` must still be valid

This means worker-side normalization protects the seam locally, while intake-side validation protects outer continuation behavior.

### Who currently owns continuation after the result exists

`SchedulerSessionIntake` currently owns continuation after a valid `ConversationResult` exists.

It still owns:

- scheduler-session to gateway-session binding updates
- `conversation.response` publication
- `conversation.message.succeeded` publication
- the final `SessionMessageResult` returned to the transport-facing caller

`SessionManager` still owns conversation orchestration and any task-creation side effect through its injected task bridge. `SchedulerTaskBridge` still remains the scheduler-authoritative goal/work item materialization owner.

## Current Lifecycle And Ownership Gaps

The current implementation is acceptable for the first local seam, but it still leaves lifecycle ownership implicit rather than explicit.

### Duplicate request suppression

Duplicate suppression exists only as an in-flight map of raw execution promises.

That is enough to suppress exact concurrent duplicates, but it does not clearly separate:

- request registration
- execution start
- terminal result ownership
- post-terminal inspection metadata

This makes the lifecycle understandable in code, but not explicit as an architectural owner.

### Request identity tracking

`conversationRequestId` exists and is stable, but its lifecycle record is fragmented:

- in-flight identity lives in `inFlightByRequestId`
- inspection history lives in `inspectionsByRequestId`
- outer continuation identity is checked later in `SchedulerSessionIntake`

There is no single local owner for the full request lifecycle keyed by `conversationRequestId`.

### One terminal result per `conversationRequestId`

The current path behaves like one terminal result per request because callers await one shared promise, but that invariant is still emergent from the current implementation rather than owned as a first-class lifecycle rule.

The worker does not currently have a dedicated terminal-resolution owner that says:

- this request is pending
- this request is terminal
- only the first terminal result wins
- later terminal attempts are ignored or classified diagnostically

For the current direct local path, that has not caused a transport bug. It is still a gap in lifecycle ownership clarity.

### Invalid or mismatched result handling

Invalid local orchestration output is normalized in `ConversationWorker`, and intake-side mismatched seam output is rejected before success continuation.

That is good enough for the current seam, but ownership is split:

- worker normalizes some invalid terminal outcomes
- intake rejects mismatched or malformed seam outputs before outer continuation

There is no single local lifecycle owner that records that one request terminated as `success`, `failure`, or `invalid`.

### Late result concerns

Late-result behavior is not a practical issue yet because the current path is still a direct local await with no worker-owned timeout and no evented completion path.

However, the seam now has enough identity and duplicate suppression that the next question is valid: if a later local timeout or detached completion path is added, who decides whether a completion is still authoritative for continuation?

Today, no explicit owner exists for that decision.

### Potential timeout or missing-result risk

There is currently no explicit timeout or missing-result normalization on the conversation seam.

That is acceptable for the present direct local path, but it means the architecture does not yet define:

- whether the worker or outer caller would own local timeout policy
- how a missing result would be normalized
- how a later completion would be classified once the caller had already been released

This is still a design gap, not yet a runtime bug that needs implementation in this session.

## Is A Local In-Process Conversation Request Registry Justified Now?

Yes, but only in the narrowest local form.

The justification is not that the conversation path already needs evented dispatch, durable ledgers, or recovery redesign. It does not.

The justification is narrower:

- `conversationRequestId` now exists as a stable seam identity
- duplicate in-flight suppression already exists
- the awaited promise already lives inside the worker
- result validation is already split across worker normalization and intake continuation checks

At that point, the local seam has enough lifecycle surface that keeping request ownership implicit in a raw in-flight promise map is becoming the least clear part of the design.

So a local request registry is justified now as an ownership-clarifying seam, not as a topology change.

## Minimum Safe Responsibility Set

The first registry should own only the minimum local request lifecycle needed to make the seam explicit.

It should own:

- registration by `conversationRequestId`
- the single promise awaited through `ConversationPort.process(...)`
- pending vs terminal state for that request
- duplicate in-flight request handling for matching identity
- rejection of conflicting duplicate registration for the same `conversationRequestId`
- first terminal resolution ownership
- correlation of terminal outcome back to `conversationRequestId`
- minimal terminal metadata for inspection and future diagnostics

It should not own outer continuation, gateway routing, task materialization, repository access, or timeout policy in the first implementation.

## Narrowest Safe Ownership Model

### Registration

Registration should happen inside `ConversationWorker.process(...)` before delegating to `SessionManager.processMessage(...)`.

That preserves the current outer contract:

1. `SchedulerSessionIntake` creates one `ConversationRequest`
2. `SchedulerSessionIntake` calls `await conversationPort.process(request)`
3. `ConversationWorker` registers the request locally by `conversationRequestId`
4. only after registration does the worker begin orchestration

This keeps request creation outside the worker while making lifecycle registration worker-owned.

### Promise ownership

The registry should own the promise returned to the caller.

That is the main architectural improvement over the current raw in-flight map. The worker should stop treating the execution promise itself as the lifecycle owner. Instead:

- the registry returns the single promise for the request
- the worker performs orchestration work behind that promise
- duplicate callers get the same registry-owned promise

This makes one awaited `ConversationResult` an explicit ownership rule rather than an incidental property of promise reuse.

### Duplicate in-flight request handling

The first registry should preserve the current duplicate behavior:

- same `conversationRequestId` plus matching identity returns the same pending promise
- same `conversationRequestId` plus conflicting identity is rejected locally

It should not broaden into durable dedupe, cross-process dedupe, or gateway-owned request state.

### Terminal resolution ownership

The first registry should own first terminal resolution only.

That means one local owner decides whether a request moves from `pending` to terminal and exposes only a narrow completion surface to `ConversationWorker`.

The registry should support terminal resolution categories equivalent to the current seam reality:

- `success`
- `failure`
- `invalid`

Only the first terminal resolution should win for continuation purposes.

### Invalid result normalization

`ConversationWorker` should still normalize invalid orchestration output because that logic belongs at the worker boundary.

The registry should not absorb result-shape interpretation logic from the worker. Its role should be narrower:

- accept the worker’s normalized terminal classification
- store the terminal classification
- resolve or reject the registry-owned promise exactly once

So invalid-result normalization stays worker-owned; invalid terminal-state ownership becomes registry-owned.

### Correlation by `conversationRequestId`

`conversationRequestId` should remain the single local correlation key.

The first registry does not need new identifiers. It only needs to make the existing identity authoritative for:

- registration lookup
- duplicate suppression lookup
- terminal metadata lookup
- future inspection of terminal status

### Minimal terminal metadata

The first registry should keep only minimal terminal metadata, enough to support inspection and future narrow hardening.

Minimum safe metadata:

- `conversationRequestId`
- request fingerprint summary or equivalent duplicate-check identity
- `registeredAt`
- `completedAt`
- terminal status: `success` | `failure` | `invalid`
- whether duplicate suppression occurred
- duplicate dispatch count

Optional, but still safely narrow if already useful to local inspection:

- requested session id
- returned session id when present
- failure code
- failure message

This stays local and in-memory only.

## Invariants That Must Stay Preserved

The first registry implementation must preserve these current invariants:

- `SchedulerSessionIntake` remains the outer façade
- gateway session routing ownership remains outside the worker seam
- `SchedulerTaskBridge` remains the scheduler-authoritative task/goal materialization owner
- one request -> one awaited `ConversationResult` -> one continuation
- current outer transport behavior stays stable

Those invariants are more important than introducing a registry. If a proposed registry shape weakens any of them, it is too broad for the first implementation.

## What Should Not Be Added In The First Registry Implementation

The first registry implementation should not add:

- durable ledgers
- multi-process conversation workers
- evented `ConversationWorker` completion behavior
- gateway-owned request state
- moving task creation authority
- moving gateway session routing ownership
- moving repository ownership
- session or memory repository redesign
- persona or prompt strategy redesign
- user-facing conversation mode configuration
- timeout policy redesign
- recovery or replay semantics

This should remain a local in-memory lifecycle owner for the current in-process seam only.

## Why Not Keep The Current Model As-Is?

Keeping the current model as-is is defensible for one more session, but it is no longer the clearest architecture.

The current worker already contains:

- request identity validation
- duplicate suppression
- raw promise ownership
- result normalization
- inspection history

That is already registry-like behavior, just spread across direct worker internals rather than isolated as an explicit local lifecycle owner.

So the question is no longer whether there is lifecycle state. There is. The real question is whether that state should remain implicit. At this point, the smallest safe answer is no.

## What Could Go Wrong If A Conversation Request Registry Is Introduced Carelessly

- The registry could become a second continuation owner and accidentally pull binding updates or event publication out of `SchedulerSessionIntake`.
- The registry could absorb task-creation or session-routing authority, which would violate the current migration boundaries.
- The registry could start inventing timeout or recovery semantics before the conversation seam is ready for them.
- The registry could duplicate identity state already owned elsewhere and create disagreement between worker, intake, and inspection paths.
- The registry could overfit to future multi-process ideas and make the current local path more complex without improving correctness.
- The registry could treat all failures as registry concerns and erase the useful distinction between worker-side normalization and intake-side outer-contract validation.

The safe rule is simple: the first registry should clarify local lifecycle ownership, not change where business authority lives.

## Recommended Session 50

Implement the narrow local in-process `ConversationRequestRegistry` prototype under `ConversationWorker`.

Rationale:

- it is the smallest coding step that resolves the current ownership ambiguity
- it preserves the current direct await contract
- it does not require any gateway, IPC, task-materialization, repository, or execution/recovery redesign
- it creates an explicit place for later timeout or late-result policy discussion without implementing that policy yet

## Session 49 Conclusion

A local in-process conversation request registry is justified now, but only as a minimal worker-local lifecycle owner.

The first implementation should make request registration, registry-owned promise handoff, duplicate in-flight reuse, and first terminal resolution explicit by `conversationRequestId` while leaving outer continuation, gateway routing, and scheduler-authoritative task materialization exactly where they are today.
