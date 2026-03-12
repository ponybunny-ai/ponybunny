# Session 137: Gateway/Scheduler Closeout Review

## Scope

This session is a documentation and review closeout for the current gateway/scheduler refactor phase.

No runtime code was changed.
No TUI code was changed.
No RPC payload shapes, event payload shapes, transport semantics, scheduler semantics, or provider fallback semantics were changed.

## Evidence Reviewed

- `docs/refactoring/session134-runnable-validation-and-first-fixes.md`
- `docs/refactoring/session135-operational-flow-validation-and-fixes.md`
- `docs/refactoring/session136-agent-command-operational-validation-and-fixes.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`
- `src/gateway/gateway-server.ts`
- `src/gateway/rpc/handlers/goal-handlers.ts`
- `src/gateway/rpc/agent-command-submit-goal-materializer.ts`
- `src/gateway/events/broadcast-manager.ts`
- `src/gateway/types.ts`
- `src/gateway/rpc/handlers/system-handlers.ts`

## Closeout Judgment

Judgment: the current gateway/scheduler-side refactor phase should be closed out.

Reason:

- Session 134 proved the post-`RF-073` gateway and scheduler startup path is runnable on an isolated live system.
- Session 135 proved one real `goal.submit` flow works end to end through live gateway RPC submission, daemon handoff, scheduler execution, and terminal reporting.
- Session 136 proved one real `agent.command.submit` flow works end to end through the gateway-owned materialization boundary, daemon handoff, scheduler execution, verification, and terminal reporting.
- The issues still visible on those validated paths are non-blocking runtime residue or client-side integration concerns, not evidence that another gateway/scheduler architecture block is required.

## What Is Now Proven Working On The Gateway/Scheduler Side

### Startup and connectivity

- the gateway starts on the validated foreground WebSocket path
- the gateway creates and serves the daemon IPC socket
- the scheduler starts on the validated foreground path
- the scheduler connects to the gateway daemon socket successfully
- scheduler startup still completes agent loading, cron reconciliation, runner registration, recurring enablement, and steady-state runtime entry after `RF-073`

### Live request handling

- one real `goal.submit` request path is proven working end to end
- one real `agent.command.submit` request path is proven working end to end
- the gateway-owned `agent-command-submit-goal-materializer` successfully materializes a live goal/work-item path against the connected daemon
- authenticated client submission, daemon materialization/handoff, scheduler pickup, execution, and terminal goal/work-item reporting all succeed on the validated isolated path

### Live reporting and event flow

- `goal.status` reaches `completed` on the validated paths
- `workitem.byGoal` returns coherent terminal work-item state on the validated paths
- `workitem.runs` returns coherent terminal run records on the validated paths
- live event families used on the validated paths include `goal.*`, `workitem.*`, `run.*`, and `verification.*`
- the current authoritative gateway broadcast surface remains the explicit live protocol in `src/gateway/types.ts` and `src/gateway/events/broadcast-manager.ts`

## What Remains Only As Non-Blocking Residue

The following items remain real, but they are not blockers to closing the current gateway/scheduler refactor phase:

- duplicate direct-run persistence/reporting residue on the direct local execution path, where `workitem.runs` can show both the scheduler-facing run record and the internal execution-service run record for one successful work item
- early `goal.started` broadcast timing on auto-submitted flows, where `goal.started` can be emitted before the creator subscription is in place while later events and terminal status still succeed
- isolated-runtime fallback to mock-provider execution when config/credentials are intentionally absent in the validation home
- sandbox loopback/socket restrictions encountered during validation; these were environment restrictions, not PonyBunny runtime blockers
- mixed-permission foreground status-reporting noise observed in Session 134; this affected status checks, not actual gateway/scheduler liveness

## What Should Be Considered Closed

The following should remain closed and should not be reopened by this session:

- `RF-034` scheduler composition / ownership cleanup
- gateway/daemon transport-boundary block
- `RF-059` compatibility / public-surface rationalization
- `RF-060` startup / bootstrap composition-root rationalization
- `RF-061` GatewayServer internal runtime graph / service-wiring rationalization
- `RF-073` daemon-owned activation / recurring-startup boundary extraction
- `RF-075` runnable operational validation as the acceptance evidence for the current gateway/scheduler phase
- the current gateway/scheduler-side refactor phase as a whole

## What Should Remain Paused

Session 137 found no evidence that justifies reopening any paused architecture line.

These should remain paused exactly as already recorded:

- Sessions 95-100 source-of-truth line
- Sessions 101-103 runtime-core singleton / service-locator cleanup line
- Sessions 104-109 daemon detach/unsubscribe capability block
- `RF-062`
- `RF-030`
- `RF-036`
- `RF-071`
- the post-Session-127 agent-registry / agent-definition follow-up area

## What Should Be Deferred To Runtime-Driven Follow-Up Rather Than More Architecture Work

- any cleanup of duplicate direct-run reporting should be treated as narrow runtime/reporting follow-up only if it blocks real operator or client workflows
- any cleanup of early `goal.started` visibility should be treated as narrow event-ordering follow-up only if a client repair effort proves it is a real blocker
- TUI/client integration repair should proceed as a separate consumer-side workstream, not as a reopened gateway/scheduler architecture block
- any additional validation should stay runtime-driven and operational, not structural

## Why TUI Is Intentionally Excluded From This Closeout

TUI repair is intentionally out of scope for this closeout because the current acceptance question is whether the refactored gateway/scheduler side still runs and still handles real submission/execution flows correctly.

The live evidence now says yes.

The remaining TUI problem is therefore not sufficient reason to reopen gateway/scheduler architecture work by default. It is a separate client integration problem that should be addressed in its own bounded follow-up line, using the current live gateway/scheduler contract as the baseline.

This is especially important because:

- Sessions 135-136 already prove the backend-side `goal.submit` and `agent.command.submit` paths work on the live refactored system
- broadening this session into TUI repair would mix backend closeout with client/UI repair
- broadening this session into new architecture work would ignore the actual runtime evidence and the session scope constraints

## Final Assessment

Close the current gateway/scheduler-related refactor phase.

Treat the remaining gateway/scheduler issues as bounded runtime residue, not as justification for a new architecture block.

Hand off TUI mismatch as a separate future repair task, with this session's companion guide as the starting point.
