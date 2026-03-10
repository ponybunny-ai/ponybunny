# Session 68: Execution/Runtime Cleanup Closure Review

## Scope

This session is a documentation-only closure review for the `RF-033` execution/runtime cleanup line after Sessions 60-67.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution/recovery
- redesign `ToolWorker`
- redesign `ConversationWorker`
- implement new runtime-core cleanup code
- perform broad module moves or renames

## Review basis

This review is based on:

- the Session 60-67 refactor documents
- current runtime-boundary code in `src/runtime/execution-boundary/`
- current `ExecutionService` composition/orchestration code in `src/app/lifecycle/execution/execution-service.ts`

## Closure judgment

Yes: the `RF-033` execution/runtime cleanup line is now stable enough to pause as the primary architectural cleanup focus.

Why:

- the runtime-facing scheduler seam now depends on a runtime-owned `ExecutionRunner` boundary instead of app/lifecycle execution contracts
- the obvious execution-cycle composition knot has been broken into explicit collaborators
- the remaining pressure inside `ExecutionService` is mostly sequencing and ownership of the existing execution lifecycle, not one more clean isolated import-pressure knot
- further changes on this line now risk broadening into execution-lifecycle redesign, worker-seam redesign, or runtime-tooling/global cleanup unless a fresh narrow review is done first

This means `RF-033` should no longer be treated as the main active cleanup track after this session.

## What is now implemented on the execution/runtime cleanup line

Sessions 60-67 established the following execution/runtime-boundary structure:

- `LocalExecutionAdapter` now depends on the runtime-owned `ExecutionRunner` contract in `src/runtime/execution-boundary/execution-runner.ts`
- `ExecutionService` remains the concrete implementation behind `ExecutionRunner`
- `ExecutionCycleRunner` isolates the local execution-cycle handoff that ultimately composes `ReActIntegration`
- `ExecutionCycleRuntimeFactory` owns the default local runtime-tooling and cycle-runner assembly that `ExecutionService` previously constructed directly
- `ExecutionToolPolicyPreparer` owns per-work-item scoped tool-policy setup before cycle execution
- `ExecutionResourcePreparer` owns per-work-item resource narrowing and pre-search preparation before run creation and cycle entry
- `ExecutionToolPolicyFinalizer` owns post-cycle policy-log decoration and decision persistence
- `ExecutionRunCompletionFinalizer` owns `completeRun(...)` payload assembly plus goal-spending follow-up
- `ExecutionRunResultNormalizer` owns persisted-run reload, retryability classification, and returned error-signature shaping

The direct runtime-facing execution path is therefore no longer one large constructor/composition knot hanging directly off `ExecutionService`.

## Composition and dependency-direction problems reduced

The following problems were materially reduced across Sessions 60-67:

- the runtime execution boundary no longer reaches directly into `src/app/lifecycle/stage-interfaces.ts` for its primary scheduler-facing execution contract
- `ExecutionService` no longer directly assembles the full local runtime-tooling plus cycle-runner stack inline
- `ExecutionService` no longer directly owns the main per-work-item policy/resource preparation helpers feeding cycle execution
- `ExecutionService` no longer directly owns the narrow post-cycle policy finalization, run-completion payload assembly, goal-spending follow-up, or result normalization helpers
- the remaining collaborators are explicit, injectable, and testable in isolation, which reduced the import-pressure and constructor-pressure that originally made this line the highest-value `RF-033` target

## What remains intentionally unchanged

The cleanup line intentionally did not change:

- gateway behavior
- IPC
- direct vs evented execution semantics
- scheduler-owned run identity at the outer boundary
- `ExecutionService` as the concrete local execution implementation
- `ExecutionService` internal run creation/completion ownership
- `ReActIntegration` continuation ownership
- `ToolWorker` seam ownership
- `ConversationWorker` seam ownership
- resource/policy/finalization/result-normalization semantics
- execution/recovery behavior
- transport ownership and durable ownership lines

## Area-by-area assessment

### A. Runtime-facing `ExecutionRunner` boundary

**Current strengths**

- `LocalExecutionAdapter` now depends on a runtime-owned contract with only the fields it actually needs
- the primary runtime-to-app contract back-edge identified in Session 59 is removed for the scheduler-facing execution seam
- `ExecutionService` still fits behind the boundary without behavior change or constructor ownership change

**Remaining risks**

- `LocalExecutionAdapter` still bridges a scheduler-owned `runId` onto a path where `ExecutionService` creates and completes its own persisted internal run lifecycle
- the boundary is stable for current scope, but it does not eliminate the long-standing duplicate identity/ownership shape between outer scheduler correlation and inner persisted runs

**Current recommended usage posture**

- treat `ExecutionRunner` as the stable runtime-facing contract for local execution dispatch
- do not widen it to absorb recovery, transport, or worker concerns

**Further immediate cleanup required?**

- No

### B. Cycle assembly decomposition

**Current strengths**

- `ExecutionCycleRunner` and `ExecutionCycleRuntimeFactory` now contain the default local `ReActIntegration` assembly behind explicit seams
- `ExecutionService` no longer directly constructs the local runtime-tooling/context plus cycle runner knot
- legacy-global synchronization is now contained behind `RuntimeToolingContext.syncLegacyGlobals()` rather than spread across the execution path

**Remaining risks**

- the default factory still depends on legacy global synchronization, so this line is contained rather than fully purified
- the cycle path still intentionally composes the same local `ReActIntegration` implementation, so any future change here can easily broaden into runtime-tooling or continuation redesign if done carelessly

**Current recommended usage posture**

- keep cycle assembly behind `ExecutionCycleRuntimeFactory` and `ExecutionCycleRunner`
- only revisit this area as part of a dedicated runtime-tooling/global-cleanup effort, not as another incremental `ExecutionService` peel

**Further immediate cleanup required?**

- No

### C. Per-work-item preparation seams

**Current strengths**

- `ExecutionToolPolicyPreparer` isolates scoped tool-policy setup
- `ExecutionResourcePreparer` isolates resource narrowing, ambiguity blocking, and pre-search preparation
- `ExecutionService` still owns ordering, but not the detailed local policy/resource preparation logic
- these seams are narrow enough to preserve existing context mutation and policy semantics without redesigning resource selection

**Remaining risks**

- the collaborators still intentionally mutate `workItem.context`, so this remains a contained legacy preparation model rather than a new immutable execution-input model
- resource preparation still sits close to search/discovery behavior, so broadening it could accidentally reopen planning/runtime ownership questions

**Current recommended usage posture**

- keep policy preparation and resource preparation as local pre-cycle seams
- treat them as stable collaboration points, not as invitations to redesign planning, search, or approval semantics

**Further immediate cleanup required?**

- No

### D. Post-cycle finalization/normalization seams

**Current strengths**

- `ExecutionToolPolicyFinalizer`, `ExecutionRunCompletionFinalizer`, and `ExecutionRunResultNormalizer` now isolate the main post-cycle and post-completion detail work
- the durable policy decision path, run completion payload shaping, goal-spending follow-up, persisted-run reload, and retryability classification are no longer mixed inline with cycle execution
- the seams preserve current behavior while making the tail of execution easier to reason about and test

**Remaining risks**

- `ExecutionRunResultNormalizer` still returns the app-layer `ExecutionResult` type from `src/app/lifecycle/stage-interfaces.ts`, so one small app-facing type reach-through remains inside the runtime-boundary package
- this is a real residual dependency-direction smell, but it is now narrow and localized rather than the main execution/runtime knot

**Current recommended usage posture**

- treat the current finalization/normalization seams as stable
- if `RF-033` later resumes, start with the narrow result-type reach-through before attempting any broader finalization rewrite

**Further immediate cleanup required?**

- No

### E. Remaining `ExecutionService` orchestration ownership

**Current strengths**

- what remains in `ExecutionService` is now mostly lifecycle sequencing that genuinely belongs to the concrete execution implementation for the current architecture
- it still clearly owns route-context normalization, approval gating, run creation, cycle invocation ordering, escalation persistence, completion ordering, and final normalization handoff
- the service is no longer carrying the same amount of direct composition/detail pressure it held in Session 59

**Remaining risks**

- `ExecutionService` still combines concrete execution orchestration with bootstrap/runtime concerns such as tool registration, MCP initialization, skill loading, runtime-factory wiring, and the internal persisted run lifecycle
- further extraction from here is now more likely to become an execution-lifecycle redesign or ownership rewrite than a clean dependency-direction fix
- the internal run lifecycle duplication noted in `LocalExecutionAdapter` remains intentionally unresolved

**Current recommended usage posture**

- treat `ExecutionService` as the concrete orchestration owner behind `ExecutionRunner`
- only reopen it with a fresh narrowly scoped review and a new explicit problem statement

**Further immediate cleanup required?**

- No

## What is now stable enough to stop treating as the main cleanup focus

The following are now stable enough to stop treating as the main `RF-033` cleanup focus:

- the runtime-facing `ExecutionRunner` boundary itself
- the execution-cycle assembly decomposition behind `ExecutionCycleRunner` and `ExecutionCycleRuntimeFactory`
- the extracted per-work-item policy/resource preparation seams
- the extracted post-cycle finalization and post-completion normalization seams

The remaining work is no longer "there is still one obvious knot to peel next." It is "the remaining body is mostly the concrete orchestration owner for current semantics."

## Remaining short-tail tasks

Short-tail items still worth recording:

1. Narrow the remaining result-type reach-through so `ExecutionRunResultNormalizer` no longer depends on `src/app/lifecycle/stage-interfaces.ts`.
2. Reassess `ExecutionService` bootstrap/runtime concerns separately from per-work-item orchestration only if a new dedicated cleanup line is opened.
3. Revisit legacy global synchronization in `ExecutionCycleRuntimeFactory` only as part of a broader runtime-tooling/global-fallback cleanup effort.

## Which short-tail tasks are must-fix before moving on

None are must-fix before moving on from `RF-033` as the primary focus.

The remaining items are real, but they are now contained and do not justify keeping the execution/runtime cleanup line as the main active thread.

## Which short-tail tasks can safely be deferred

All three short-tail items above can safely be deferred.

The first item is the most plausible future `RF-033` follow-up if this line is reopened, but it is not a blocker for handing off to the next architectural focus.

## Do not lose these invariants

Future refactors should preserve the following implemented invariants from Sessions 60-67:

- `LocalExecutionAdapter` depends on the runtime-owned `ExecutionRunner` boundary, not on app/lifecycle execution contract types
- `ExecutionService` remains the concrete implementation behind `ExecutionRunner`
- `LocalExecutionAdapter` still exposes scheduler-owned `runId` correlation at the outer boundary while `ExecutionService` still owns the current internal persisted run lifecycle
- `ExecutionCycleRuntimeFactory` owns default local runtime-tooling plus `LocalExecutionCycleRunner` assembly
- `LocalExecutionCycleRunner` remains the path that composes `ReActIntegration` for the default local cycle
- `ReActIntegration` continuation ownership remains unchanged
- scheduler-owned execution/recovery semantics remain unchanged
- direct vs evented execution semantics remain unchanged
- `ToolWorker` seam ownership remains unchanged
- `ConversationWorker` seam ownership remains unchanged
- policy/resource preparation semantics remain unchanged, including the current work-item-context mutation model used before cycle entry
- policy-finalization semantics remain unchanged, including policy-audit log decoration and `tool_policy_resolution` decision persistence
- run-completion semantics remain unchanged, including `completeRun(...)` payload meaning and warning-tolerant goal-spending follow-up
- result-normalization semantics remain unchanged, including persisted-run reload fallback, retry suppression rules, and error-signature shaping
- transport ownership, IPC, and durable ownership lines remain unchanged

## Recommended handoff to next architectural focus

Should `RF-033` execution/runtime cleanup remain the main focus after this session?

- No

What should the next architectural focus be?

- Shift to `RF-034` infra-hub reduction, starting with a fresh narrow review of the remaining non-execution dependency hubs and true back-edges instead of continuing to peel `ExecutionService`

Why this handoff is recommended:

- the main execution/runtime knot identified in Session 59 has now been reduced to stable explicit seams
- the remaining execution-service pressure is mostly ownership/orchestration, not an obvious next import-pressure break
- the codebase still has other narrower dependency-direction problems that are better candidates for the next architectural pass than reopening the stabilized execution path

If `RF-033` were kept open anyway, the only reasonable single blocking cleanup would be the narrow `ExecutionRunResultNormalizer` result-type reach-through. That is not large enough to justify keeping `RF-033` as the main focus by itself.

## Deferred RF-033 execution/runtime cleanup backlog

1. Replace the `ExecutionRunResultNormalizer` dependency on app-layer `ExecutionResult` with a runtime-owned result shape or boundary-owned alias.
2. Revisit internal scheduler-run vs persisted-run duplication only under a dedicated execution-ownership review, not under closure cleanup.
3. Revisit runtime-tooling legacy-global synchronization only under a broader post-`RF-033` runtime-tooling cleanup line.

## Recommended Session 69

Session 69 should start `RF-034` with a focused discovery/design review of the next narrow dependency-direction target outside the now-stabilized execution/runtime path, prioritizing the remaining infra-hub and true back-edge candidates over more `ExecutionService` decomposition.

Rationale:

- it preserves the closure achieved on the execution/runtime line
- it avoids turning `RF-033` into an open-ended `ExecutionService` rewrite
- it creates a clean handoff to the next architectural cleanup target before any new implementation work starts

## What should not be done next

The following directions would be tempting but premature after this review:

- broad `ExecutionService` rewrite
- repo-wide layering rewrite
- transport ownership changes
- `ToolWorker` seam redesign
- `ConversationWorker` seam redesign
- broad retry/recovery redesign under the name of `RF-033`
- internal run-lifecycle ownership rewrite hidden inside another small execution-boundary session

## Summary

Sessions 60-67 successfully reduced the highest-value execution/runtime dependency-direction knot identified in Session 59. The runtime-facing boundary is now explicit and stable, the major cycle-assembly and pre/post-cycle detail work sits behind narrow collaborators, and the remaining `ExecutionService` mass is mostly the concrete orchestration owner for existing semantics.

That is enough to stop treating `RF-033` execution/runtime cleanup as the main cleanup focus. The right next step is a fresh non-execution dependency review under `RF-034`, not another opportunistic peel from `ExecutionService`.
