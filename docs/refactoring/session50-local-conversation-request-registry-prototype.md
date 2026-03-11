# Session 50: Local Conversation Request Registry Prototype

## Scope

This session implements the narrow local in-process `ConversationRequestRegistry` prototype identified in Session 49.

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
- add durable conversation ledgers
- implement multi-process or evented `ConversationWorker` behavior

## What Changed

A new local in-process `ConversationRequestRegistry` now sits under the authoritative local `ConversationWorker` seam.

The registry is keyed by `conversationRequestId` and stores the minimum identity and lifecycle metadata needed for this prototype:

- `conversationRequestId`
- `sessionId` when present
- `personaId` when present
- `userProfileId` when present
- `agentId` when present
- message digest
- attachment identity summary
- `registeredAt`
- terminal metadata after first resolution

The registry owns the promise capability returned to the caller. `ConversationWorker.process(...)` now returns the registry-owned `Promise<ConversationResult>` instead of treating the raw orchestration promise as the lifecycle owner.

## What The Registry Owns

For one local request lifecycle, the registry now owns:

- registration by `conversationRequestId`
- the single promise awaited through `ConversationPort.process(...)`
- pending vs resolved lifecycle state
- first terminal resolution
- duplicate in-flight reuse for matching identity
- local rejection of conflicting duplicate identity
- narrow terminal metadata for `success`, `failure`, and `invalid`

The worker still owns request validation, orchestration delegation, and normalization of raw `SessionManager.processMessage(...)` output into either a valid `ConversationResult` or a normalized local failure/invalid error.

## When Registration Happens

Registration now happens inside `ConversationWorker.process(...)` before the worker begins `SessionManager.processMessage(...)`.

That preserves the caller contract:

1. `SchedulerSessionIntake` creates one `ConversationRequest`
2. `SchedulerSessionIntake` calls `await conversationPort.process(request)`
3. `ConversationWorker` registers the request locally by `conversationRequestId`
4. only after registration does the worker begin the current orchestration path

For valid requests, the registry entry exists before orchestration begins. For requests that fail local validation after registration, the registry-owned promise is rejected through the registry without calling the orchestrator.

## How Duplicate In-Flight Handling Works Now

Duplicate suppression is no longer owned by a raw worker-local in-flight promise map.

It now works through `ConversationRequestRegistry.register(...)`:

- same `conversationRequestId` plus matching identity returns the same pending promise
- same `conversationRequestId` plus conflicting identity is rejected locally before orchestration begins for that duplicate caller

This keeps duplicate handling local and in-process only. No durable storage or cross-process dedupe was added.

## How First Terminal Resolution Works Now

`ConversationRequestRegistry.register(...)` returns a narrow `ConversationRequestResolutionOwner` only for the first authoritative registration.

That owner exposes:

- `resolveSuccess(...)`
- `resolveFailure(...)`
- `resolveInvalid(...)`

`ConversationWorker` remains responsible for deciding which path applies after normalization, but the registry now explicitly owns first-terminal-wins behavior:

- the first successful resolution settles the registry-owned promise
- the first normalized failure rejects the registry-owned promise
- the first normalized invalid result rejects the registry-owned promise
- later terminal attempts for the same owner are ignored for continuation purposes

This keeps one awaited `ConversationResult` or one terminal rejection as an explicit lifecycle rule of the local seam.

## What Did Not Change

The following boundaries remain unchanged:

- `SchedulerSessionIntake` is still the outer façade
- gateway session routing remains outside `ConversationWorker`
- `SchedulerTaskBridge` remains scheduler-authoritative for goal/work item materialization
- repository ownership remains unchanged
- `ConversationWorker` is still local and in-process only
- `SchedulerSessionIntake` still awaits one `Promise<ConversationResult>` and performs the one continuation after result validation
- gateway-facing transport behavior remains unchanged

## Focused Validation

This session added or updated focused coverage for:

- request registration before orchestration execution
- one request resolving to exactly one `ConversationResult`
- duplicate matching in-flight registration reusing the same promise
- conflicting duplicate request rejection
- invalid request/result normalization through the registry-owned promise
- unchanged `SchedulerSessionIntake` await-and-continue behavior
- unchanged gateway-facing transport behavior on the intake seam

## Next Safest ConversationWorker Step

The next safest step is still narrow and local:

Use this registry-backed promise handoff as the lifecycle base for any future internal `ConversationWorker` completion hardening, while keeping:

- `SchedulerSessionIntake` as continuation owner
- one request -> one awaited `Promise<ConversationResult>` -> one continuation
- gateway routing outside the worker
- scheduler-authoritative task materialization outside the worker
- everything local and in-process first

That next step should not broaden into evented conversation dispatch, timeout policy ownership, durable ledgers, or scheduler/gateway/repository ownership redesign.
