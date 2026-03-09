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
| Conversation/session decoupling | done | Session 53 closed the current local ConversationWorker line as stable enough to pause as the primary focus; broader non-local hardening and ownership migration remain deferred. |
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
| RF-020 | Recovery readiness review | Reassess evented mode default-readiness after manual recovery baseline | done | medium | RF-018 | 30 | Session 30 completed the stage review: direct remains the safe default, evented is controlled-rollout ready but not default-ready, manual replay is guarded but not yet routine-use ready, and the next hardening set is daemon-safe replay plus replacement-run follow-up policy and tighter replay auditability. |
| RF-043 | Execution/recovery hardening | Close the minimum hardening set identified by RF-020 before broader evented adoption | done | high | RF-020 | 31 | Session 31 added a daemon-safe manual replay control path through the active scheduler daemon, preserved strict replay gating and duplicate suppression, and surfaced stable operator-facing policy state/reason when a replacement replay attempt later becomes stale/orphaned; direct mode remains unaffected. |
| RF-044 | Execution/recovery closure review | Produce a closure review and handoff recommendation for the execution/recovery line after Sessions 10-31 | done | medium | RF-043 | 32 | Session 32 concluded the execution/recovery line is stable enough to pause as the primary refactor focus: direct remains the default, evented/manual replay/daemon-safe replay are guarded operator tools, broader/default adoption still needs short-tail audit and workflow validation, and Session 33 should start ToolWorker extraction design. |
| RF-021 | Tool boundary design | Produce ToolWorker extraction design and dependency map | done | medium | RF-009 | 33 | Session 33 documented the current tool-execution path, dependency hotspots, concern split, narrow first ToolPort/ToolRequest/ToolResult boundary, preserved execution/recovery invariants, and recommended Session 34 as direct in-process tool boundary extraction without changing scheduler, IPC, or tool semantics. |
| RF-022 | Tool boundary extraction | Introduce ToolPort / tool execution boundary | done | medium | RF-021 | 34 | Session 34 added a narrow in-process `ToolPort` / `ToolRequest` / `ToolResult` boundary, a `LocalToolAdapter` over the existing `ToolEnforcer` + `ToolRegistry` path, and routed `ReActIntegration` tool calls through it without changing gateway, IPC, policy ownership, prompt/schema generation, or direct/evented semantics. |
| RF-023 | Tool worker skeleton | Add ToolWorker skeleton in parallel path | done | medium | RF-022 | 35 | Session 35 added a local in-process `LocalToolWorker` that reuses `ToolPort` / `ToolRequest` / `ToolResult`, emits `tool.requested` / `tool.started` / `tool.completed` / `tool.failed`, suppresses duplicate `toolRequestId`s in memory, and is composed in parallel without changing gateway, IPC, prompt/schema generation, policy ownership, or the default direct tool path. |
| RF-045 | Tool handoff design | Produce the first tool result handoff design for future authoritative ToolWorker execution | done | medium | RF-023 | 36 | Session 36 documented the current direct tool-result path, defined continuation ownership and correlation requirements for a future worker-driven path, preserved execution/recovery invariants, and recommended Session 37 as the smallest safe coding step: switch `ReActIntegration` to await local in-process `LocalToolWorker.dispatch(...)` without adding a tool mode switch. |
| RF-024 | Tool mode switch | Add direct/evented tool dispatch mode if needed | planned | low | RF-023 | 39 | Session 39 documented the first safe tool mode switch design and concluded a formal mode setting should not exist yet; any future implementation must preserve one awaited `ToolResult` and keep continuation ownership inside `ReActIntegration`. |
| RF-025 | Tool result handoff | Make tool result path scheduler/execution-safe and idempotent | done | medium | RF-045 | 45 | Session 38 hardened the authoritative local seam with request-identity validation, broader result-correlation checks, invalid-result normalization, and narrow in-process inspection visibility; Session 40 then documented the promise-bridged authoritative handoff model; Session 41 added the first in-process request registry so the authoritative local path now registers by `toolRequestId`, returns one registry-owned promise, and suppresses duplicate terminal completion without changing continuation ownership or scheduler-facing semantics; Session 42 then documented the first narrow timeout / missing-result design; Session 43 then implemented that local timeout normalization in `LocalToolWorker`, resolving the registry-owned promise with one normalized failed `ToolResult` using `TOOL_EXECUTION_TIMEOUT` and ignoring late completions for continuation purposes; Session 44 then added explicit terminal-path and late-result diagnostics on the same local path; Session 45 closes the local handoff line as stable enough to pause as the primary focus. |
| RF-026 | Tool hardening | Add recovery/idempotency/inspection for tool worker path | deferred | low | RF-025 | 45 | Session 38 started the local inspection/hardening slice by adding read-only `LocalToolWorker.inspect()` diagnostics plus inspection summaries on `tool.*` runtime events; Session 44 extended that local inspection surface with explicit timeout/late-completion/invalid-completion metadata, terminal-path visibility, and narrow summary counters while keeping everything local and in-process; Session 45 concluded that broader durable recovery/idempotency, operator-facing inspection, and cross-process hardening are not immediate blockers and can be deferred until a non-local tool topology is justified. |
| RF-046 | Tool mode switch design | Produce the first safe tool mode switch design for future worker-driven tool execution | done | medium | RF-025 | 39 | Session 39 documented the current authoritative local tool path, defined the minimum invariant set for any future switch, rejected a formal `toolExecutionMode` setting for now, and recommended Session 40 as a promise-bridged handoff design before any implementation work. |
| RF-047 | Tool promise bridge prototype | Prototype a narrow local internal request registry for promise-bridged authoritative tool handoff | done | medium | RF-025 | 41 | Session 41 implemented the narrow local in-process `ToolRequestRegistry`, wired `LocalToolWorker` through registry-owned promise registration before execution, preserved the await-based `ReActIntegration` contract, recorded terminal metadata by `toolRequestId`, and kept gateway behavior, IPC, MCP/local execution compatibility, and scheduler-facing semantics unchanged. |
| RF-048 | Local tool timeout normalization | Add the first narrow timeout / missing-result resolution path for registered local tool requests | done | medium | RF-025 | 43 | Session 42 defined the smallest safe implementation; Session 43 completed it by having `LocalToolWorker` own one local timeout per authoritative registration, resolve the registry-owned promise with a normalized failed `ToolResult` using `TOOL_EXECUTION_TIMEOUT`, preserve request identity fields, and treat late results as diagnostic-only without changing gateway, IPC, evented semantics, or scheduler ownership. |
| RF-049 | ToolWorker closure review | Produce a closure review and handoff recommendation for the ToolWorker line after Sessions 33-44 | done | medium | RF-025 | 45 | Session 45 concluded the ToolWorker line is stable enough to pause as the primary refactor focus for its intended local-authoritative scope: `LocalToolWorker` is the authoritative local seam, request-registry handoff and timeout normalization now protect one awaited continuation per `toolRequestId`, broader durable/cross-process hardening remains intentionally deferred, and Session 46 should begin ConversationWorker extraction design. |
| RF-050 | Conversation request registry design | Produce the first local conversation request-registry design for the new ConversationWorker seam | done | medium | RF-031 | 49 | Session 49 documented the current local conversation handoff model, identified the lifecycle and ownership gaps around duplicate suppression, request identity, terminal resolution, invalid/late/missing-result handling, and concluded that a narrow local in-process `ConversationRequestRegistry` is now justified as the smallest safe lifecycle owner under `ConversationWorker`; Session 50 should implement that prototype without changing gateway behavior, IPC, continuation ownership, or scheduler-authoritative task materialization. |
| RF-051 | Conversation request registry prototype | Implement the first narrow local in-process `ConversationRequestRegistry` under the authoritative `ConversationWorker` seam | done | medium | RF-050 | 50 | Session 50 added a local in-process `ConversationRequestRegistry` keyed by `conversationRequestId`, moved duplicate in-flight suppression and registry-owned promise lifecycle ownership under that seam, kept `SchedulerSessionIntake` as the outer await/continuation owner, preserved gateway behavior and scheduler-authoritative task materialization, and left timeout/evented/durable conversation behavior intentionally out of scope. |
| RF-052 | Conversation timeout / missing-result design | Produce the first timeout / missing-result design for the local `ConversationWorker` request-registry handoff path | done | medium | RF-051 | 51 | Session 51 documented the current local request-registry handoff model, identified the remaining indefinite-wait and late-completion risk after registration, recommended `ConversationWorker` as the first timeout-policy owner, recommended rejecting the registry-owned promise with a normalized `CONVERSATION_EXECUTION_TIMEOUT` failure rather than widening `ConversationResult`, defined late results after timeout as diagnostic-only and non-authoritative, and recommended Session 52 implement that narrow local timeout normalization without changing gateway behavior, IPC, continuation ownership, or scheduler-authoritative task materialization. |
| RF-053 | Conversation timeout normalization | Implement the first narrow local timeout / missing-result resolution path for registered local conversation requests | done | medium | RF-052 | 52 | Session 52 added one worker-owned local timer in `ConversationWorker` after authoritative registration, rejects the registry-owned promise through the existing failure path with `CONVERSATION_EXECUTION_TIMEOUT`, preserves request identity on the timeout error, keeps exactly one terminal outcome per `conversationRequestId`, and treats late completions as local inspection-only diagnostics without changing gateway behavior, IPC, continuation ownership, or scheduler-authoritative task materialization. |
| RF-054 | ConversationWorker closure review | Produce a closure review and handoff recommendation for the ConversationWorker line after Sessions 46-52 | done | medium | RF-053 | 53 | Session 53 concluded the ConversationWorker line is stable enough to pause as the primary refactor focus for its intended local-authoritative scope: `ConversationWorker` is the authoritative local message-execution seam, the request-registry handoff and timeout normalization now protect one awaited continuation per `conversationRequestId`, broader durable/cross-process hardening remains intentionally deferred, and Session 54 should begin runtime boundary cleanup work instead of broadening conversation topology. |
| RF-027 | Conversation design | Produce ConversationWorker / session decoupling design doc | done | medium | RF-016 | 46 | Session 46 documented the current gateway -> IPC -> scheduler intake -> SessionManager path, mapped dependency/coupling hotspots, defined the first safe local `ConversationPort` / `ConversationRequest` / `ConversationResult` boundary, kept scheduler-owned task materialization and gateway routing outside the worker, and recommended Session 47 as narrow local boundary extraction without changing IPC, gateway behavior, or execution/recovery semantics. |
| RF-028 | Conversation boundary extraction | Introduce conversation/session boundary port | done | medium | RF-027 | 47 | Session 47 added a narrow local `ConversationPort` / `ConversationRequest` / `ConversationResult` seam with worker-local `conversationRequestId`, and routed `SchedulerSessionIntake.processMessage(...)` through it without changing gateway behavior, IPC, scheduler task materialization authority, repository ownership, or gateway session routing ownership. |
| RF-029 | Conversation worker skeleton | Add ConversationWorker skeleton | done | medium | RF-028 | 47 | Session 47 added the first local in-process `ConversationWorker` wrapping the existing `SessionManager` orchestration path; it is authoritative only for the narrow local conversation seam and does not introduce multi-process dispatch, durable ledgers, or ownership changes across scheduler, gateway, or persistence boundaries. |
| RF-030 | Conversation materialization decoupling | Decouple session-to-goal materialization from direct scheduler bridge | planned | medium | RF-029 | — | Important semantic boundary. |
| RF-031 | Conversation hardening | Add inspection/reliability model for conversation worker path | done | low | RF-030 | 48 | Session 48 hardened the first local ConversationWorker seam with request validation, intake-side result identity checks, exact duplicate in-flight suppression by `conversationRequestId`, and a read-only local inspection snapshot exposed through the worker/intake without changing gateway behavior, IPC, scheduler task materialization authority, or session routing ownership. |
| RF-032 | Boundary cleanup | Reduce global singleton dependence in runtime core | in_progress | medium | RF-009 | 54 | Session 54 produced the first runtime-core boundary cleanup design baseline, mapped the highest-impact singleton/composition hotspots from the current codebase, identified the mutable global tool-provider path as the most dangerous remaining coupling hotspot, and recommended a scheduler-owned runtime tooling context as the safest first cleanup boundary; no runtime code changed yet. |
| RF-033 | Import-cycle cleanup | Break major cross-layer import cycles in `src/` | planned | medium | RF-032 | — | Large but valuable cleanup. |
| RF-034 | Infra-hub reduction | Reduce `src/infra` as super dependency hub | planned | low | RF-033 | — | Longer-term codebase cleanup. |
| RF-035 | Gateway/daemon seam cleanup | Further align code boundaries with runtime process boundaries | planned | low | RF-033 | — | Longer-term architectural cleanup. |
| RF-036 | Event protocol cleanup | Review legacy `task.*` event names and future protocol normalization | planned | low | RF-020 | — | Only after execution/recovery semantics stabilize. |
| RF-055 | Runtime tooling context extraction | Introduce an explicit scheduler-owned runtime tooling context and stop using `globalToolProvider` as the runtime-core source of truth | planned | medium | RF-032 | — | Recommended by Session 54 as the single next coding session: keep current tool execution semantics and worker seams, but move runtime-core tool/prompt capability ownership to an explicit injected boundary. |
| RF-037 | Manual replay design | Produce safe manual replay design doc for evented execution runs | done | high | RF-019 | 24 | Session 24 defined manual replay as creating one replacement run for the same work item, with original-run continuation suppression and narrow replay lineage in `evented_dispatch`. |
| RF-038 | Manual replay action 1 | Implement the safest first manual replay action chosen by RF-037 | done | high | RF-037 | 25 | Session 25 added `pb scheduler replay-run <runId>` for the first safe evented-only manual replay path: original-run continuation is durably suppressed in `evented_dispatch.manual_replay`, one replacement run is created on the same work item with replay lineage, late original results are suppressed at continuation-claim time, and direct mode behavior remains unchanged. |
| RF-039 | Replay inspection | Add narrow read-only replay lineage/state inspection for operators | done | medium | RF-038 | 26 | Session 26 extended `pb scheduler inspect-run <runId>` so operators can inspect replay lineage from either side via explicit replay fields and derived lineage role/peer output, without changing replay or recovery semantics. |
| RF-040 | Manual replay hardening | Harden replay eligibility and duplicate replay suppression for the existing manual replay flow | done | high | RF-038 | 27 | Session 27 tightened durable replay gating, rejects replay attempts and missing/ineligible targets explicitly, blocks duplicate replacement creation using both original-side and reverse-lineage checks, and improves CLI replay rejection reporting without changing direct mode, gateway, IPC, or broader recovery scope. |
| RF-041 | Replay precheck surface | Add a narrow read-only replay precheck / confirmation CLI surface before manual replay execution | done | medium | RF-040 | 28 | Session 28 added `pb scheduler replay-precheck <runId>` as a read-only operator surface that reuses the same durable replay eligibility classifier as `replay-run`, reports stable rejection codes or expected replay consequences, and preserves direct mode plus existing replay execution semantics. |
| RF-042 | Replay post-run diagnostics | Add a narrow read-only replay outcome / replay-chain inspection surface after manual replay execution | done | medium | RF-041 | 29 | Session 29 extended `pb scheduler inspect-run <runId>` with a read-only replay outcome block derived from durable lineage plus linked peer inspection, so operators can determine replay initiation, replacement-run status, continuation suppression, replacement continuation application, and whether the chain currently appears active, completed, failed, or unresolved without changing replay behavior. |

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
