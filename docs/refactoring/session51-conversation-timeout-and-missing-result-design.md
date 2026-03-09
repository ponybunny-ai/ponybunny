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

## Current Local Request-Registry Handoff Model

After Sessions 46-50, the local path is:

`SchedulerSessionIntake.processMessage(...)`
-> create `conversationRequestId`
-> build one `ConversationRequest`
-> publish `conversation.message.started`
-> `ConversationPort.process(request)`
-> local in-process `ConversationWorker`
-> `ConversationRequestRegistry.register(request)`
-> existing `SessionManager.processMessage(...)`
-> worker normalizes success or failure
-> registry settles one caller-facing promise
-> `SchedulerSessionIntake` validates the result after promise settlement, updates bindings, publishes success events, and returns the transport-facing response

Current ownership is already narrower and clearer than before:

- `SchedulerSessionIntake` remains the outer façade and continuation owner after the promise settles
- `ConversationWorker` owns request validation, orchestration delegation, and normalization of local failures
- `ConversationRequestRegistry` owns registration, the registry-owned promise, duplicate in-flight reuse, and first terminal settlement for one `conversationRequestId`
- `conversationRequestId` is the primary local correlation key

The current registry model is intentionally local and in-memory only. It does not add durable ledgers, cross-process coordination, or evented completion.

## Where Timeout / Missing-Result Risk Exists Now

The remaining gap is now concentrated in one place: a request can be successfully registered, but the registry-owned promise can still remain pending forever if the authoritative local path never produces a terminal settlement.

That risk now exists after registration and before first terminal settlement:

- `ConversationRequestRegistry.register(...)` has already accepted the request
- duplicate callers now reuse the same pending promise
- `SchedulerSessionIntake` is awaiting that promise as its one continuation gate
- there is no timeout policy and no missing-result normalization

So the new architectural risk is not request identity anymore. It is indefinite wait on the registry-owned promise.

## Scenario Analysis

### A. Request registered, orchestration never returns

This is the primary missing-result case.

The request is registered successfully, the promise is exposed to `SchedulerSessionIntake`, and `ConversationWorker` starts the authoritative local orchestration path. If `SessionManager.processMessage(...)` never resolves or rejects, nothing settles the registry-owned promise.

Result:

- `SchedulerSessionIntake` waits forever
- no continuation happens
- no success event is published
- duplicate callers for the same `conversationRequestId` also wait forever on the same pending promise

This is the clearest reason the next step needs a local timeout owner.

### B. Orchestration path throws before normal result resolution ownership completes

Today `ConversationWorker.executeRequest(...)` catches ordinary orchestration exceptions and resolves the registry through `resolveFailure(...)` or `resolveInvalid(...)`.

That covers ordinary throws, but it still assumes the catch path runs and wins before anything else tries to settle the same request. Once timeout exists, there will be two candidate terminal paths:

- ordinary worker failure normalization
- timeout-based failure normalization

The first implementation must preserve first-terminal-wins behavior. If the throw path wins, timeout must be cleared or ignored. If timeout wins first, the later throw must be recorded only as diagnostic late completion.

### C. Result arrives after a timeout-based failure has already settled the promise

Once timeout settles the registry-owned promise for a given `conversationRequestId`, the caller contract is already complete.

That means a later ordinary `ConversationResult` cannot be allowed to:

- change the already-settled promise
- re-enter `SchedulerSessionIntake` continuation
- publish a second authoritative outcome

The late result may still be useful diagnostically, but it must not change continuation outcome.

### D. Duplicate late completions after a terminal result

Even without timeout, once one terminal path has already won, later terminal attempts can still happen because of:

- duplicated internal completion logic
- late success after earlier failure
- repeated error handling after a terminal result

The registry already has the right minimal rule here: exactly one terminal settlement per `conversationRequestId`.

The timeout design must preserve that rule and treat all later terminal attempts as non-authoritative. They may be observed for diagnostics, but they must not affect the caller-facing promise or outer continuation.

### E. Conversation path internally hangs while still inside the authoritative local seam

This is the narrowest but most important case.

The hang may occur inside:

- memory recall/indexing
- persona loading
- input analysis
- response generation
- session persistence
- task-creation-adjacent orchestration

The important point is that the hang can happen entirely inside the current authoritative local seam, before any gateway or IPC boundary becomes relevant.

That is why the first timeout policy should stay local to the seam that owns authoritative registration-before-execution, not move outward into scheduler façade or transport layers.

## Timeout Ownership Options

### Option 1: `SchedulerSessionIntake` owns timeout

This is not recommended.

It would make the outer façade responsible for timing a worker-owned local lifecycle that it does not own. That would blur continuation ownership with lifecycle termination ownership and push timeout concerns into gateway-adjacent flow too early.

### Option 2: `ConversationRequestRegistry` owns timeout

This is also not recommended for the first implementation.

The registry is currently a narrow primitive:

- register by `conversationRequestId`
- hold one promise
- permit one terminal settlement
- suppress later settlements

If timeout moved into the registry now, the registry would also need to own timers, timeout policy, configuration, and more execution semantics. That would broaden it from a lifecycle primitive into a policy coordinator too early.

### Option 3: `ConversationWorker` owns timeout

This is the recommended option.

`ConversationWorker` already owns:

- registration-before-execution through the authoritative local seam
- orchestration delegation into `SessionManager`
- normalization of ordinary failures and invalid results
- the decision about which terminal path is being attempted

That makes it the narrowest owner that can add one local timeout per authoritative registration without changing outer continuation ownership or broadening the registry.

## Recommended Ownership Decision

### Who should own timeout policy in the first safe implementation?

`ConversationWorker` should own timeout policy in the first safe implementation.

### Should timeout live in `ConversationWorker`, `ConversationRequestRegistry`, or another narrow owner?

It should live in `ConversationWorker`, with `ConversationRequestRegistry` remaining a narrow registration-and-single-settlement primitive.

If a helper is added, it should remain private to the worker path rather than becoming a new scheduler-wide timeout framework.

## Recommended Caller-Facing Settlement Model

### How should timeout resolve the caller-facing promise?

Timeout should reject the caller-facing promise through the existing registry failure path.

That matches the current conversation seam contract:

- success resolves with `ConversationResult`
- failure rejects with an error
- invalid result rejects with an error

The first timeout implementation should preserve that contract rather than widening `ConversationResult` to carry timeout as an ordinary success-shaped payload.

`SchedulerSessionIntake` therefore remains the outer continuation owner after promise settlement:

- on resolve, it validates `ConversationResult` and performs normal success continuation
- on reject, it follows the existing failure path and does not publish success continuation

### What normalized `ConversationResult` or failure shape should represent timeout / missing-result failure?

The first implementation should use a normalized failure shape, not a special `ConversationResult`.

Recommended failure shape:

```ts
{
  name: 'ConversationWorkerTimeoutError',
  code: 'CONVERSATION_EXECUTION_TIMEOUT',
  message: `Conversation request '${request.conversationRequestId}' did not produce a terminal result before the local worker timeout`,
}
```

Recommendation:

- use one stable failure code: `CONVERSATION_EXECUTION_TIMEOUT`
- keep `conversationRequestId` as the primary correlation key in the message and diagnostics
- treat missing terminal result as the same caller-visible failure shape as timeout in the first cut
- do not add a separate missing-result `ConversationResult` envelope

For the first implementation, "missing result" is not a separate continuation outcome. It is a timeout-normalized failure because the caller-visible problem is the same: the authoritative local path did not produce a terminal result in time.

## Recommended Registry / Worker State Handling

The safest minimal model is:

1. `ConversationWorker` registers the request.
2. After successful authoritative registration, the worker starts one local timer for that `conversationRequestId`.
3. The worker races normal terminal completion against that timer.
4. If normal success/failure/invalid completion wins first, it settles through the registry and the timer is cleared.
5. If the timer wins first, the worker settles the registry through `resolveFailure(...)` using the normalized timeout error.
6. The registry remains the single owner of first-terminal-wins settlement.

The registry should stay narrow:

- keep `state: pending | resolved`
- keep terminal outcome categories as they already exist for settlement purposes
- represent timeout as `failure` with `failureCode: CONVERSATION_EXECUTION_TIMEOUT`

That avoids a broader lifecycle redesign while still making timeout visible to inspection.

## Late Results After Timeout

Late results after timeout should be ignored for continuation purposes.

Explicitly:

- they should not change the already-settled promise
- they should not change the outcome observed by `SchedulerSessionIntake`
- they should not publish success continuation after timeout
- they should not reopen the registry entry
- they should not override the timeout failure

They may be recorded only for diagnostics, for example:

- recording that a late success arrived after timeout
- recording that a late failure arrived after timeout
- incrementing a late-completion counter
- surfacing that fact through local inspection on the worker and/or registry

They should never change continuation outcome in the first implementation.

## Safest Minimal Timeout Model For The Next Implementation Session

The next implementation should stay narrow and local:

- add one worker-owned local timer per authoritative registration
- start the timer only after registration succeeds
- settle timeout through the existing registry failure path
- preserve exactly one terminal outcome per `conversationRequestId`
- keep `SchedulerSessionIntake` as the outer await/continuation owner after settlement
- record late completions only for diagnostics

This first cut does not need:

- a global timeout framework
- scheduler-owned timeout handling
- gateway-owned timeout handling
- IPC timeout redesign
- cancellation propagation redesign
- multi-process timeout logic
- durable timeout ledgers

## What Should Not Be Done In The First Timeout Implementation

The first implementation should not:

- add durable timeout ledgers or restart-safe timeout claims
- move timeout ownership into `SchedulerSessionIntake`
- move timeout ownership into gateway or IPC layers
- redesign cancellation propagation across conversation/orchestrator/repository layers
- broaden into multi-process or evented `ConversationWorker` timeout handling
- introduce user-facing conversation timeout configuration or mode switches
- move goal/work item materialization authority into `ConversationWorker`
- move gateway session routing ownership into `ConversationWorker`
- redesign session or memory repository ownership
- redesign persona or prompt strategy
- allow late results to override a timeout-settled continuation outcome
- widen `ConversationResult` into a mixed success/failure envelope for this local seam

## What Could Go Wrong If Timeout Handling Is Implemented Carelessly

- If timeout is owned in more than one place, multiple components can believe they are allowed to terminate the same `conversationRequestId`.
- If timeout is implemented outside the worker seam, outer layers can start owning local lifecycle policy they should only observe.
- If timeout widens `ConversationResult` instead of using the current failure path, `SchedulerSessionIntake` will need a second result interpretation model for one seam.
- If timeout is keyed by anything looser than `conversationRequestId`, the wrong in-flight wait can be terminated.
- If late results are allowed to override timeout, one inbound turn can produce multiple authoritative outcomes.
- If timeout tries to solve cancellation, recovery, and topology changes at the same time, the next step will stop being a small safe implementation.
- If timeout is made durable now, this session will accidentally redesign recovery and restart semantics without the needed architecture work.

## Invariants That Must Remain True

The first timeout implementation must preserve these invariants:

- `SchedulerSessionIntake` remains the outer façade and continuation owner after the promise settles
- exactly one terminal outcome exists per `conversationRequestId`
- `conversationRequestId` remains the primary correlation key
- gateway routing remains outside the worker
- `SchedulerTaskBridge` authority remains outside the worker
- no durable conversation ledger is introduced yet

## Recommended Session 52

### Session 52: Implement narrow local timeout normalization in `ConversationWorker`

Rationale:

This is the smallest safe next step because it closes the only newly exposed continuation-safety gap in the current local request-registry handoff without changing topology, caller ownership, gateway behavior, IPC, or scheduler-authoritative task materialization. It also keeps late-result handling local and diagnostic-only.
