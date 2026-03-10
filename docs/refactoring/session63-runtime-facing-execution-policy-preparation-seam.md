# Session 63: Runtime-Facing Execution Policy Preparation Seam

## Scope

This session continues `RF-033` with one narrow composition cleanup around the remaining per-work-item tool/policy preparation feeding the execution cycle path.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery behavior
- redesign `ToolWorker`
- redesign `ConversationWorker`
- redesign `ReActIntegration` continuation ownership
- move prompt/tooling composition wholesale
- change transport ownership or durable ownership lines

## What narrow seam was introduced

A new execution/runtime-facing policy-preparation seam now lives at:

- `src/runtime/execution-boundary/execution-tool-policy-preparer.ts`

Its default local implementation lives at:

- `src/runtime/execution-boundary/local-execution-tool-policy-preparer.ts`

The seam is intentionally small:

- `ExecutionToolPolicyPreparer`
- `PreparedExecutionToolPolicy`
- `LocalExecutionToolPolicyPreparer`

It owns only the per-work-item scoped tool-policy preparation needed immediately before `ExecutionService` hands control to the execution cycle path.

## Which remaining preparation pressure it reduces

Before this session, `ExecutionService` still directly owned one more local preparation knot:

- reading any per-work-item tool allowlist override
- deriving layered tool policy from `tool_policy` or `policy_snapshot`
- deriving tool policy context from work-item context plus route context
- constructing the scoped `ToolEnforcer`
- capturing the matching policy-audit snapshot used for prompt context, run logs, and decision persistence

That meant the concrete implementation behind `ExecutionRunner` still mixed run lifecycle ownership with the last per-work-item tool/policy setup feeding the cycle path.

After this session:

- `ExecutionService` still owns run creation, approval gating, resource selection, retry/escalation classification, and run completion
- `ExecutionService` now depends on `ExecutionToolPolicyPreparer` for the per-work-item scoped tool-policy setup
- `LocalExecutionToolPolicyPreparer` performs the same scoped allowlist, layered-policy, policy-context, and policy-audit preparation that `ExecutionService` previously performed inline

This remains an explicit local extraction, not a policy-engine rewrite and not a service container.

## What ExecutionService now depends on instead

`ExecutionService` now:

- creates the same baseline root tool registry / allowlist / enforcer state it already owned
- constructs or receives an `ExecutionToolPolicyPreparer`
- asks that collaborator to prepare scoped tool-policy state for the current work item
- attaches the returned policy audit to the work item
- passes the returned scoped `ToolEnforcer` into `ExecutionCycleRunner.executeCycle(...)`

The runtime-facing path is now:

- `LocalExecutionAdapter`
- `ExecutionRunner`
- `ExecutionService`
- `ExecutionToolPolicyPreparer`
- `ExecutionCycleRunner`

## What intentionally remains unchanged

The following semantics remain unchanged in this session:

- allowlist semantics
- `ToolEnforcer` enforcement behavior
- policy-audit meaning and persisted decision shape
- approval gating meaning
- retry/escalation classification
- scheduler-owned run identity
- execution/recovery behavior
- direct and evented mode behavior
- `ReActIntegration` continuation ownership
- `ToolWorker` and `ConversationWorker` seams
- transport ownership, IPC, and durable ownership lines

`ExecutionService` also remains the concrete implementation behind `ExecutionRunner`.

## Focused validation

Focused tests cover:

- `ExecutionService` using the new `ExecutionToolPolicyPreparer` seam for per-work-item policy setup
- `ExecutionService` still delegating execution through `ExecutionCycleRunner`
- existing allowlist isolation and layered-policy behavior remaining unchanged on the same execution path

Build and typecheck validation were also run to confirm the contained extraction remains runnable.

## Next safest RF-033 step

The next safest cleanup step is another narrow extraction around the remaining per-work-item resource-selection and pre-search pressure still retained inside `ExecutionService`, most likely by isolating the skill/MCP/tool narrowing preparation that currently mutates work-item context before run creation, without changing worker ownership, policy semantics, or execution/recovery behavior.
