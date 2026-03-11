# Session 67: Runtime-Facing Execution Result Normalization Seam

## What changed

Session 67 introduces one additional narrow runtime-boundary collaborator for the immediate post-completion path:

- `ExecutionRunResultNormalizer` in `src/runtime/execution-boundary/execution-run-result-normalizer.ts`
- `LocalExecutionRunResultNormalizer` in `src/runtime/execution-boundary/local-execution-run-result-normalizer.ts`

`ExecutionService` now depends on that seam for the remaining small post-completion normalization/classification pressure that still followed run completion:

- reloading the persisted run with `getRun(run.id) ?? run`
- classifying whether a failed run should retry or suppress retry because escalation conditions are already met
- producing the returned `errorSignature`

This leaves `ExecutionService` as the concrete `ExecutionRunner` implementation while reducing one more narrow dependency knot in the runtime-facing tail.

## Which pressure it reduces

Before this session, `ExecutionService` still retained a small local knot after completion and goal-spending follow-up:

- reading back the persisted run record after `completeRun(...)`
- applying the existing retry-suppression classifier using `retry_count`, `max_retries`, and `getRepeatedErrorSignatures(...)`
- normalizing the returned error into the same hashed `errorSignature`
- shaping the final returned `ExecutionResult`

That was not run ownership or recovery control, but it still left `ExecutionService` directly responsible for the last persisted-run normalization and retry-classification step on the runtime-facing path.

Session 67 moves only that concern behind `ExecutionRunResultNormalizer`. It does not introduce a broader retry framework, a new persistence abstraction, or a larger lifecycle rewrite.

## What ExecutionService depends on instead

`ExecutionService` now constructs or receives:

- `ExecutionCycleRunner`
- `ExecutionToolPolicyPreparer`
- `ExecutionResourcePreparer`
- `ExecutionToolPolicyFinalizer`
- `ExecutionRunCompletionFinalizer`
- `ExecutionRunResultNormalizer`
- `ExecutionCycleRuntimeFactory`

On the default local path it wires:

- `LocalExecutionToolPolicyPreparer`
- `LocalExecutionResourcePreparer`
- `LocalExecutionToolPolicyFinalizer`
- `LocalExecutionRunCompletionFinalizer`
- `LocalExecutionRunResultNormalizer`
- `LocalExecutionCycleRuntimeFactory`

After run completion, `ExecutionService` now:

- still owns run creation, cycle invocation, completion ordering, and policy-finalization ordering
- still completes the run before normalization/classification
- asks `ExecutionRunResultNormalizer` to reload the persisted run, classify retryability, and build the returned `ExecutionResult`

## Semantics intentionally unchanged

This session does not change:

- run ownership
- scheduler-owned run identity
- result meaning
- persisted-run reload meaning
- retry/escalation classification meaning
- terminal outcome meaning
- completion/finalization meaning
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

The same persisted-run fallback still applies, the same retry suppression still occurs when retries are exhausted or repeated error signatures already cross the configured threshold, and the same error-signature normalization logic still runs.

## Focused validation

Validated in Session 67 with:

- `test/app/lifecycle/execution/execution-service.test.ts`
- `test/app/lifecycle/execution/execution-service-approval.test.ts`
- `test/app/lifecycle/execution/execution-service-resource-selection.test.ts`
- `test/runtime/execution-boundary/local-execution-run-result-normalizer.test.ts`
- `test/runtime/execution-boundary/local-execution-run-completion-finalizer.test.ts`
- `npm run build`

The focused tests cover:

- `ExecutionService` using the new result-normalizer seam
- preserved persisted-run reload behavior
- preserved retry classification when failures remain retryable
- preserved retry suppression when repeated failures should escalate
- unchanged approval/resource short-circuit invariants on adjacent execution paths

## Next safest RF-033 cleanup step

The next safest RF-033 step is a reassessment rather than a broader extraction: after Sessions 60-67, the remaining `ExecutionService` work on the direct runtime-facing path is mostly orchestration ownership rather than an obvious isolated import-pressure knot, so any further cleanup should start with a narrow dependency review instead of assuming another extraction is justified.
