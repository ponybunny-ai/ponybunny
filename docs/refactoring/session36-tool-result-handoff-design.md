# Session 36: Tool Result Handoff Design

## Scope

This session is documentation-only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery
- broaden into conversation worker extraction
- implement authoritative `ToolWorker` execution
- implement multi-process tool dispatch
- redesign MCP lifecycle or permission ownership

The goal is to define the first safe tool-result handoff model for the future point where `ToolWorker` becomes authoritative.

## Current Direct Tool Result Path

Today tool execution is still continuation-inline inside `ReActIntegration`.

`ExecutionService` constructs:

- `ToolRegistry`
- `ToolAllowlist`
- `ToolEnforcer`
- authoritative `LocalToolAdapter`
- non-authoritative parallel `LocalToolWorker`

and passes the direct adapter into `ReActIntegration`, not the worker ([`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L44), [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L66), [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L74), [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L76)).

Inside `ReActIntegration.executeWorkCycle(...)`, the model response loop remains the owner of tool-call sequencing. When the LLM emits `toolCalls`, the loop:

1. appends the assistant tool-call message
2. iterates each tool call
3. handles `complete_task` inline
4. calls `executeToolCall(...)`
5. appends the returned tool result as a `role: "tool"` message
6. records an observation
7. continues the same LLM loop

That flow is still synchronous and local to the loop ([`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L159), [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L200), [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L225)).

`executeToolCall(...)` builds a `ToolRequest`, awaits `toolPort.execute(...)`, then converts the normalized `ToolResult` into the model-facing string using `formatToolResultForModel(...)` ([`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1146), [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1165), [`src/runtime/tool-boundary/types.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/types.ts#L35)).

`LocalToolAdapter` is the authoritative direct path today. It normalizes arguments, checks policy through `ToolEnforcer`, looks up the tool, executes it, and always returns a `ToolResult` envelope with either:

- `success: true` plus `output`
- `success: false` plus structured `error`

([`src/runtime/tool-boundary/local-tool-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/local-tool-adapter.ts#L7), [`src/runtime/tool-boundary/local-tool-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/local-tool-adapter.ts#L13), [`src/runtime/tool-boundary/local-tool-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/local-tool-adapter.ts#L31), [`src/runtime/tool-boundary/local-tool-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/local-tool-adapter.ts#L48)).

## How Success, Failure, and Continuation Work Today

Tool success and failure are currently consumed only inside `ReActIntegration`.

There is no scheduler-side tool continuation seam equivalent to execution’s `continueAfterExecutionResult(...)`. The only continuation owner after a tool result exists is the current ReAct loop instance.

More specifically:

- `ToolResult.success === true` becomes a tool-message string, is appended to the LLM conversation, and the loop continues.
- `ToolResult.success === false` also becomes a tool-message string, is appended to the LLM conversation, and the same loop decides what to do next.
- thrown exceptions from the direct adapter are already normalized into failed `ToolResult`s, so the loop usually sees one envelope shape rather than two incompatible paths.

This means the current continuation boundary for tool execution is:

- request ownership: `ReActIntegration`
- result consumption: `ReActIntegration`
- post-result continuation: `ReActIntegration`
- run completion / retry / verification continuation: still outside in execution/scheduler after the whole work cycle returns

`ExecutionService` does not see individual tool results. It only sees the final run-level `ReActCycleResult` returned by `executeWorkCycle(...)`, then persists run completion and spending after the entire loop exits ([`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L247), [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L293)).

## The Future Worker-Driven Handoff Question

Once a `ToolWorker` result exists, who owns continuation?

That question is materially different from the earlier execution-worker handoff. Execution already had a scheduler-owned post-result continuation seam, so Session 13 and Session 14 could make worker results authoritative by handing them into existing scheduler logic. Tool execution does not have such a separate seam today. The worker result would be born inside the execution loop and must be handed back into that same execution loop safely.

The future worker-driven design therefore needs clear answers to three questions:

1. Who consumes the authoritative `ToolResult`?
2. By what coordination seam does that consumer resume the loop?
3. Which identifiers prove that the result belongs to the currently waiting tool call and not some duplicate or stale delivery?

For the first authoritative cut, the safest answer is still:

- `ReActIntegration` remains the continuation owner after a tool result exists.

The worker may become authoritative for dispatch, normalization, and event emission, but not for deciding the next model step, marking task completion, handling no-action fallback, or exiting the ReAct loop.

## Minimum Safe Correlation and Invariant Set

The first worker-driven handoff must preserve a minimal correlation set before any later durability work is attempted.

### `toolRequestId`

This should be the primary per-dispatch-attempt identity.

Today it is built as `${run.id}:${toolCall.id}:${toolName}` in `ReActIntegration` ([`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1167)).

For the first authoritative worker cut, the minimum invariant should be:

- one waiting continuation expects exactly one terminal `ToolResult` for one `toolRequestId`
- the returned `ToolResult.toolRequestId` must exactly equal the dispatched request’s `toolRequestId`

This is the most important result-handoff invariant because it ties the waiting continuation to the exact dispatch attempt rather than only to the run.

### `runId`

`runId` remains scheduler-owned identity and must stay untouched.

It is necessary but not sufficient for tool-result correlation because a single run can emit multiple tool calls. `runId` should therefore be treated as context and audit identity, not as the unique result key for tool handoff.

### `workItemId`

`workItemId` should remain present in both request and result as a consistency guard and audit field.

Like `runId`, it is not unique enough to drive handoff by itself. It protects against obviously misrouted results and keeps parity with the broader runtime event envelope.

### `toolCallId`

`toolCallId` is the model-level identity for a specific tool call within the LLM response.

It should remain mandatory in request and result because:

- the ReAct loop appends tool messages keyed by `tool_call_id`
- a future authoritative worker path still has to resume the LLM conversation against that exact tool call

`toolCallId` is the strongest semantic tie back to the LLM transcript, but it still needs `toolRequestId` to distinguish multiple dispatch attempts if retry/reissue semantics ever appear later.

### `toolName`

`toolName` should stay in the correlation set as an integrity check and audit field, not as the primary key.

It helps reject malformed or stale results that claim the right `toolCallId` but a mismatched tool payload shape.

### Result success/failure shape

The authoritative handoff should continue to use the existing `ToolResult` envelope:

- `success: true` with `output?: string`
- `success: false` with `error?: ToolFailure`

That preserves compatibility with `formatToolResultForModel(...)` and avoids reintroducing split success/exception control flow into the ReAct loop ([`src/runtime/tool-boundary/types.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/types.ts#L19)).

The minimum invariant is:

- every authoritative worker completion path must resolve to one normalized `ToolResult`

### Duplicate result concerns

The current worker only suppresses duplicates in memory by `toolRequestId` for the process lifetime ([`src/runtime/workers/tool-worker.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/tool-worker.ts#L48), [`src/runtime/workers/tool-worker.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/tool-worker.ts#L55)).

That is enough for the first local authoritative cut only if:

- the same awaiting caller is still synchronously blocked on the returned promise
- no second out-of-band consumer can also apply the same result

In other words, duplicate protection can remain process-local only while result application also remains process-local and synchronous.

### Late result concerns

Late results become dangerous only when dispatch and continuation are decoupled.

If the worker becomes authoritative through an awaited promise in the same process, a late-result class does not materially expand beyond normal async completion because the awaiting loop does not move on until the promise settles.

If the system later moves to event-driven or multi-process tool completion, late-result handling will require a stronger claim-once model analogous to evented execution. That is explicitly out of scope for the first authoritative cut.

## Safest First Authoritative `ToolWorker` Model

The safest first authoritative model is:

- local
- in-process
- awaited synchronously by `ReActIntegration`
- non-evented for result handoff

Concretely:

1. `ReActIntegration` should build the same `ToolRequest` it builds today.
2. Instead of calling `LocalToolAdapter.execute(...)` directly, it should call `LocalToolWorker.dispatch(...)`.
3. `LocalToolWorker` should remain a local wrapper over the same `ToolPort`.
4. `ReActIntegration` should await the returned `Promise<ToolResult>`.
5. After the promise resolves, `ReActIntegration` should remain the sole owner of:
   - formatting the result for the model
   - appending the tool message
   - deciding the next loop step
   - handling `complete_task`
   - handling fallback / no-action behavior

This keeps the worker authoritative for dispatch while avoiding a second asynchronous continuation seam.

### Should the first cut still be local/in-process?

Yes.

The current worker is already local/in-process, and all current invariants assume that direct mode is the stable path. Making the first authoritative cut local preserves:

- direct-mode stability
- existing tool runtime ownership
- unchanged gateway/IPC/process topology
- unchanged MCP transport usage

### Is a tool mode switch needed?

No, not for the first authoritative cut.

A tool mode switch would create premature surface area before the system has even validated one authoritative worker path. The smallest safe step is to switch the local authoritative call site from direct adapter invocation to awaited worker invocation without introducing direct-vs-evented tool semantics yet.

### Should `ReActIntegration` block awaiting a worker-mediated result?

Yes.

Blocking on the worker promise is the safest coordination seam because it preserves the current continuation owner. It treats the worker as a dispatch boundary, not as a second orchestration loop.

This is the direct tool analogue of “keep the existing continuation owner until a separate authoritative continuation seam exists.”

### What should remain direct in the first cut?

The following should remain direct:

- prompt generation
- tool schema generation and model tool exposure
- policy shaping in `ExecutionService`
- policy enforcement authority in `ToolEnforcer`
- MCP lifecycle and connection ownership
- model loop control inside `ReActIntegration`
- overall run completion / retry / verification semantics

## What Should Not Be Extracted Yet

The codebase supports a narrow worker step, not a broad tool-runtime relocation.

The following should not be extracted yet:

### MCP lifecycle ownership

`ExecutionService.initializeMCP()` still initializes MCP integration and auto-allows registered MCP tools. That ownership should stay where it is for now ([`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L93)).

### Policy / permission authority

`ExecutionService` still shapes scoped policy and `LocalToolAdapter` still enforces it through `ToolEnforcer`. Moving worker authority must not imply moving policy authority.

### Prompt and schema generation

`ReActIntegration` and `ToolProvider` still own tool exposure to the model. The worker should execute a chosen tool, not decide which tools exist in the prompt.

### Durable tool ledgers

There is no durable tool dispatch/result ledger yet, and this session should not invent one. That belongs to a later hardening phase after one authoritative local path exists.

### Multi-process dispatch

The worker should not become a process-boundary abstraction yet. The first authoritative step should prove local result handoff before any process or transport redesign is attempted.

## Interaction with Existing Execution/Recovery Invariants

The design must preserve the execution/recovery invariants that were stabilized in Sessions 10-32.

### Scheduler-owned run identity

`runId` remains created and owned by the scheduler path. Tool handoff must consume that identity, never mint a replacement execution identity.

### Direct-mode stability

The recommended model keeps tool execution awaited in-process. That means the user-visible behavior of direct execution stays stable even if the call site changes from adapter to worker.

### Existing evented execution semantics

This design does not alter scheduler evented execution semantics. `execution.completed` / `execution.failed` remain the only authoritative scheduler result events for run-level continuation.

### Replay invariants

Manual replay and stale-result suppression today operate at run-level execution continuation, keyed off scheduler-owned run identity and durable execution checkpoints. Tool handoff must not create a second replay authority model inside this session.

### Existing execution continuation ownership

Execution continuation stays exactly where it is today:

- tool-level continuation after a single tool result stays in `ReActIntegration`
- run-level continuation after the whole execution result stays in `ExecutionService` and `SchedulerCore`

This is the core reason the first authoritative `ToolWorker` should still be awaited synchronously.

## What Could Go Wrong If `ToolWorker` Is Made Authoritative Too Early

- `ReActIntegration` could lose ownership of the next-step decision, creating two competing orchestration points for the same tool result.
- Correlating only on `runId` could misapply a result to the wrong tool call because one run can contain many tool calls.
- Event-driven tool completion without a durable claim-once seam could reapply duplicate results or drop them after restart.
- Late worker results could be appended into the wrong LLM transcript state if the loop has already advanced.
- Moving MCP lifecycle into the worker too early could blur responsibility for connection ownership and failure handling.
- Moving permission or policy authority into the worker could split policy shaping from policy enforcement even further.
- Introducing a tool mode switch now could create a second migration axis before the first authoritative path is proven.
- Broad extraction pressure could pull conversation/session concerns into the same change and reopen scope that this refactor has intentionally deferred.

## Recommended Session 37

Implement one single narrow coding step:

- make `LocalToolWorker` the authoritative local call path by having `ReActIntegration` await `LocalToolWorker.dispatch(...)` instead of calling `LocalToolAdapter.execute(...)` directly

Constraints for that session:

- keep the worker local and in-process
- do not add a tool mode switch
- do not add scheduler-facing tool continuation
- do not add durable ledgers or replay behavior
- keep `ReActIntegration` as the continuation owner after the tool result resolves

That is the smallest coding step that validates this design without broadening scope.

## Summary

The first authoritative `ToolWorker` should still be local and in-process, and `ReActIntegration` should await it synchronously.

The key handoff rule is simple:

- authoritative dispatch may move to the worker, but authoritative continuation after a tool result still stays in `ReActIntegration`

The most important correlation invariant is exact `toolRequestId` equality between the dispatched request and the consumed result, with `runId`, `workItemId`, `toolCallId`, and `toolName` retained as integrity context.
