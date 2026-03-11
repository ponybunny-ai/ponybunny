# Session 53: ConversationWorker Closure Review

## Scope

This session is documentation-only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery
- redesign `ToolWorker`
- implement evented or multi-process `ConversationWorker` behavior
- move goal/work item creation authority into `ConversationWorker`
- move gateway session routing ownership into `ConversationWorker`
- redesign session/memory repository ownership
- redesign persona/prompt strategy
- add durable conversation ledgers

The goal is to close-review the ConversationWorker line after Sessions 46-52 and judge whether it is stable enough to stop being the primary refactor focus.

## What Is Now Implemented On The ConversationWorker Line

The ConversationWorker line now has a real local authoritative orchestration seam for message execution.

Implemented state:

- `ConversationPort` / `ConversationRequest` / `ConversationResult` boundary exists and is used by `SchedulerSessionIntake.processMessage(...)`.
- `SchedulerSessionIntake` now creates one `conversationRequestId`, builds one `ConversationRequest`, and awaits `ConversationPort.process(...)` instead of directly awaiting `SessionManager.processMessage(...)`.
- local in-process `ConversationWorker` is the authoritative seam for message-execution dispatch into the existing `SessionManager` orchestration path.
- request identity validation exists at the worker boundary.
- result normalization exists before a caller-facing `ConversationResult` is resolved.
- intake-side result validation still guards the outer continuation before gateway-facing success behavior is emitted.
- local in-process `ConversationRequestRegistry` now owns one caller-facing promise per `conversationRequestId`.
- exact duplicate in-flight requests with matching identity can reuse the same pending promise.
- conflicting duplicate identity under the same `conversationRequestId` is rejected locally.
- exactly one terminal outcome per `conversationRequestId` is enforced by the registry-owned settlement owner.
- local timeout normalization now rejects hanging requests through the existing failure path with `CONVERSATION_EXECUTION_TIMEOUT`.
- late completions after timeout are ignored for continuation purposes and retained only as narrow local diagnostics.
- local inspection visibility exists through `ConversationWorker.inspect()` and `SchedulerSessionIntake.inspectConversationWorker()`.

## What Remains Intentionally Conservative

The ConversationWorker line was kept narrow on purpose.

Still intentionally conservative:

- `SchedulerSessionIntake` remains the outer facade and post-settlement continuation owner.
- `ConversationWorker` is authoritative only for the local message-execution seam.
- `SessionManager` still owns the underlying conversation orchestration and stateful session behavior.
- `SchedulerTaskBridge` still owns scheduler-authoritative goal/work item materialization through `SessionManager`.
- gateway session routing ownership remains in `SchedulerSessionIntake`.
- duplicate suppression, timeout handling, and inspection visibility are in-process only.
- there is no evented conversation dispatch, no multi-process worker ownership, and no daemon-owned delayed completion model.
- there is no durable conversation request ledger, restart-safe dedupe, or recovery/reconciliation workflow for conversation requests.
- session lifecycle operations outside message execution still couple directly through `SchedulerSessionIntake` to `SessionManager`.

## What Is Stable Enough For Current Use

The current ConversationWorker line is stable enough for its intended current role:

- authoritative local in-process message execution dispatch
- one awaited `ConversationResult` or one failure per `conversationRequestId`
- registry-owned single-settlement handoff under the worker seam
- bounded local handling for invalid requests, invalid results, duplicate in-flight requests, hangs, and late completions
- read-only local inspection of which terminal path won

For the current local scheduler-side message path, this is no longer just a skeleton. It is a real seam with explicit lifecycle ownership and focused protections around the failure modes introduced by the request-registry handoff.

## What Is Still Not Ready For Broader Or Default Non-Local Use

The ConversationWorker line is not ready to be treated as a broader worker architecture yet.

Not ready:

- evented conversation dispatch
- multi-process or daemon-owned conversation completion ownership
- cross-process late-result handling
- restart-safe idempotency or duplicate suppression
- durable conversation request ledgers
- operator-facing durable inspection or recovery workflows
- moving gateway session routing ownership into the worker
- moving scheduler task materialization authority into the worker
- repository ownership migration

The current line should therefore be judged as local-authoritative-ready, not broader-worker-ready.

## Assessment

### A. Current Authoritative Local ConversationWorker Path

Current strengths:

- The message-execution path is now explicit: gateway RPC -> IPC bridge -> scheduler daemon -> `SchedulerSessionIntake.processMessage(...)` -> `ConversationPort.process(...)` -> local `ConversationWorker` -> existing `SessionManager.processMessage(...)`.
- `ConversationWorker` is the only orchestration seam used by `SchedulerSessionIntake.processMessage(...)` for message execution.
- The outer continuation remains simple: one request, one awaited promise, one validated continuation in `SchedulerSessionIntake`.
- Existing conversation behavior remains intact because the worker still delegates into the current `SessionManager` path.

Remaining risks:

- The seam is local and in-memory only.
- `SchedulerSessionIntake` still constructs both `SessionManager` and `ConversationWorker`, so composition coupling remains concentrated in one class.
- Session lifecycle operations like open/list/history/end/archive/resume/status still couple directly from `SchedulerSessionIntake` to `SessionManager`; only message execution is fully routed through the worker seam.

Current recommended usage posture:

- Treat this path as the authoritative local default for scheduler-side conversation message execution.
- Do not treat it as evidence that broader worker topology or ownership migration is ready.

Further immediate work required:

- No immediate blocking work is required for the current local message-execution scope.

### B. Request-Registry-Based Handoff

Current strengths:

- Registration happens before orchestration begins.
- One registry-owned promise exists per `conversationRequestId`.
- Matching duplicate in-flight requests reuse the same pending promise.
- Conflicting duplicate identity is rejected before two different requests can share one request id.
- First terminal settlement wins explicitly through `ConversationRequestResolutionOwner`.

Remaining risks:

- The registry is local-only and not restart-safe.
- Its lifecycle is intentionally narrow: register, settle once, inspect.
- It should not be mistaken for a durable conversation ledger or cross-process ownership model.

Current recommended usage posture:

- Keep using the registry as the narrow local promise bridge under `ConversationWorker`.
- Keep it primitive and local. Do not broaden it into durable orchestration state.

Further immediate work required:

- No immediate work is required for the current local scope.

### C. Timeout / Missing-Result Handling

Current strengths:

- Hanging orchestration no longer leaves `SchedulerSessionIntake` waiting forever on the worker-owned promise.
- Timeout ownership lives in one place: `ConversationWorker`.
- Timeout settles through the existing failure path instead of widening `ConversationResult`.
- Late success or failure after timeout cannot create a second continuation.

Remaining risks:

- Timeout is an await-safety mechanism, not a broader recovery or cancellation model.
- Underlying long-running work is not cancelled.
- Timeout handling is not durable, restart-safe, or cross-process visible.

Current recommended usage posture:

- Treat timeout as the correct bounded local safety mechanism for the current in-process seam.
- Do not expand it into a broader recovery framework or cross-process ownership change in the next step.

Further immediate work required:

- No must-fix remains for the current local boundary.

### D. Local Diagnostics / Inspection Visibility

Current strengths:

- `ConversationWorker.inspect()` exposes success/failure/invalid outcome, duplicate suppression, timeout state, late-completion observation, and request/result identity fields.
- `SchedulerSessionIntake.inspectConversationWorker()` exposes that same local inspection view without widening transport behavior.
- The current visibility is enough to confirm which terminal path won for the local seam.

Remaining risks:

- Inspection is in-memory only.
- There is no durable history, operator CLI surface, or cross-process observability.
- These diagnostics support local closure confidence, not production-grade worker operations.

Current recommended usage posture:

- Treat the current inspection surface as sufficient for local development, regression checks, and refactor validation.
- Do not mistake it for a finished operator-facing observability system.

Further immediate work required:

- No immediate work is required before moving primary focus away from ConversationWorker.

## Readiness Judgment

### Is the ConversationWorker line now stable enough to pause as the primary focus?

Yes.

The ConversationWorker line is now stable enough to pause as the primary refactor focus for its intended local-authoritative scope. The main local continuation-safety gaps introduced by the worker extraction have been closed:

- the message-execution seam is explicit and authoritative under `ConversationPort`
- the request-registry handoff owns one promise per `conversationRequestId`
- exactly one terminal outcome wins
- timeout prevents indefinite wait on the local seam
- late completions are diagnostic-only
- local inspection makes the winning terminal path visible

That is enough closure for the current local scope.

### What are the remaining short-tail tasks, if any?

1. Keep a focused regression watch on the local conversation-boundary tests as future refactors touch `SchedulerSessionIntake`, `SessionManager`, or session persistence.
2. Optionally separate session lifecycle facade concerns from message-execution concerns later, because `SchedulerSessionIntake` still directly composes and calls `SessionManager` for non-message operations.
3. Revisit durable inspection, restart-safe idempotency, and cross-process conversation worker behavior only if a future non-local topology actually requires them.

### Which of those are must-fix before moving on?

None are must-fix before moving on from the ConversationWorker line.

### Which can safely be deferred?

These can safely be deferred:

- evented conversation dispatch
- multi-process conversation workers
- durable conversation request ledgers
- restart-safe dedupe
- operator-facing durable inspection or recovery tooling
- moving gateway session routing ownership
- moving scheduler task materialization authority
- session/repository ownership migration
- deeper session-lifecycle facade cleanup outside the message-execution seam

## Do Not Lose These Invariants

Future refactors should preserve these established invariants unless a later session explicitly and safely replaces them:

- `SchedulerSessionIntake` remains the outer facade for the scheduler-side conversation API.
- `SchedulerSessionIntake.processMessage(...)` continues to route message execution through `ConversationPort`, not around it.
- `ConversationWorker` is the authoritative local orchestration seam for message execution.
- `SessionManager` remains the underlying conversation orchestrator behind the worker seam unless a later session intentionally replaces that ownership.
- `SchedulerTaskBridge` remains scheduler-authoritative for goal/work item materialization.
- gateway session routing ownership remains outside the worker seam.
- `conversationRequestId` remains the primary local request correlation key.
- one dispatched request must yield exactly one terminal outcome for continuation purposes.
- matching duplicate in-flight requests may reuse the same pending promise.
- conflicting duplicate identity for the same `conversationRequestId` must be rejected.
- timeout settles exactly once through the existing failure path.
- late completions after timeout must not produce a second continuation.
- invalid request identity and invalid result shape must not silently pass through as success.
- the request registry remains a narrow local promise-and-terminal-resolution primitive, not a durable orchestration ledger.

## Recommended Handoff To Next Module

### Is the runtime now ready to leave ConversationWorker as a non-primary focus?

Yes.

### What should the next architectural focus be?

The next architectural focus should move to deeper code-boundary cleanup, starting with global singleton and runtime composition pressure in the runtime core.

### Why now?

The three major local seam extractions now have closure reviews:

- execution/recovery
- ToolWorker
- ConversationWorker

ConversationWorker no longer has a must-fix local seam blocker. The remaining work is mostly deferred non-local hardening or broader composition cleanup, not unfinished local seam extraction.

## Deferred ConversationWorker Backlog

1. Separate non-message session lifecycle facade responsibilities from the message-execution seam if that coupling starts blocking future work.
2. Add durable/operator-facing inspection only if a non-local or long-lived conversation worker topology is introduced.
3. Revisit restart-safe dedupe and recovery semantics only if conversation request ownership becomes non-local.

## Recommended Session 54

Session 54 should begin `RF-032` boundary cleanup by documenting and then narrowing the highest-impact global singleton/runtime composition dependencies in the runtime core.

Rationale:

- the seam-extraction phase for the current local worker lines is complete enough to pause
- no immediate ConversationWorker blocker remains
- deeper runtime composition cleanup is the next highest-leverage architectural line that does not require broadening the just-closed conversation scope

## What Should Not Be Done Next

Do not treat the current closure as justification for any of the following next steps:

- evented conversation dispatch
- multi-process conversation workers
- durable conversation ledgers
- gateway-owned conversation request state
- moving `SchedulerTaskBridge` authority into `ConversationWorker`
- moving gateway session routing ownership into `ConversationWorker`
- repository ownership migration
- broad execution/recovery redesign under the label of conversation hardening

Those directions are larger topology or ownership changes, not short-tail completion work for the current local seam.
