# PonyBunny Refactor Master Task List

Status values:
- `done`
- `in_progress`
- `planned`
- `blocked`
- `deferred`

Update rule from Session 22 onward:
- Every Codex implementation session must update this file.
- It must update the relevant task row(s): `status`, `last_session`, `notes`.
- It must not rewrite unrelated rows.
- It must keep task IDs stable.
- If a session creates a new follow-up task, it may append a new row in the appropriate section using the next available task ID.

## 1. Project Summary

| Area | Current State | Notes |
|---|---|---|
| Runtime event spine | done | Event bus, event store, tail/replay, terminology normalization completed. |
| Scheduler ↔ Execution decoupling | done | ExecutionPort, LocalExecutionWorker, mode switch, result handoff, continuation convergence completed. |
| Evented execution hardening baseline | done | Reconciliation, durable dispatch checkpoint, durable idempotency, orphan policy, operator inspection, recovery-candidate skeleton completed. |
| Manual recovery action model | done | Session 21 defined the model and Session 22 implemented the first metadata-only clear action. |
| ToolWorker extraction | planned | Not yet started. |
| Conversation/session decoupling | planned | Not yet started. |
| Deeper code-boundary cleanup | planned | Import-cycle reduction, singleton reduction, infra-hub cleanup still pending. |

## 2. Task Table

| Task ID | Area | Task | Status | Priority | Depends On | Last Session | Notes |
|---|---|---|---|---|---|---|---|
| RF-001 | Runtime spine | Create RuntimeEvent abstraction and memory event bus | done | high | — | 2 | Completed in earlier playbook sessions. |
| RF-002 | Runtime spine | Bridge gateway/debug/scheduler events into runtime event bus | done | high | RF-001 | 4 | Adapters added and wired. |
| RF-003 | Runtime spine | Add runtime event persistence and CLI tail/replay | done | high | RF-001 | 7 | Event store and CLI inspection completed. |
| RF-004 | Terminology | Normalize new runtime spine terminology to `workItemId` / `work_item_id` | done | high | RF-003 | 10A | Narrow terminology unification completed. |
| RF-005 | Execution boundary | Introduce ExecutionPort / ExecutionRequest / ExecutionResult boundary | done | high | RF-004 | 10 | Scheduler now depends on ExecutionPort. |
| RF-006 | Execution worker | Add LocalExecutionWorker skeleton subscribed to `task.ready` | done | high | RF-005 | 11 | Worker exists in parallel, not initially authoritative. |
| RF-007 | Execution modes | Add `direct` vs `evented` execution mode switch | done | high | RF-006 | 12 | Default remains `direct`. |
| RF-008 | Evented execution | Make `execution.completed` / `execution.failed` authoritative in evented mode | done | high | RF-007 | 13 | Scheduler consumes worker result events. |
| RF-009 | Post-result continuation | Converge direct/evented post-execution continuation path | done | high | RF-008 | 14 | Shared continuation entry point added. |
| RF-010 | Failure semantics | Enrich `execution.failed` payload with richer failed result structure | done | medium | RF-009 | 15 | Better accounting and diagnostics in evented mode. |
| RF-011 | Hardening design | Produce evented hardening design doc | done | medium | RF-010 | 16 | Reliability gaps and roadmap documented. |
| RF-012 | Reconciliation | Add durable evented dispatch checkpoint and startup reconciliation skeleton | done | high | RF-011 | 17 | Conservative detection/classification only. |
| RF-013 | Idempotency | Add durable scheduler-side idempotency for evented result application | done | high | RF-012 | 18 | Duplicate result continuation suppressed durably. |
| RF-014 | Orphan policy | Add conservative timeout/orphan policy for stale evented runs | done | medium | RF-012 | 19 | Durable stale/orphan marking completed. |
| RF-015 | Operator inspection | Add read-only reconciliation/orphan inspection CLI surface | done | medium | RF-014 | 20A | In-flight/orphaned/reconciliation-summary queries added. |
| RF-016 | Recovery candidate skeleton | Add inspect-one-run and mark-recovery-candidate CLI workflow | done | medium | RF-015 | 20B | Conservative manual recovery preparation added. |
| RF-017 | Manual recovery design | Produce manual recovery action design doc | done | high | RF-016 | 21 | Session 21 documented clear/unmark as the first safe metadata-only action. |
| RF-018 | Manual recovery action 1 | Implement safest first manual recovery action chosen by RF-017 | done | high | RF-017 | 22 | `clear-recovery-candidate` clears only `evented_dispatch.recovery_candidate` and preserves direct mode semantics. |
| RF-019 | Manual recovery action 2 | Add second conservative manual recovery operator action if justified | done | medium | RF-018 | 23 | Session 23 added metadata-only `mark-replay-candidate` with `recovery_candidate` precondition and inspect support; no replay semantics were introduced. |
| RF-020 | Recovery readiness review | Reassess evented mode default-readiness after manual recovery baseline | planned | medium | RF-018 | — | Decide what remains before evented can become default. |
| RF-021 | Tool boundary design | Produce ToolWorker extraction design and dependency map | planned | medium | RF-009 | — | Tool orchestration still lives inside execution flow. |
| RF-022 | Tool boundary extraction | Introduce ToolPort / tool execution boundary | planned | medium | RF-021 | — | First cut before actual ToolWorker. |
| RF-023 | Tool worker skeleton | Add ToolWorker skeleton in parallel path | planned | medium | RF-022 | — | Similar pattern to LocalExecutionWorker. |
| RF-024 | Tool mode switch | Add direct/evented tool dispatch mode if needed | planned | low | RF-023 | — | Only if architecture warrants it. |
| RF-025 | Tool result handoff | Make tool result path scheduler/execution-safe and idempotent | planned | medium | RF-023 | — | Hardening equivalent for tool worker path. |
| RF-026 | Tool hardening | Add recovery/idempotency/inspection for tool worker path | planned | low | RF-025 | — | Likely later phase. |
| RF-027 | Conversation design | Produce ConversationWorker / session decoupling design doc | planned | medium | RF-016 | — | Conversation-to-goal bridge remains directly coupled. |
| RF-028 | Conversation boundary extraction | Introduce conversation/session boundary port | planned | medium | RF-027 | — | Separate scheduler-facing bridge from session flow. |
| RF-029 | Conversation worker skeleton | Add ConversationWorker skeleton | planned | medium | RF-028 | — | Parallel worker path only. |
| RF-030 | Conversation materialization decoupling | Decouple session-to-goal materialization from direct scheduler bridge | planned | medium | RF-029 | — | Important semantic boundary. |
| RF-031 | Conversation hardening | Add inspection/reliability model for conversation worker path | planned | low | RF-030 | — | Later phase. |
| RF-032 | Boundary cleanup | Reduce global singleton dependence in runtime core | planned | medium | RF-009 | — | Especially tool/LLM/global registries. |
| RF-033 | Import-cycle cleanup | Break major cross-layer import cycles in `src/` | planned | medium | RF-032 | — | Large but valuable cleanup. |
| RF-034 | Infra-hub reduction | Reduce `src/infra` as super dependency hub | planned | low | RF-033 | — | Longer-term codebase cleanup. |
| RF-035 | Gateway/daemon seam cleanup | Further align code boundaries with runtime process boundaries | planned | low | RF-033 | — | Longer-term architectural cleanup. |
| RF-036 | Event protocol cleanup | Review legacy `task.*` event names and future protocol normalization | planned | low | RF-020 | — | Only after execution/recovery semantics stabilize. |
| RF-037 | Manual replay design | Produce safe manual replay design doc for evented execution runs | done | high | RF-019 | 24 | Session 24 defined manual replay as creating one replacement run for the same work item, with original-run continuation suppression and narrow replay lineage in `evented_dispatch`. |
| RF-038 | Manual replay action 1 | Implement the safest first manual replay action chosen by RF-037 | done | high | RF-037 | 25 | Session 25 added `pb scheduler replay-run <runId>` for the first safe evented-only manual replay path: original-run continuation is durably suppressed in `evented_dispatch.manual_replay`, one replacement run is created on the same work item with replay lineage, late original results are suppressed at continuation-claim time, and direct mode behavior remains unchanged. |

## 3. Suggested Near-Term Sequence

| Order | Task ID | Reason |
|---|---|---|
| 1 | RF-017 | Define the safe manual recovery action model before implementing any actual recovery action. |
| 2 | RF-018 | Implement the single safest manual recovery action chosen by RF-017. |
| 3 | RF-019 | Add the second conservative operator action only if still justified. |
| 4 | RF-020 | Reassess whether evented mode is approaching default-ready. |
| 5 | RF-021 | Start the next large architecture front: ToolWorker design. |

## 4. Session Update Instructions for Codex (Use from Session 22 onward)

Include the following in future implementation prompts:

```text
Also update:
- docs/refactoring/ponybunny_refactor_master_task_list.md

Update rules:
- Update only the task row(s) relevant to this session.
- Set or adjust: status, last_session, notes.
- If this session completes a planned task, mark it as `done`.
- If this session starts but does not finish a task, mark it as `in_progress`.
- If this session discovers a necessary follow-up task not yet listed, append one new row with the next available Task ID.
- Do not rewrite unrelated rows.
- Keep task IDs stable.
```

## 5. Status Legend Guidance

| Status | Meaning |
|---|---|
| `done` | Implemented and validated for the intended scope. |
| `in_progress` | Active task with partial completion. |
| `planned` | Known future task, not yet started. |
| `blocked` | Cannot proceed until dependency or design issue is resolved. |
| `deferred` | Intentionally postponed. |
