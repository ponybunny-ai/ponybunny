# Session 65: Runtime-Facing Execution Finalization Seam

## What changed

Session 65 introduces one new narrow runtime-boundary collaborator for the immediate post-cycle path:

- `ExecutionToolPolicyFinalizer` in `src/runtime/execution-boundary/execution-tool-policy-finalizer.ts`
- `LocalExecutionToolPolicyFinalizer` in `src/runtime/execution-boundary/local-execution-tool-policy-finalizer.ts`

`ExecutionService` now depends on that seam for the specific post-cycle tool-policy finalization pressure that still remained after Session 64:

- decorating the final run `execution_log` with policy-audit and route-context metadata
- persisting the tool-policy decision record after run completion or pre-completion cycle failure

`ExecutionService` still remains the concrete implementation behind `ExecutionRunner`, and it still owns:

- route-context normalization
- approval gating
- resource-selection preparation
- run creation and completion
- cycle invocation
- goal spending updates
- retry/escalation classification

## Pressure reduced

Before this session, `ExecutionService` still retained a small but durable post-cycle knot directly on the runtime-facing execution path. After `ExecutionCycleRunner.executeCycle()` returned, `ExecutionService` still:

- assembled the final audit-prefixed execution log
- translated the tool-policy audit into a persisted `Decision`
- caught decision-persistence failures locally

That did not amount to run-lifecycle ownership, but it still kept `ExecutionService` coupled to a concrete post-cycle policy-finalization and decision-persistence concern.

Session 65 moves only that concern behind `ExecutionToolPolicyFinalizer`. This is intentionally narrower than a broader run-finalization abstraction.

## What ExecutionService depends on instead

`ExecutionService` now constructs or receives:

- `ExecutionToolPolicyPreparer`
- `ExecutionResourcePreparer`
- `ExecutionToolPolicyFinalizer`
- `ExecutionCycleRuntimeFactory`
- `ExecutionCycleRunner`

In the default local path, `ExecutionService` wires:

- `LocalExecutionToolPolicyPreparer`
- `LocalExecutionResourcePreparer`
- `LocalExecutionToolPolicyFinalizer`
- `LocalExecutionCycleRuntimeFactory`

The service now calls the finalizer to:

- build the final execution log string for both successful cycle completion and pre-completion cycle failure
- persist the tool-policy decision record using the same repository semantics as before

## Semantics intentionally unchanged

This session does not change:

- run ownership
- scheduler-owned run identity
- result meaning
- completion/finalization meaning
- escalation persistence meaning
- retry or escalation classification
- approval gating meaning
- audit/logging meaning
- goal spending update behavior
- direct vs evented execution semantics
- recovery semantics
- `ReActIntegration` continuation ownership
- `ToolWorker` seam
- `ConversationWorker` seam
- gateway behavior
- IPC
- transport ownership
- durable ownership lines

The same policy audit metadata is still attached to the work item, the same execution-log prefixes are emitted, and the same `tool_policy_resolution` decision is still persisted with the same metadata shape.

## Focused validation

Validated in Session 65 with:

- `test/app/lifecycle/execution/execution-service.test.ts`
- `test/app/lifecycle/execution/execution-service-resource-selection.test.ts`
- `test/runtime/execution-boundary/local-execution-tool-policy-finalizer.test.ts`
- `test/runtime/execution-boundary/local-execution-resource-preparer.test.ts`
- `test/runtime/execution-boundary/local-execution-adapter.test.ts`
- `npm run build`

The focused tests cover:

- `ExecutionService` using the new post-cycle finalizer seam
- preserved policy-audit log decoration and decision persistence behavior
- preserved resource-selection and execution-boundary behavior
- preserved `ExecutionService` completion behavior when post-completion goal spending update fails

## Next safest RF-033 step

The next safest cleanup step is another small extraction around the remaining non-policy post-cycle run-finalization pressure still retained inside `ExecutionService`, most likely the narrow run-completion/result-normalization path around `completeRun` payload assembly and goal-spending follow-up, while still keeping run ownership, recovery semantics, worker seams, and transport boundaries unchanged.
