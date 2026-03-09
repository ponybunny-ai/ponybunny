# PonyBunny Phase-2 Event Protocol

## Purpose

This document defines the internal RuntimeEvent protocol used to normalize runtime state changes across scheduling, execution, tooling, conversation, and observability.

## RuntimeEvent Shape

```ts
export interface RuntimeEvent {
  id: string
  type: string
  taskId?: string
  goalId?: string
  runId?: string
  source: string
  timestamp: number
  payload?: unknown
}
```

## Event Naming Rules

- use lower-case dotted names
- use stable verb-oriented event names
- prefer domain events over UI-specific names
- keep payload backward-compatible where possible

## Core Event Families

### Goal / Task

- `goal.created`
- `goal.started`
- `goal.completed`
- `goal.failed`
- `goal.cancelled`
- `task.created`
- `task.ready`
- `task.started`
- `task.completed`
- `task.failed`

### Execution

- `execution.started`
- `execution.completed`
- `execution.failed`

### Tooling

- `tool.requested`
- `tool.started`
- `tool.completed`
- `tool.failed`

### Verification / Quality

- `verification.started`
- `verification.completed`
- `verification.failed`

### Conversation

- `conversation.started`
- `conversation.message.received`
- `conversation.response.generated`
- `conversation.completed`
- `conversation.failed`

### LLM

- `llm.started`
- `llm.chunk`
- `llm.completed`
- `llm.failed`

### Runtime / Debug

- `runtime.started`
- `runtime.stopped`
- `runtime.error`
- `debug.event`

## Compatibility Principle

Existing event names may remain in current systems.

During migration, adapters are responsible for translating legacy event streams into RuntimeEvents.

## Persistence Principle

All RuntimeEvents may be persisted into `runtime_events` for tracing and replay.
