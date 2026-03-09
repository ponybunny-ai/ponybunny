# Session 35: Local ToolWorker Skeleton

## What Changed

Session 35 adds a local in-process `ToolWorker` skeleton at [src/runtime/workers/tool-worker.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/tool-worker.ts).

The worker is intentionally narrow:

- it accepts the existing `ToolRequest` shape from [src/runtime/tool-boundary/types.ts](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/types.ts)
- it invokes the existing `ToolPort.execute(...)` boundary
- it returns the existing `ToolResult` shape
- it emits additive runtime events while staying in the same process

No second tool request model was introduced. The worker reuses the Session 34 boundary directly.

## Worker Shape

`LocalToolWorker` is a local dispatch object, not a separate process and not a durable queue. It exposes a narrow internal dispatch surface:

- `dispatch(request: ToolRequest): Promise<ToolResult>`

Inside `dispatch(...)`, the worker:

1. suppresses duplicate requests by `toolRequestId` for the current process lifetime
2. emits `tool.requested`
3. emits `tool.started`
4. calls `ToolPort.execute(request)`
5. emits `tool.completed` on success
6. emits `tool.failed` on an unsuccessful result or thrown exception

Thrown exceptions are normalized back into the existing `ToolResult` envelope with `success: false`, so the worker remains boundary-compatible with the current direct path.

## Event Shape

The worker uses the runtime event bus and emits these event types:

- `tool.requested`
- `tool.started`
- `tool.completed`
- `tool.failed`

Each event carries the identity needed for later hardening:

- `toolRequestId`
- `runId`
- `workItemId`
- `goalId` when available
- `toolCallId`
- `toolName`
- `source = "local-tool-worker"`

`runId`, `goalId`, `workItemId`, `toolRequestId`, `toolCallId`, and `toolName` are available both as top-level runtime event metadata and inside the typed payload context for worker-local consumers.

## Runtime Composition

Runtime composition was updated in [src/app/lifecycle/execution/execution-service.ts](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts).

`ExecutionService` now creates:

- the existing authoritative direct adapter: `LocalToolAdapter`
- the new parallel local worker: `LocalToolWorker`

`ReActIntegration` still receives the direct `LocalToolAdapter` path as its `ToolPort`. That keeps current tool execution behavior stable while making the worker available in composition for later migration steps.

## What Did Not Change

This session does not change:

- gateway behavior
- IPC
- direct vs evented execution semantics
- tool choice ownership
- policy or permission ownership
- prompt generation
- tool schema generation
- conversation worker boundaries
- multi-process or durable tool dispatch

The worker is not authoritative yet. Tool execution is still driven by the existing direct `ToolPort` path by default.

## Why The Worker Is Not Authoritative Yet

Making the worker authoritative would require more than a local wrapper. The system still needs follow-up work around:

- choosing whether tool dispatch becomes direct-via-worker or evented-via-worker
- defining result handoff and continuation ownership for a worker-driven path
- deciding durable idempotency and replay expectations beyond process memory
- clarifying inspection and recovery surfaces for worker-managed tool execution

Those concerns were intentionally left out of Session 35 to keep the change additive and behavior-preserving.

## Remaining Work Before Worker-Driven Tool Execution

Before tool execution can become worker-driven, later sessions still need to address:

- whether a tool mode switch is needed
- how authoritative result application will be handed back safely
- durable duplicate suppression / replay policy
- operator inspection for worker-driven tool runs
- any future evented or multi-process dispatch model

Session 35 only establishes the local skeleton and event flow needed for those later steps.
