# Session 39: Tool Mode Switch Design

## Scope

This session defines the first design for a future tool mode switch.

It is documentation only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery in this session
- broaden scope into conversation worker extraction
- implement evented or multi-process tool dispatch
- redesign MCP lifecycle ownership
- redesign permission or policy ownership
- redesign prompt or tool schema generation

## Current Authoritative Local Tool Path

The current authoritative local path is still single-process and continuation-owned by `ReActIntegration`.

### Where `ToolRequest` is created

`ReActIntegration.executeToolCall(...)` builds the `ToolRequest` directly through `buildToolRequest(...)` in [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1148) and [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1194).

That request is the execution identity for one concrete tool dispatch attempt and currently carries:

- `toolRequestId`
- `runId`
- `workItemId`
- `goalId`
- `toolCallId`
- `toolName`
- tool arguments plus local execution context

The boundary types are defined in [`src/runtime/tool-boundary/types.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/types.ts#L7).

### Where worker dispatch happens

Once the request exists, `ReActIntegration.executeToolCall(...)` calls `await toolWorker.dispatch(request)` in [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1160).

`ExecutionService` wires the authoritative local path by constructing:

- `ToolEnforcer`
- `LocalToolAdapter` as the current `ToolPort`
- `LocalToolWorker` over that `ToolPort`
- `ReActIntegration` with that worker injected

See [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L44).

Inside the worker, `dispatch(...)`:

- suppresses duplicate in-process dispatches by `toolRequestId`
- validates request identity
- executes through `toolPort.execute(...)`
- normalizes mismatched or invalid results into failed `ToolResult`s
- publishes local runtime visibility events

See [`src/runtime/workers/tool-worker.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/workers/tool-worker.ts#L79).

### Where `ToolResult` is awaited

The result is still awaited synchronously in `ReActIntegration.executeToolCall(...)` at the exact callsite that dispatched the tool request: [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1161).

This matters because there is still one active ReAct loop waiting for one tool completion before it can continue model interaction.

### Who owns post-result continuation

`ReActIntegration` still owns post-result continuation.

After awaiting the worker result, it:

- asserts result correlation
- formats the `ToolResult` into model-facing tool output
- appends that output into the execution loop and continues the same synchronous control flow

See [`src/autonomy/react-integration.ts`](/Users/nickma/Develop/nick-ma/pony/src/autonomy/react-integration.ts#L1161) and [`src/runtime/tool-boundary/types.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/types.ts#L35).

The worker does not own continuation, scheduling, or recovery decisions.

### What the local adapter still owns

`LocalToolAdapter` remains the concrete local execution path under the worker. It still owns:

- argument normalization
- policy enforcement through `ToolEnforcer`
- tool lookup through the registry
- actual tool execution, including MCP-backed tools already registered locally
- normalization of execution failures into the `ToolResult` envelope

See [`src/runtime/tool-boundary/local-tool-adapter.ts`](/Users/nickma/Develop/nick-ma/pony/src/runtime/tool-boundary/local-tool-adapter.ts#L4).

## Current Invariants

The following invariants exist today and should be treated as authoritative until a later session intentionally changes them:

- `ReActIntegration` creates the request identity for the current ReAct loop.
- `LocalToolWorker` is the authoritative local dispatch seam, not the owner of the execution loop.
- one dispatched request is expected to produce exactly one terminal `ToolResult` for the waiting continuation
- the waiting continuation is still a direct `await`, not an event subscription or scheduler callback
- `toolRequestId` is the primary dispatch/result correlation key
- `runId` and `workItemId` remain continuity anchors across the tool boundary
- `toolCallId` and `toolName` remain transcript and semantic integrity anchors
- duplicate dispatch suppression is in-process only and keyed by `toolRequestId`
- invalid request identity and mismatched result identity are normalized into failed `ToolResult`s rather than escaping as a new control-flow path
- the current path has no durable tool ledger, no restart-safe dedupe, and no cross-process result claim

## What A Future Tool Mode Switch Should Mean

The first safe meaning of a future tool mode switch is narrow:

It should choose which authoritative dispatch path is used for a tool request, while preserving the current `ToolRequest` / `ToolResult` contract and preserving continuation ownership inside `ReActIntegration`.

It should not initially mean:

- a new recovery model
- scheduler-owned tool continuation
- daemon-owned tool completion routing
- durable replay or reconciliation semantics
- multi-process worker orchestration

In other words, a tool mode switch is a dispatch-selection concern first, not a continuation redesign.

## Candidate Modes Worth Recognizing

The actual architecture suggests at most three conceptual modes worth discussing now.

### 1. `direct/local-worker` (current)

This is the current behavior in practice.

- `ReActIntegration` builds the request
- `ReActIntegration` directly awaits `LocalToolWorker.dispatch(...)`
- `LocalToolWorker` remains in-process and authoritative for local dispatch normalization
- `LocalToolAdapter` remains the underlying tool executor

This is the only mode that exists today.

### 2. `worker-mediated-local`

This is a plausible future intermediate mode, but only if it still resolves back to one awaited `Promise<ToolResult>` in the same process and call chain.

Examples could include:

- selecting a different local worker implementation behind the same interface
- introducing a small dispatch coordinator that still synchronously resolves the same request/result boundary

This mode is only worth introducing if it buys a real seam for later worker activation without moving continuation ownership out of `ReActIntegration`.

### 3. `evented`

A future evented tool path may exist later, but it does not exist safely yet.

If it appears later, it should mean that dispatch and completion are no longer resolved by the same immediate local call path. Even then, the first safe cut should still preserve a single awaited `ToolResult` handoff back into the ReAct loop, likely by constraining the evented machinery behind a local promise bridge rather than moving continuation into the scheduler or event bus consumers.

This is the critical anti-overdesign point:

The codebase is not ready for a true independently-owned evented tool continuation path. Sessions 33-38 created a good dispatch boundary and local integrity checks, but not the durable claims, ledgering, replay policy, or ownership convergence that would make fully decoupled evented tool execution safe.

## Should A Formal `toolExecutionMode` Setting Exist?

Not yet as a runtime setting.

### Recommendation

Do not add a formal user-facing or config-backed `toolExecutionMode` setting in the first implementation cut.

### Why not yet

The architecture does not yet have two safe, materially different authoritative modes to switch between. Today there is one real authoritative mode: direct synchronous awaiting of `LocalToolWorker.dispatch(...)`.

Adding a formal setting now would create false architectural weight:

- it would imply supported semantics that do not exist yet
- it would push configuration and lifecycle questions ahead of the actual handoff design
- it would invite premature branching in execution and recovery logic
- it would blur ownership before durable result semantics exist

### When it would become justified

A formal `toolExecutionMode` becomes justified only when there are at least two safe authoritative implementations with the same continuation contract and clearly bounded ownership.

That means:

- both modes can return exactly one authoritative `ToolResult`
- both modes preserve `runId` / `workItemId` / `toolRequestId` continuity
- both modes keep post-result continuation inside `ReActIntegration` for the first safe cut
- switching modes does not move MCP, policy, permissions, or prompt/schema ownership

### If it later exists, where should it live?

When justified, it should live near the execution-service composition root, not inside `ReActIntegration`, `LocalToolWorker`, or the gateway.

The most natural owner is the execution lifecycle composition layer that currently wires `ToolEnforcer`, `ToolPort`, `LocalToolWorker`, and `ReActIntegration` together in [`src/app/lifecycle/execution/execution-service.ts`](/Users/nickma/Develop/nick-ma/pony/src/app/lifecycle/execution/execution-service.ts#L44).

That keeps mode selection as dependency wiring, not loop logic.

## Continuation Ownership And The First Safe Cut

This is the central design question.

If a future worker-driven path becomes less direct, `ReActIntegration` must still safely receive exactly one `ToolResult` for the request it dispatched.

### What must remain synchronous in the first safe cut

The following must remain synchronous from the ReAct loop’s point of view:

- request construction
- request dispatch initiation
- ownership of the waiting continuation
- final receipt of one normalized `ToolResult`
- result formatting and loop continuation

The internal dispatch path may become less direct later, but the caller contract should still behave like:

`const result = await dispatchTool(request)`

That is the safest compatibility boundary.

### What should not be decoupled yet

Do not decouple these in the first tool mode switch implementation:

- `ReActIntegration` from direct ownership of the waiting continuation
- `ToolResult` delivery from the dispatch callsite into a separate scheduler-owned callback path
- result application into a background subscriber or event-bus consumer
- completion authority into a second owner that could race with the current ReAct loop

If any of those move too early, the likely failure mode is not just implementation complexity. It is broken execution continuity: duplicate tool messages, lost tool messages, split ownership over retries, or a hung ReAct loop waiting for a result that was consumed elsewhere.

## Minimum Invariant Set For Any Future Tool Mode Switch

Any future mode switch must preserve at least this invariant set.

### `toolRequestId` correlation

- every dispatched tool request must have one authoritative `toolRequestId`
- the consumed result must correlate to that same `toolRequestId`
- any mismatch must be normalized into a failed result or rejected before continuation resumes

### `runId` / `workItemId` continuity

- the tool boundary must preserve `runId` continuity to the active execution run
- the tool boundary must preserve `workItemId` continuity to the owning work item
- these identifiers must remain available for integrity checks, visibility, and any future durable claim model

### Single-result expectation per dispatched request

- one dispatched request implies one terminal authoritative result for the waiting ReAct continuation
- success, failure, and invalid outcomes all still count as terminal results
- no second owner may apply a second completion for the same request

### Duplicate result suppression expectations

- duplicate dispatches or duplicate completions for the same `toolRequestId` must not produce multiple loop continuations
- in-process suppression is sufficient for the current path but not for a future evented path
- any future non-local mode will need a stronger result-claim rule before it is trustworthy

### Invalid or mismatched result handling

- malformed or mismatched tool results must not escape as an untyped side channel
- they must remain representable as a single normalized failed `ToolResult` or another equivalently strict envelope
- the continuation must always see one safe terminal shape

### Preservation of execution-loop ownership inside `ReActIntegration`

- the execution loop remains owned by `ReActIntegration`
- tool dispatch workers may execute tools, validate results, and expose visibility
- they must not independently decide how the ReAct loop continues after the result is produced

This last invariant is the most important architectural guardrail for the first mode-switch cut.

## What Should Not Be Done In The First Tool Mode Switch Implementation

The first implementation should stay much narrower than a full tool execution redesign.

It should not:

- move MCP lifecycle ownership out of the current execution/tooling composition path
- move permission or policy authority away from the current `ToolEnforcer` path
- introduce a durable tool request/result ledger before the local handoff model is settled
- introduce multi-process tool workers
- move continuation ownership into the scheduler, runtime event bus, or a daemon-side subscriber
- redefine direct versus evented execution semantics at the run or scheduler level
- redesign recovery or replay semantics for tool execution
- broaden into conversation worker extraction
- redesign prompt or tool schema generation

## What Could Go Wrong If Tool Mode Switch Is Introduced Too Early

Several concrete failure modes are likely if the mode switch appears before the ownership model is ready.

- The ReAct loop could wait forever because a result was emitted somewhere else but never bridged back to the awaiting callsite.
- Duplicate completions could produce duplicate tool transcript entries if both a worker path and a subscriber path believe they own result application.
- Result correlation could weaken if a mode switch routes by implementation but does not preserve `toolRequestId`, `runId`, `workItemId`, and `toolCallId` integrity checks.
- Policy and permission ownership could become ambiguous if a new worker path tries to re-own enforcement instead of staying behind the current boundary.
- MCP behavior could drift if lifecycle ownership moves with dispatch mode instead of remaining a separate concern.
- A config-backed mode switch could become effectively permanent API surface before the alternate mode is actually safe.
- Later recovery work could get harder because premature mode branching often creates two partially-correct semantics instead of one correct seam.

## Recommended Session 40

Recommend a single design session:

### Session 40: Promise-bridged authoritative handoff design for a future non-local tool path

Rationale:

Before any formal mode switch is implemented, the codebase needs one narrower design that explains how a less-direct worker path would still resolve back into exactly one awaited `ToolResult` without moving continuation ownership out of `ReActIntegration`.

That is the missing piece between today’s authoritative local seam and any future mode switch that would be more than cosmetic wiring.

## Conclusion

The system does not need a formal `toolExecutionMode` setting yet.

What it needs first is a stricter handoff design that preserves one awaited result, one continuation owner, and one correlation identity set across any future less-direct dispatch path.
