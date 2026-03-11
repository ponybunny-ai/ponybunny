# Session 126: Agent Command Submit Boundary

## Targeted Block

Session 126 completed the second bounded coding cluster for the active agent-registry access / agent-definition boundary cleanup block.

The targeted cluster was:

- introduce one gateway-owned loaded-agent-definition / request-materialization boundary for `agent.command.submit`
- move the mixed registry-backed load/validate/materialization sequence out of `src/gateway/rpc/handlers/goal-handlers.ts`
- keep the scope limited to this one live gateway RPC path

## Gateway-Owned Boundary Introduced

This session added `src/gateway/rpc/agent-command-submit-goal-materializer.ts`.

That module introduces:

- `IAgentCommandSubmitGoalMaterializer`
- `RegistryBackedAgentCommandSubmitGoalMaterializer`
- `createDefaultAgentCommandSubmitGoalMaterializer()`

The new gateway-owned boundary now owns the current `agent.command.submit` loaded-definition / materialization flow for that path:

- selecting the effective agent id from request params or runtime defaults
- loading definitions from the current registry-backed source
- resolving and validating the enabled definition
- preserving the current scheduler-daemon-required check position
- deriving workdir, effective tool allowlist, approval flags, `policy_snapshot`, and `routeContext`
- calling the remote scheduler materialization handoff with the same request shape as before

This is intentionally still registry-backed. The session did not attempt broader global-registry removal or a new startup/runtime owner.

## What Moved Out Of `goal-handlers.ts`

`src/gateway/rpc/handlers/goal-handlers.ts` is now a thinner delegating surface for `agent.command.submit`.

What moved out of the handler:

- runtime default-agent selection for this path
- direct `getGlobalAgentRegistry().loadAgents(...)`
- enabled-definition lookup and validation
- effective tool allow/deny derivation
- workdir derivation
- approval / `policy_snapshot` / `routeContext` derivation
- the direct `remoteSchedulerClient.materializeGoal(...)` call for this path

What stayed in the handler:

- request validation for `command`
- the returned goal subscription / event emission behavior
- the unrelated `goal.submit`, `goal.cancel`, `goal.status`, and other handler paths

## Intentionally Out Of Scope

This session intentionally did not change:

- `goal.submit`
- daemon startup loading, cron reconciliation, or runner registration
- `default-daemon-runtime.ts`
- `default-scheduler.ts`
- `local-execution-agent-tick-resolver.ts`
- subagent execution / process-lifecycle ownership
- RPC/event/status payload shapes
- TUI behavior

## Semantics Intentionally Preserved

The new seam preserves the current `agent.command.submit` behavior, including:

- default-agent selection from request params or runtime config
- missing/disabled-agent rejection behavior
- current scheduler-daemon-required rejection behavior
- current workdir derivation
- current effective tool allow/deny filtering
- current approval flags and `policy_snapshot`
- current `routeContext` derivation
- current remote scheduler handoff behavior

## Validation

Targeted validation completed:

- `npx jest test/gateway/rpc/agent-command-submit-goal-materializer.test.ts test/gateway/rpc/goal-handlers.test.ts --runInBand`
- `npx tsc --noEmit --pretty false --incremental false`
- `rg -n "getGlobalAgentRegistry|loadAgents|ensureAgentWorkdir|buildGatewayMessageRouteContext|materializeAgentCommandGoal|agent\\.command\\.submit" src/gateway/rpc/handlers/goal-handlers.ts src/gateway/rpc/agent-command-submit-goal-materializer.ts`
  - confirmed the touched registry-backed load/materialization sequence now lives in the new gateway-owned boundary
  - confirmed `goal-handlers.ts` now delegates `agent.command.submit` through that boundary instead of performing the sequence inline

## Why Review Next

This session completes the second bounded coding cluster selected for `RF-072`.

That should trigger another line review next because the remaining registry-backed consumers are now mostly:

- compatibility/reporting residue
- startup/runtime-owner seams
- execution/subagent ownership seams

Those are materially different ownership classes from the two bounded clusters completed in Sessions 124 and 126, so the next step should be review / re-ranking rather than another small extraction pass.
