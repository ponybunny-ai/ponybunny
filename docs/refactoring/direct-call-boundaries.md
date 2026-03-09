# Direct Call Boundaries

## Purpose

This document inventories the strongest remaining direct call boundaries that still block execution-worker extraction.

The emphasis is on the target path, especially the remaining `SchedulerCore -> ExecutionService` coupling and the conversation paths that still create goals and work items synchronously.

## Highest-Priority Boundaries

| Boundary | Caller | Callee | Files | Mode | Why it matters |
| --- | --- | --- | --- | --- | --- |
| Scheduler to execution | `SchedulerCore.executeWorkItem()` | `ExecutionEngineAdapter.execute()` and then `ExecutionService.executeWorkItem()` | `src/scheduler/core/scheduler.ts`, `src/gateway/integration/execution-engine-adapter.ts`, `src/app/lifecycle/execution/execution-service.ts` | Async direct call | Main extraction target; scheduler still waits for execution as a request/response call. |
| Scheduler-owned completion logic | `SchedulerCore.handleExecutionSuccess()` / `handleExecutionFailure()` | verification, retry, escalation, repository writes | `src/scheduler/core/scheduler.ts` | Async direct call | Scheduler still owns too much post-execution interpretation and state mutation. |
| Execution path internal graph | `ExecutionEngineAdapter` / `ExecutionService` | `ReActIntegration`, tool registry, MCP, repository | `src/gateway/integration/execution-engine-adapter.ts`, `src/app/lifecycle/execution/execution-service.ts`, `src/autonomy/react-integration.ts` | Async direct call | Execution internals are not behind a stable worker contract yet. |
| Session-first conversation materialization | `SessionManager.handleExecuting()` | `SchedulerTaskBridge.createGoalFromConversation()` | `src/app/conversation/session-manager.ts`, `src/scheduler-daemon/session-intake.ts` | Async direct call | Conversation directly persists goals/work items and immediately submits them. |
| RPC goal materialization | `goal.submit` / `agent.command.submit` | daemon `materialize_goal` command handler | `src/gateway/rpc/handlers/goal-handlers.ts`, `src/gateway/integration/ipc-bridge.ts`, `src/scheduler-daemon/daemon.ts` | Async IPC request/response | Gateway RPC still directly drives goal/work item creation rather than handing off to a materializer boundary. |
| Legacy conversation bridge | `TaskBridge.createGoalFromConversation()` | repository + `scheduler.submitGoal()` | `src/app/conversation/task-bridge.ts` | Mixed sync + async `setImmediate` | Not the target path, but it preserves an older direct-coupling pattern that can regress the extraction later. |

## Boundary 1: SchedulerCore -> ExecutionService

### Caller

- `SchedulerCore.startWorkItemExecution()`
- `SchedulerCore.executeWorkItem()`

### Callee

- `ExecutionEngineAdapter.execute()`
- `ExecutionService.executeWorkItem()`

### File paths

- `src/scheduler/core/scheduler.ts`
- `src/gateway/integration/execution-engine-adapter.ts`
- `src/app/lifecycle/execution/execution-service.ts`

### Sync/async/evented

Async direct call. It is in-process and Promise-based, but not evented.

### Current call chain

`SchedulerCore.startWorkItemExecution()`
-> create scheduler-owned run
-> mark work item `in_progress`
-> call `SchedulerCore.executeWorkItem()`
-> await `executionEngine.execute(...)`
-> `ExecutionEngineAdapter.execute(...)`
-> `ExecutionService.executeWorkItem(...)`
-> `ReActIntegration.executeWorkCycle(...)`

### Why this is a coupling problem

- Scheduler still initiates execution as a direct call instead of publishing an execution request.
- Scheduler creates a run before dispatch in `src/scheduler/core/scheduler.ts`.
- `ExecutionService` creates another run inside `src/app/lifecycle/execution/execution-service.ts`.
- Scheduler completes its own run after the execution service already completed the execution-service-owned run.
- Abort is not a clean boundary: `ExecutionEngineAdapter` tracks only a temporary pending id and does not propagate the scheduler-owned run id or abort signal through to `ExecutionService`.

This is the strongest remaining blocker for worker extraction because run ownership, retry semantics, and abort semantics all cross the same direct call.

### Recommended future extraction strategy

Introduce an internal execution command/result contract:

- scheduler publishes `execution.requested`
- execution worker consumes request and owns the execution attempt
- worker publishes `execution.completed` or `execution.failed`
- scheduler reacts to result events instead of awaiting a direct call

The first compatibility version can still run in-process and call the existing `ExecutionService` under the hood.

## Boundary 2: Scheduler-owned completion, retry, and terminal-state logic

### Caller

- `SchedulerCore.handleExecutionSuccess()`
- `SchedulerCore.handleExecutionFailure()`
- `SchedulerCore.completeGoal()`
- `SchedulerCore.handleBudgetExceeded()`

### Callee

- quality gate runner
- retry handler
- escalation handler
- repository updates for work items and goals

### File paths

- `src/scheduler/core/scheduler.ts`

### Sync/async/evented

Async direct call, entirely scheduler-owned.

### Why it is a coupling problem

Scheduler still interprets raw execution outcomes and directly decides:

- whether verification runs now
- whether verification failure becomes execution failure
- whether retry happens
- whether failure escalates
- whether work item becomes `queued`, `blocked`, `failed`, or `done`
- whether goal becomes `blocked` or `completed`

This means orchestration and execution-result handling are still fused inside one class. Even if dispatch were evented, the result side would still be tightly coupled.

### Recommended future extraction strategy

Split completion handling into explicit result stages:

- execution result event
- verification result event
- retry decision event
- terminal outcome event

`SchedulerCore` should remain the orchestration owner, but it should react to explicit result envelopes instead of directly running the full completion pipeline inline.

## Boundary 3: Execution path internal call graph

### Caller

- `ExecutionEngineAdapter.execute()`
- `ExecutionService.executeWorkItem()`

### Callee

- `ReActIntegration.executeWorkCycle()`
- tool registry and tool enforcer
- MCP registry integration
- repository writes for runs, escalations, decisions, and spending

### File paths

- `src/gateway/integration/execution-engine-adapter.ts`
- `src/app/lifecycle/execution/execution-service.ts`
- `src/autonomy/react-integration.ts`

### Sync/async/evented

Async direct call graph. Not evented.

### Why it is a coupling problem

The execution boundary is not just "run this work item." It currently bundles:

- approval gating
- resource narrowing
- run creation
- run completion
- goal spending updates
- tool policy audit persistence
- escalation persistence
- native tool-calling loop
- local tool fallback
- direct tool execution

That makes it hard to define what an extracted execution worker should own versus what the scheduler should own.

There is also a path split inside `ExecutionEngineAdapter`:

- agent ticks can go to `runner.runTick(...)`
- other work items go to `ExecutionService.executeWorkItem(...)`

So the boundary already has two execution backends with one shared scheduler-facing contract.

### Recommended future extraction strategy

Define one execution-attempt envelope that is backend-neutral:

- work item snapshot
- goal id
- run id
- selected model
- lane id
- route/tool policy context

Then make both existing backends implement that contract behind one worker-facing adapter.

## Boundary 4: Session-first conversation path directly creates goals and work items

### Caller

- `SessionManager.handleExecuting()`

### Callee

- `SchedulerTaskBridge.createGoalFromConversation()`

### File paths

- `src/app/conversation/session-manager.ts`
- `src/scheduler-daemon/session-intake.ts`

### Sync/async/evented

Async direct call, in-process within the scheduler daemon.

### Current call chain

`SessionManager.handleExecuting()`
-> `SchedulerTaskBridge.createGoalFromConversation()`
-> `repository.createGoal(...)`
-> `repository.createWorkItem(...)`
-> `scheduler.submitGoal(goal)`

### Why it is a coupling problem

- Conversation owns goal materialization details directly.
- Conversation also chooses the initial work item shape directly.
- Submission to the scheduler happens immediately after persistence.
- There is no explicit materialization boundary event between conversation intent and executable work.

This means a future `ConversationWorker` cannot be extracted cleanly without also dragging repository and scheduler semantics with it.

### Recommended future extraction strategy

Introduce a goal-materialization boundary:

- conversation emits `goal.materialization.requested`
- materializer creates goal and initial work item
- materializer emits `goal.materialized`
- scheduler later consumes submitted/materialized goals

This preserves current behavior while removing direct repository and scheduler ownership from the conversation path.

## Boundary 5: Gateway RPC path directly materializes goal state in the daemon

### Caller

- `goal.submit`
- `agent.command.submit`
- `IPCBridge.materializeGoal()`

### Callee

- scheduler-daemon `materialize_goal` command handler
- repository goal/work item creation
- optional immediate `scheduler.submitGoal(goal)`

### File paths

- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/gateway/integration/ipc-bridge.ts`
- `src/scheduler-daemon/daemon.ts`

### Sync/async/evented

Async IPC request/response. It crosses processes, but it is still direct command handling rather than evented handoff.

### Why it is a coupling problem

- Gateway RPC shape is coupled to daemon-side goal creation semantics.
- The daemon command handler directly persists goal and initial work item state.
- Auto-submit behavior is embedded into the same command handler.
- This makes goal creation an RPC-side imperative action instead of an internal materialization boundary.

This is acceptable for compatibility, but it keeps the architecture command-shaped instead of event-shaped.

### Recommended future extraction strategy

Keep the external RPC contract unchanged, but internally route it through a materializer component that:

- validates the request
- persists goal/work item state
- emits materialization events
- optionally emits a separate submission event

That allows the RPC contract to stay stable while the internals become event-driven.

## Boundary 6: Legacy `TaskBridge` still preserves the old direct pattern

### Caller

- `TaskBridge.createGoalFromConversation()`

### Callee

- repository `createGoal(...)`
- `scheduler.submitGoal(...)` via `setImmediate`

### File paths

- `src/app/conversation/task-bridge.ts`

### Sync/async/evented

Mixed. Goal persistence is direct and immediate. Scheduler submission is deferred with `setImmediate`, but still not evented.

### Why it is a coupling problem

This is not the session-first target path, but it preserves the same architectural shape:

- conversation code directly persists goal state
- conversation code still knows when to submit to the scheduler

If it remains live or gets reused later, it can reintroduce the same coupling after the target path is extracted.

### Recommended future extraction strategy

Either retire it after session-first cutover or make it delegate to the same future materialization boundary used by `SchedulerTaskBridge`.

## First Extraction Recommendation

The first code extraction step should be:

1. Add an internal execution request envelope keyed by the scheduler-owned `run.id`.
2. Replace the direct `await executionEngine.execute(...)` in `SchedulerCore` with a publish/consume compatibility boundary.
3. Keep the current `ExecutionService` behind that boundary initially.
4. Remove dual run ownership so exactly one side owns run creation and completion.

That step is small enough to keep the system buildable, preserves behavior, and directly targets the highest-value coupling.
