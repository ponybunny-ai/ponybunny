# Session 47: Local Conversation Boundary First Extraction

## What Changed

This session introduced the first narrow local conversation boundary:

- `ConversationRequest`
- `ConversationResult`
- `ConversationPort`
- local in-process `ConversationWorker`

The new boundary lives under:

- [`src/runtime/conversation-boundary/conversation-port.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/conversation-boundary/conversation-port.ts)
- [`src/runtime/workers/conversation-worker.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/conversation-worker.ts)

`ConversationRequest` adds a stable worker-local request identity with `conversationRequestId` and carries only the current orchestration inputs that `SessionManager.processMessage(...)` actually needs:

- `message`
- optional `sessionId`
- optional `personaId`
- optional `userProfileId`
- optional `agentId`
- optional `attachments`

`ConversationResult` mirrors the current conversation orchestration output shape instead of introducing a new design:

- `conversationRequestId`
- `sessionId`
- `response`
- `state`
- `decision`
- `decisionReason`
- `taskInfo`

## What The New ConversationWorker Wraps

The first `ConversationWorker` is intentionally local and in-process.

It does not introduce:

- evented conversation dispatch
- durable request ledgers
- multi-process worker execution
- independent persistence ownership

Instead, it wraps the existing `SessionManager`-centered orchestration path and delegates directly to `SessionManager.processMessage(...)`.

That means the current orchestration stack remains intact:

- session load/create
- persona resolution
- memory recall/indexing
- input analysis
- state transition logic
- response generation
- optional task creation through `ITaskBridge`

The worker is therefore only authoritative for the narrow conversation orchestration seam, not for scheduler authority, transport ownership, or persistence ownership.

## What SchedulerSessionIntake Now Delegates Through The Seam

`SchedulerSessionIntake.processMessage(...)` now:

1. creates a local `conversationRequestId`
2. publishes `conversation.message.started`
3. delegates message orchestration through `ConversationPort.process(...)`
4. keeps gateway session binding updates in `SchedulerSessionIntake`
5. keeps scheduler-to-gateway event publication in `SchedulerSessionIntake`
6. returns the same gateway-facing result shape as before

`SchedulerSessionIntake` remains the current outer composition root and scheduler-daemon façade.

It still constructs:

- persona engine
- session repository
- memory repository and memory service
- input analysis service
- response generator
- retry handler
- `SchedulerTaskBridge`
- `SessionManager`

The only new default composition change is that `SchedulerSessionIntake` now creates a local `ConversationWorker` and calls it through `ConversationPort`.

## What Did Not Change

This extraction deliberately did not change:

- gateway behavior
- IPC request/response protocol
- daemon command handling
- session event publication semantics
- direct vs evented execution semantics
- execution/recovery design
- `ToolWorker`
- scheduler-owned goal/work item materialization authority
- gateway session routing ownership
- session repository ownership
- memory repository ownership
- persona/prompt strategy

More specifically:

- `SchedulerTaskBridge` still owns scheduler-authoritative conversation task materialization.
- `gatewaySessionId` routing stays outside the worker seam.
- `ConversationWorker` does not receive gateway routing metadata.
- `SchedulerSessionIntake` still owns scheduler-session to gateway-session binding updates.

## Next Safest ConversationWorker Step

The next safe step is not multi-process activation and not moving scheduler authority.

The safest follow-up is to keep the seam local while tightening internal conversation ownership around the port boundary, for example by:

- making the `ConversationPort` path the single explicit orchestration dependency of `SchedulerSessionIntake`
- incrementally reducing direct `SessionManager` knowledge from the scheduler intake composition layer
- preparing a later, explicit decision about whether conversation-owned orchestration dependencies should be bundled behind a dedicated local factory without moving repository or scheduler authority

The next step should still preserve:

- `SchedulerTaskBridge` as the goal/work-item authority
- `SchedulerSessionIntake` as the gateway/daemon-facing façade
- current IPC and gateway routing behavior
