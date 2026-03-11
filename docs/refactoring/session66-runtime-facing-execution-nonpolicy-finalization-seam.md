# Session 66: Runtime-Facing Execution Non-Policy Finalization Seam

## What changed

Session 66 introduces one additional narrow runtime-boundary collaborator for the immediate post-cycle path:

- `ExecutionRunCompletionFinalizer` in `src/runtime/execution-boundary/execution-run-completion-finalizer.ts`
- `LocalExecutionRunCompletionFinalizer` in `src/runtime/execution-boundary/local-execution-run-completion-finalizer.ts`

`ExecutionService` now depends on that seam for the remaining non-policy post-cycle run-finalization pressure that still followed `ExecutionCycleRunner.executeCycle(...)`:

- assembling the `completeRun(...)` payload from the cycle result plus final execution log
- performing the post-completion `updateGoalSpending(...)` follow-up with the same warning-tolerant behavior as before

This keeps `ExecutionService` as the concrete `ExecutionRunner` implementation while reducing one more direct runtime-facing dependency knot.

## Which pressure it reduces

Before this session, `ExecutionService` still owned a small but persistent non-policy completion knot directly after cycle execution:

- mapping `ExecutionCycleResult` into repository `CompleteRunParams`
- copying selected/requested/actual model metadata into the completion payload
- translating artifact IDs and terminal success/failure state into the persisted run payload
- applying goal-spending accounting after run completion with local `console.warn(...)` failure handling

That logic was not a full lifecycle concern, but it still kept `ExecutionService` coupled to concrete completion-payload assembly and goal-spending follow-up details on the runtime-facing path.

Session 66 isolates only that knot. It does not introduce a broader lifecycle framework or a new execution super-abstraction.

## What ExecutionService depends on instead

`ExecutionService` now constructs or receives:

- `ExecutionCycleRunner`
- `ExecutionToolPolicyPreparer`
- `ExecutionResourcePreparer`
- `ExecutionToolPolicyFinalizer`
- `ExecutionRunCompletionFinalizer`
- `ExecutionCycleRuntimeFactory`

On the default local path it wires:

- `LocalExecutionToolPolicyPreparer`
- `LocalExecutionResourcePreparer`
- `LocalExecutionToolPolicyFinalizer`
- `LocalExecutionRunCompletionFinalizer`
- `LocalExecutionCycleRuntimeFactory`

After cycle execution, `ExecutionService` now:

- still asks `ExecutionToolPolicyFinalizer` to decorate the execution log and persist the tool-policy decision
- asks `ExecutionRunCompletionFinalizer` to build the `completeRun(...)` payload
- asks `ExecutionRunCompletionFinalizer` to persist goal spending
- still owns persisted-run reload, retry classification, and returned `ExecutionResult` shaping

## Semantics intentionally unchanged

This session does not change:

- run ownership
- scheduler-owned run identity
- result meaning
- completion/finalization meaning
- goal-spending update meaning
- escalation persistence meaning
- retry/escalation classification
- audit/logging meaning
- approval gating meaning
- execution/recovery semantics
- direct vs evented execution semantics
- `ReActIntegration` continuation ownership
- `ToolWorker` seam
- `ConversationWorker` seam
- gateway behavior
- IPC
- transport ownership
- durable ownership lines

The same completion payload fields are still written, the same goal-spending minute rounding still applies, and goal-spending persistence failures still remain warning-only after run completion.

## Focused validation

Validated in Session 66 with:

- `test/app/lifecycle/execution/execution-service.test.ts`
- `test/app/lifecycle/execution/execution-service-resource-selection.test.ts`
- `test/runtime/execution-boundary/local-execution-run-completion-finalizer.test.ts`
- `test/runtime/execution-boundary/local-execution-tool-policy-finalizer.test.ts`
- `npm run build`

The focused tests cover:

- `ExecutionService` using the new completion-finalizer seam
- preserved run-completion payload shape
- preserved goal-spending rounding and warning-tolerant follow-up behavior
- unchanged execution/resource/tool-policy invariants on adjacent runtime-facing seams

## Next safest RF-033 cleanup step

The next safest RF-033 step is another narrow extraction only if it directly reduces remaining post-cycle non-policy pressure still left in `ExecutionService`, most likely the small persisted-run/result-normalization and retry-classification knot after completion, while keeping run ownership, recovery semantics, worker seams, transport boundaries, and durable ownership lines unchanged.
