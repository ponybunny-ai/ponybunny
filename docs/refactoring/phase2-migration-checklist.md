# PonyBunny Phase-2 Migration Checklist

## Stage 0 — Documentation

- [ ] Add phase2-runtime-architecture.md
- [ ] Add phase2-event-protocol.md
- [ ] Add phase2-migration-checklist.md
- [ ] Commit docs-only baseline

## Stage 1 — Runtime Event Bus

- [ ] Add RuntimeEvent type
- [ ] Add EventBus interface
- [ ] Add MemoryEventBus implementation
- [ ] Add temporary runtimeEventBus singleton
- [ ] No behavior change
- [ ] Build passes
- [ ] Commit

## Stage 2 — Event Adapters

- [ ] Add gateway event adapter
- [ ] Add scheduler event adapter
- [ ] Add debug event adapter
- [ ] Existing event flow preserved
- [ ] Runtime events emitted in parallel
- [ ] Build passes
- [ ] Commit

## Stage 3 — Runtime Event Store

- [ ] Add `runtime_events` schema
- [ ] Add RuntimeEventStore
n- [ ] Persist emitted runtime events
- [ ] Avoid blocking scheduler hot path
- [ ] Build passes
- [ ] Commit

## Stage 4 — Event Inspection CLI

- [ ] Add `pb events tail`
- [ ] Add `pb events replay <goalId>` skeleton
- [ ] Validate readable output
- [ ] Build passes
- [ ] Commit

## Stage 5 — Execution Worker Extraction

- [ ] Add ExecutionWorker abstraction
- [ ] Scheduler emits `task.ready`
- [ ] ExecutionWorker subscribes to `task.ready`
- [ ] Preserve old execution behavior until fully switched
- [ ] Build passes
- [ ] Commit

## Stage 6 — Tool Worker Extraction

- [ ] Add ToolWorker abstraction
- [ ] Emit `tool.requested`
- [ ] ToolWorker handles tool execution path
- [ ] Preserve old behavior with adapter layer if needed
- [ ] Build passes
- [ ] Commit

## Stage 7 — Conversation / Quality Workers

- [ ] Add ConversationWorker
- [ ] Add QualityWorker
- [ ] Normalize verification events
- [ ] Reduce scheduler responsibilities
- [ ] Build passes
- [ ] Commit
