# PonyBunny Phase-2 Runtime Architecture

## Objective

Refactor PonyBunny toward a Phase-2 runtime model that is:

- event-driven
- multi-worker, single-process
- easier to debug
- safer to change incrementally
- compatible with the existing Gateway + Scheduler topology

## Current Problems

The current runtime has several structural issues:

1. Scheduler is both orchestrator and execution initiator.
2. Execution, tools, LLM streaming, and verification are tightly coupled.
3. Runtime events are fragmented across gateway events, debug events, IPC messages, and database run events.
4. Global singletons hide dependencies and increase cross-module coupling.
5. The runtime is operationally split into processes, but the codebase remains internally monolithic.

## Phase-2 Design Principles

1. Orchestration is separate from execution.
2. Execution is separate from tool invocation.
3. Tool invocation is separate from transport/UI concerns.
4. All major runtime state transitions should emit RuntimeEvents.
5. Existing behavior must be preserved during migration.
6. Refactoring should proceed through adapters, not big-bang rewrites.

## Runtime Components

### Scheduler

Responsibilities:
- decide what task/work item becomes ready
- update task lifecycle state
- emit scheduling events
- track orchestration progress

Non-responsibilities:
- perform tool execution
- directly own LLM transport behavior
- directly handle UI broadcasting

### RuntimeEventBus

Responsibilities:
- publish runtime events
- allow workers and observers to subscribe
- act as the internal event backbone

### ExecutionWorker

Responsibilities:
- respond to task-ready events
- run execution logic for a work item
- emit execution lifecycle events

### ToolWorker

Responsibilities:
- execute tool requests
- emit tool lifecycle events
- isolate tool execution concerns from orchestration

### ConversationWorker

Responsibilities:
- process conversation/session events
- emit conversation responses and optionally task creation events

### QualityWorker

Responsibilities:
- verify completed execution results
- emit verification outcomes
- avoid embedding verification directly inside scheduler orchestration logic

## Migration Direction

### Phase 1
Introduce RuntimeEventBus and RuntimeEvent abstraction.

### Phase 2
Bridge existing event systems into RuntimeEventBus.

### Phase 3
Persist RuntimeEvents in SQLite.

### Phase 4
Add event inspection CLI.

### Phase 5
Extract ExecutionWorker.

### Phase 6
Extract ToolWorker.

### Phase 7
Extract ConversationWorker and QualityWorker.

## Constraints

- preserve current user-visible behavior
- do not break Gateway RPC contracts
- do not break IPC behavior
- do not require distributed workers yet
- keep architecture compatible with later multi-process evolution
