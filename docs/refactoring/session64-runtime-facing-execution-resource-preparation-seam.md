# Session 64: Runtime-Facing Execution Resource Preparation Seam

## What changed

Session 64 introduces a new narrow runtime-boundary collaborator:

- `ExecutionResourcePreparer` in `src/runtime/execution-boundary/execution-resource-preparer.ts`
- `LocalExecutionResourcePreparer` in `src/runtime/execution-boundary/local-execution-resource-preparer.ts`

`ExecutionService` now depends on that seam for the remaining per-work-item resource-selection and skill pre-search preparation that still ran inline before run creation and cycle entry.

The extracted collaborator now owns the same local preparation flow that `ExecutionService` previously performed directly:

- policy-snapshot driven skill/MCP candidate narrowing
- selected skill / selected MCP tool derivation
- candidate list capture on `workItem.context`
- MCP allowlist narrowing on `workItem.context.tool_allowlist`
- ambiguity blocking when candidate sets remain too broad
- external MCP discovery fallback when MCP policy requires it and no local candidate matches
- skill pre-search suggestion preparation and optional external skill discovery

`ExecutionService` remains the concrete implementation behind `ExecutionRunner`. It still owns:

- route-context normalization
- approval gating
- run creation and completion
- escalation persistence
- retry/escalation classification
- execution-cycle invocation
- tool-policy audit persistence

## Pressure reduced

Before this session, `ExecutionService` still retained a mixed preparation knot that sat directly on the runtime-facing path between approval gating and run creation. That knot combined:

- resource-policy interpretation
- candidate ranking and ambiguity checks
- work-item context mutation for selected resources
- pre-search preparation for skills/MCP fallbacks

That logic was not worker ownership, recovery ownership, or transport ownership, but it still kept `ExecutionService` carrying local preparation policy that feeds the runtime-facing execution path.

Session 64 moves that narrow knot behind `ExecutionResourcePreparer`, reducing the amount of per-work-item preparation logic retained inside `ExecutionService` without widening the boundary into a broader planner/search abstraction.

## New dependency direction

`ExecutionService` now constructs or receives:

- `ExecutionToolPolicyPreparer`
- `ExecutionResourcePreparer`
- `ExecutionCycleRuntimeFactory`
- `ExecutionCycleRunner`

In the default local composition path, `ExecutionService` wires:

- `LocalExecutionToolPolicyPreparer`
- `LocalExecutionResourcePreparer`
- `LocalExecutionCycleRuntimeFactory`

This keeps the composition explicit and local while continuing the same RF-033 dependency-direction cleanup used in Sessions 60-63.

## Semantics intentionally unchanged

This session does not change:

- gateway behavior
- IPC
- direct vs evented execution semantics
- execution/recovery ownership or scheduler-owned run identity
- `ReActIntegration` continuation ownership
- `ToolWorker` seam or `ConversationWorker` seam
- tool-policy semantics introduced earlier
- skill/MCP narrowing meaning
- search / pre-search meaning
- route/resource selection meaning
- approval gating meaning
- retry/escalation classification
- durable ownership lines

The collaborator still mutates `workItem.context` in the same preparation path because existing execution behavior relies on those selected/candidate values being present before run creation and cycle entry.

## Focused validation

Validated in Session 64 with:

- `test/app/lifecycle/execution/execution-service.test.ts`
- `test/app/lifecycle/execution/execution-service-resource-selection.test.ts`
- `test/runtime/execution-boundary/local-execution-resource-preparer.test.ts`
- `npm run build`

The focused tests cover:

- `ExecutionService` using the new seam
- preserved blocked-resource escalation behavior
- preserved selected skill / selected MCP narrowing behavior
- preserved skill pre-search suggestion behavior through the extracted collaborator

## Next safest RF-033 step

The next safest cleanup step is another small extraction around the remaining execution-local preparation and persistence pressure that still couples `ExecutionService` to durable decision/logging concerns after cycle execution, most likely by isolating one narrow post-cycle run-finalization or decision-persistence helper without changing run ownership, recovery semantics, worker seams, or transport boundaries.
