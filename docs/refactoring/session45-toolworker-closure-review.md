# Session 45: ToolWorker Closure Review

## Scope

This session is documentation-only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery
- broaden into conversation worker extraction implementation
- implement evented or multi-process tool dispatch
- redesign MCP lifecycle ownership
- redesign permission or policy ownership
- redesign prompt or tool schema generation
- add durable tool ledgers

The goal is to close-review the ToolWorker line after Sessions 33-44 and judge whether it is stable enough to stop being the primary refactor focus.

## What Is Now Implemented On The ToolWorker Line

The ToolWorker line now has a real local authoritative dispatch seam.

Implemented state:

- `ToolPort` / `ToolRequest` / `ToolResult` boundary exists and is used for local tool dispatch.
- `ReActIntegration` no longer executes concrete tools directly through `ToolEnforcer` or the registry.
- `LocalToolWorker` is now the authoritative local dispatch seam awaited by `ReActIntegration`.
- `LocalToolAdapter` still performs the underlying local and MCP-backed execution through the existing tool stack.
- request identity validation exists at the worker boundary.
- result correlation validation exists across `toolRequestId`, `runId`, `workItemId`, `toolCallId`, `toolName`, and `goalId` when present.
- invalid requests, mismatched results, missing-error failed results, and worker exceptions normalize into one failed `ToolResult`.
- a local in-process `ToolRequestRegistry` now owns one caller-facing promise per `toolRequestId`.
- exactly one terminal `ToolResult` per `toolRequestId` is enforced for continuation purposes.
- duplicate dispatch reuse and duplicate terminal suppression exist in-process.
- local timeout normalization now resolves hanging requests into one failed `ToolResult` with `TOOL_EXECUTION_TIMEOUT`.
- late completions after timeout are ignored for continuation purposes and recorded as diagnostics.
- local inspection and summary surfaces exist in both `LocalToolWorker.inspect()` and `ToolRequestRegistry.inspect()`.
- local runtime `tool.*` events now carry inspection visibility tied to the authoritative local path.

## What Remains Intentionally Conservative

The ToolWorker line was kept narrow on purpose.

Still intentionally conservative:

- `ReActIntegration` still owns all post-result continuation.
- `LocalToolWorker` is authoritative only for local dispatch and local terminal normalization.
- `LocalToolAdapter` still owns actual execution against `ToolEnforcer`, `ToolRegistry`, and MCP-backed tool adapters.
- timeout ownership is local to `LocalToolWorker`, not scheduler-owned and not cross-process.
- duplicate suppression and terminal-result protection are in-process only.
- inspection visibility is local, in-memory, and read-only.
- there is no evented tool dispatch, no daemon-owned tool completion path, and no multi-process tool worker.
- there is no durable request/result ledger, restart-safe dedupe, or replay/reconciliation model for tools.
- MCP lifecycle ownership, permission/policy ownership, and prompt/schema generation ownership did not move.

## What Is Stable Enough For Current Use

The current local ToolWorker line is stable enough for its intended current role:

- authoritative local in-process dispatch
- one awaited `ToolResult` back into the current ReAct loop
- safe local request/result correlation
- safe local single-terminal completion behavior
- bounded local handling for hangs, invalid completions, and late completions
- local developer-facing inspection of terminal path and request lifecycle

For current local use, this is no longer just a skeleton. It is a real, bounded seam with explicit invariants and focused tests around the failure modes introduced by the registry-backed handoff.

## What Is Still Not Ready For Broader Or Default Non-Local Use

The ToolWorker line is not ready to be treated as a broader worker architecture yet.

Not ready:

- evented tool dispatch
- multi-process or daemon-owned tool dispatch/result ownership
- cross-process late-result handling
- restart-safe idempotency or duplicate suppression
- durable tool request/result ledgers
- operator-facing durable inspection or recovery workflows
- scheduler-owned tool continuation
- MCP lifecycle migration
- permission/policy ownership migration
- prompt/tool schema generation migration

The current line should therefore be judged as local-authoritative-ready, not broader-worker-ready.

## Assessment

### A. Current Authoritative Local ToolWorker Path

Current strengths:

- The authoritative local seam is clear: `ReActIntegration` creates the request, `LocalToolWorker` dispatches it, and `ReActIntegration` resumes after one awaited `ToolResult`.
- The boundary now protects request integrity and result correlation before continuation consumes the result.
- Underlying execution semantics did not change because `LocalToolAdapter` still executes the concrete tool path.
- Local and MCP-backed tools still share one execution boundary.

Remaining risks:

- The path is still single-process only.
- Continuation safety depends on in-memory state, not durable claims.
- There is no cancellation model, background ownership model, or restart-safe protection.
- Broader readiness could be overstated if local stability is mistaken for non-local readiness.

Current recommended usage posture:

- Treat this path as the authoritative local default for current direct in-process execution.
- Do not treat it as a validated foundation for evented or multi-process tool dispatch yet.

Further immediate work required:

- No immediate blocking work is required to keep using the current local path.

### B. Request-Registry-Based Handoff

Current strengths:

- Registration now happens before execution can complete.
- One registry-owned promise exists per `toolRequestId`.
- The registry gives the local path a clear single-terminal resolution model.
- Duplicate registration reuse and duplicate terminal suppression are explicit.

Remaining risks:

- The registry is local-only and not restart-safe.
- It records only a narrow `pending` / `resolved` lifecycle.
- It is not a durable claim store and should not be treated like one.

Current recommended usage posture:

- Keep using the request registry as the narrow local promise bridge under `LocalToolWorker`.
- Keep it local and primitive. Do not promote it into a broader execution ledger or lifecycle owner.

Further immediate work required:

- No immediate work is required for the current local scope.

### C. Timeout / Missing-Result Handling

Current strengths:

- Hangs no longer leave the ReAct loop waiting indefinitely.
- Timeout ownership lives in one place: `LocalToolWorker`.
- Timeout normalizes into one failed `ToolResult` with preserved request identity.
- First terminal completion wins, and late completions do not trigger a second continuation.

Remaining risks:

- Timeout is still a local await-safety mechanism, not a broader recovery model.
- There is no cancellation or cleanup contract for underlying long-running tool execution.
- Timeout behavior is not restart-safe or cross-process visible.

Current recommended usage posture:

- Treat timeout as the correct bounded safety mechanism for the current local path.
- Do not expand it into scheduler-owned recovery, tool replay, or cross-process timeout handling in the next step.

Further immediate work required:

- No must-fix remains for the current local boundary.

### D. Local Diagnostics / Inspection Visibility

Current strengths:

- `LocalToolWorker.inspect()` now exposes terminal path, timeout, late-completion, invalid-completion, and duplicate-suppression visibility.
- `ToolRequestRegistry.inspect()` exposes terminal metadata for the same local request lifecycle.
- The current visibility is enough to diagnose the local authoritative path and confirm which terminal path won.

Remaining risks:

- Inspection is in-memory only.
- There is no durable history, operator CLI surface, or cross-process visibility.
- These diagnostics support local closure confidence, not production-grade worker operations.

Current recommended usage posture:

- Treat the current inspection surface as sufficient for local development and refactor validation.
- Do not mistake it for a finished operator-facing observability surface.

Further immediate work required:

- No immediate work is required before moving primary focus away from ToolWorker.

## Readiness Judgment

### Is the ToolWorker line now stable enough to pause as the primary focus?

Yes.

The ToolWorker line is now stable enough to pause as the primary refactor focus because the intended local-authoritative seam has been established, hardened, and reviewed. The main local continuation-safety gaps exposed by the registry-backed handoff have been closed:

- request/result integrity checks exist
- one registry-owned promise exists per request
- exactly one terminal result wins
- timeout now prevents indefinite local wait
- late completions are diagnostic-only
- inspection now makes the winning terminal path visible

That is enough closure for the current local scope.

### What are the remaining short-tail tasks, if any?

1. Keep a small focused regression watch on the local ToolWorker tests as later refactors touch `ReActIntegration`, `ExecutionService`, or tool registration.
2. Add broader ToolWorker hardening only if and when a non-local dispatch path is actually introduced.
3. Revisit durable inspection, restart-safe idempotency, and operator-facing tooling only when a future tool topology requires them.

### Which of those are must-fix before moving on?

None are must-fix before moving on to the next module.

### Which can safely be deferred?

These can safely be deferred:

- durable tool request/result ledgers
- cross-process inspection
- restart-safe dedupe
- evented tool dispatch/result ownership
- timeout/cancellation redesign beyond the current local path
- MCP lifecycle ownership migration
- permission/policy ownership migration

## Do Not Lose These Invariants

Future refactors should preserve these established invariants unless a later session explicitly and safely replaces them:

- `ReActIntegration` remains the continuation owner after a `ToolResult` exists.
- `LocalToolWorker` is the authoritative local dispatch seam.
- `LocalToolAdapter` remains the underlying execution path unless a later session intentionally replaces that ownership.
- `toolRequestId` is the primary request/result correlation key.
- `runId`, `workItemId`, `toolCallId`, `toolName`, and `goalId` when present remain integrity anchors across the boundary.
- one dispatched request must yield exactly one terminal `ToolResult` for continuation purposes.
- the first terminal completion wins for a given `toolRequestId`.
- duplicate dispatch with the same identity reuses the same caller-facing promise.
- timeout normalizes into one failed `ToolResult` rather than leaving the caller waiting indefinitely.
- late completions do not produce a second continuation.
- invalid request identity and invalid or mismatched completions normalize into one failed `ToolResult`.
- the registry remains a narrow local promise-and-terminal-resolution primitive, not a broader execution ledger.
- tool result handling continues to preserve the existing awaited caller contract: dispatch one request, await one result, continue once.

## Recommended Handoff To Next Module

### Should Session 46 begin ConversationWorker extraction design?

Yes.

### Why now?

The ToolWorker line has reached a good pause point:

- the intended local authoritative seam is in place
- the main local handoff risks have been bounded
- no must-fix ToolWorker blocker remains for current local use
- broader remaining ToolWorker work is mostly topology-dependent future hardening, not a prerequisite for the next boundary extraction

That makes ConversationWorker the next clean architectural seam, consistent with the master task sequence after the ToolWorker line.

### If no, what single ToolWorker task would still block that transition?

Not applicable. There is no single remaining ToolWorker task that should block the transition.

## Deferred ToolWorker Backlog

1. Add durable request/result history only if a future non-local tool path needs restart-safe visibility.
2. Revisit restart-safe duplicate suppression only if tool completion can outlive the current process.
3. Add operator-facing inspection or recovery surfaces only after a broader tool topology exists.
4. Revisit timeout and cancellation semantics only when there is a real non-local or long-lived worker lifecycle to own them.

## Recommended Session 46

Session 46 should begin `ConversationWorker` extraction design.

Rationale:

- ToolWorker is now stable enough to stop being the main focus.
- The next missing worker-facing seam is still conversation/session decoupling.
- A design-only session is the right next move before any conversation-boundary implementation work.

## What Should Not Be Done Next

The following directions are still tempting but premature:

- evented tool dispatch
- multi-process tool worker activation
- durable tool ledgers
- MCP lifecycle migration
- permission/policy ownership migration
- prompt/tool schema generation migration
- broader execution/recovery redesign disguised as tool hardening

Those directions are not blocked by a missing local ToolWorker invariant anymore. They are blocked by scope and by the absence of a justified non-local tool topology.
