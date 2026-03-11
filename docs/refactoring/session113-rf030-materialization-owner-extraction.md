# Session 113: RF-030 Materialization Owner Extraction

## Targeted RF-030 Cluster

Session 113 completed the first major coding cluster of `RF-030`:

- extract the concrete conversation-triggered goal materialization path out of `SchedulerTaskBridge`
- move the first work-item creation plus scheduler-submit sequence behind a narrower scheduler-daemon-owned owner
- keep `SessionManager` as the initiator of execution from conversation analysis
- preserve status/observation behavior and payload shapes for now

This session stayed local to the existing conversation bootstrap path and did not reopen `RF-034`, `RF-059`, `RF-060`, `RF-061`, or any paused lines.

## Materialization Owner Introduced

Added `src/scheduler-daemon/conversation-bootstrap/conversation-task-materializer.ts` with:

- `ConversationTaskMaterializer`
- `IConversationTaskMaterializer`

This new scheduler-daemon-owned owner now holds the concrete materialization sequence for the live conversation path:

- resolve the same effective selected-model input used before execution
- materialize the same compatibility `selected_model` / `model` projection
- create the goal with the same conversation provenance/context
- create the first work item with the same kind, shape, and context
- submit the created goal through the same `schedulerProvider()` conditional behavior

The model-hint helper used by this path now lives with the materialization owner rather than the bridge.

## What Moved Out Of `SchedulerTaskBridge`

Moved out of `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`:

- effective selected-model compatibility projection for conversation materialization
- goal creation
- first work-item creation
- scheduler submission
- materialization-path budget/priority mapping helpers

`SchedulerTaskBridge.createGoalFromConversation(...)` now delegates the full materialize-and-submit sequence to `ConversationTaskMaterializer`.

## What Intentionally Remained In `SchedulerTaskBridge`

Intentionally left in `SchedulerTaskBridge` for this session:

- the existing `SessionManager`-facing `createGoalFromConversation(...)` method shape
- repository-backed `getTaskStatus(...)`
- `subscribeToProgress(...)` behavior
- `cancelTask(...)`

That keeps observation/status responsibilities where they were, avoids broad lifecycle redesign, and preserves the current `SessionManager` call site and monitoring flow.

## Semantics Intentionally Preserved

The extraction was bounded to preserve current behavior:

- `SessionManager` still decides when conversation analysis becomes executable work
- `createGoalFromConversation(...)` still returns the same `goalId` / `workItems` shape
- goal fields and context payloads are unchanged
- first work-item kind, fields, and context payloads are unchanged
- selected-model compatibility projection behavior is unchanged
- scheduler submit timing and conditional `schedulerProvider()` behavior are unchanged
- observation/status reads remain repository-backed through `SchedulerTaskBridge`
- conversation worker, intake, transport, RPC/event/status payloads, and TUI behavior are unchanged

## Likely Next RF-030 Review Focus

The next RF-030 session should be a review / re-ranking pass, not another broad extraction.

Most likely remaining review topics:

- whether the `SessionManager`-facing bridge should later split creation from observation surfaces
- whether any remaining conversation-facing naming now hides scheduler-daemon ownership too broadly
- whether progress/observation responsibilities have a high-value next cut after this materialization-owner extraction
