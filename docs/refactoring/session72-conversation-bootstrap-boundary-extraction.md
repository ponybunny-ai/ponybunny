# Session 72: Conversation Bootstrap Boundary Extraction

## Scope

This session performs only the first narrow RF-034 coding step identified in Session 71:

- extract the default conversation-runtime assembly out of `SchedulerSessionIntake`
- introduce one scheduler-owned conversation bootstrap/composition boundary
- preserve current gateway behavior, IPC, worker seams, and execution/recovery ownership

This session does not:

- redesign `ConversationWorker`
- redesign `SessionManager`
- redesign `ToolWorker`
- change gateway session routing
- change task-materialization authority
- change direct vs evented execution semantics
- change streaming callback behavior

## What Changed

A narrow scheduler-owned default conversation bootstrap boundary now exists in:

- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`

That boundary now assembles the default conversation runtime graph that used to live inline in `SchedulerSessionIntake`, including:

- persona repository selection and fallback
- `PersonaEngine`
- SQLite-backed session and memory repositories
- `LocalEmbeddingService`
- `CoreMemorySummaryService`
- `ConversationMemoryService`
- `InputAnalysisService`
- `ResponseGenerator`
- `RetryHandler`
- `SchedulerTaskBridge`
- `SessionManager`
- default local `ConversationWorker`

To avoid a new import cycle while keeping the move narrow, `SchedulerTaskBridge` and `resolveMainAgentModelHintFromAgentConfig(...)` were moved into:

- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`

`src/scheduler-daemon/session-intake.ts` now re-exports those symbols for compatibility, so existing imports do not need to change.

## What SchedulerSessionIntake Still Owns

`SchedulerSessionIntake` remains the outer scheduler-daemon-facing facade. It still owns:

- gateway-session binding tracking
- session-event publication
- outer `ConversationRequest` creation
- outer `ConversationResult` validation
- outer continuation after `ConversationPort.process(...)`
- non-message facade operations:
  - open
  - list
  - history
  - end
  - archive
  - resume
  - status

The class no longer assembles the default conversation graph inline.

## Tooling Ownership And Source Of Truth

The migrated path continues to take explicit `RuntimeToolingContext` as an input to default conversation bootstrap.

On this path:

- `RuntimeToolingContext.toolProvider` remains the authoritative source for conversation-visible tool definitions
- the tooling-adjacent response-enforcement choice is now made inside the scheduler-owned bootstrap boundary rather than in the outer intake facade
- `SchedulerSessionIntake` no longer fabricates tool-enforcement state beside explicit `RuntimeToolingContext`

Behavior is preserved:

- the default conversation response path still uses the same local empty `ToolEnforcer` behavior as before
- no `ConversationWorker`, gateway, IPC, or scheduler-authority semantics were changed

## Invariants Preserved

This extraction keeps the following lines unchanged:

- `ConversationWorker` remains the local-authoritative message-execution seam
- `SchedulerTaskBridge` remains scheduler-authoritative for goal/work-item materialization
- gateway session routing remains outside the worker seam
- `SchedulerSessionIntake` remains the outer continuation owner after `ConversationPort.process(...)`
- `RuntimeToolingContext` remains explicit on the migrated path
- transport ownership and durable ownership lines remain unchanged

## Focused Validation

Validated in this session:

- `test/scheduler-daemon/session-intake.test.ts`
- `test/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.test.ts`
- `npm run build`

The added bootstrap test covers:

- default `ConversationWorker` creation
- preservation of injected `ConversationPort` override behavior
- use of `RuntimeToolingContext` tool definitions on the migrated default conversation path

## Next Safest RF-034 Step

The next safest RF-034 cleanup step is not another `ConversationWorker` or `SessionManager` redesign.

The safest next target is a similarly narrow ownership cleanup around scheduler composition-root placement, most likely the currently gateway-named scheduler factory/composition area, while preserving:

- scheduler authority
- gateway behavior
- IPC
- existing runtime ownership lines

That should be approached as another bounded composition/ownership extraction, not a broad module rewrite.
