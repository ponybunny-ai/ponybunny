# Session 129: Subagent Execution / Capability Boundary

## Targeted Block

Session 129 started the new subagent execution / runtime ownership cleanup block with one bounded coding cluster on the current live schema-driven subagent path.

Reviewed live surfaces:

- `src/infra/agents/schema-driven-agent-runner.ts`
- `src/infra/agents/subagent-process-manager.ts`
- `src/infra/scheduler/capabilities.ts`
- `src/infra/agents/subagent-execution-boundary.ts` (new)

The session prompt referenced `src/infra/agents/subagent-executor.ts`, but the current live execution surface is `schema-driven-agent-runner.ts`; no separate `subagent-executor.ts` file exists in the current codebase.

## Boundary Introduced

This session introduced `src/infra/agents/subagent-execution-boundary.ts` as the explicit owner for the first in-scope execution-path / capability seam.

The new boundary now owns the touched logic for:

- deciding whether the current run should execute as a plain local agent run or as a parent run that activates configured subagent processes
- interpreting the relevant current capability signal on that path: whether each configured subagent definition exists and is enabled
- deriving the spawnable subagent target set, including workdir qualification, before the lower-level process manager is asked to fork children
- exposing the same agent capability view to `src/infra/scheduler/capabilities.ts` for the scheduler-facing `agents` capability snapshot without changing its outward payload shape

## Callers Moved

The current high-value call path was rewired as follows:

- `SchemaDrivenAgentRunner` / `DefaultAgentExecutionEngine`
  - no longer inline subagent-path branching
  - now delegate run-time subagent activation and stage-time runtime context reads to the new boundary
- `ProcessSubagentManager`
  - no longer reads the agent registry
  - no longer decides whether a configured subagent is missing/disabled
  - now stays focused on low-level fork / ready / heartbeat / shutdown behavior for explicit spawn targets
- `src/infra/scheduler/capabilities.ts`
  - no longer reads the global agent registry directly for `getAgentsInfo()`
  - now maps the existing `AgentInfo` payload from the boundary-owned capability view

## Intentionally Out Of Scope

This session did not change:

- full subagent process lifecycle ownership
- daemon startup / bootstrap ownership
- agent scheduler or cron reconciliation ownership
- gateway/daemon transport semantics
- provider execution or fallback behavior
- RPC/event/status payload shapes
- TUI behavior
- broader agent-registry or singleton cleanup lines

## Preserved Semantics

The implementation intentionally preserved:

- parent runs only activating configured subagents on the existing schema-driven path
- subagent ticks remaining non-spawning paths
- missing/disabled configured subagents being skipped rather than made fatal
- existing child ready/heartbeat/shutdown handling in `ProcessSubagentManager`
- existing stage payload shape, including `subAgents`, `subagentProcesses`, and `subagentHeartbeats`
- existing scheduler `system.capabilities` outward `agents` shape

## Likely Next Review Focus

The next session should review and re-rank from this new seam rather than continue with another small extraction by default.

The likely review questions are:

- whether the new boundary is now the single clear owner for the current execution-path / capability branch
- whether any remaining subagent residue is still a bounded execution/capability follow-up or has already crossed into broader lifecycle redesign risk
- whether daemon activation (`RF-073`) or another planned block should remain the stronger next coding target after this first subagent cluster landed

## Validation

Targeted validation run:

- `npx jest test/infra/agents/subagent-process-manager.test.ts test/infra/agents/subagent-execution-boundary.test.ts test/infra/agents/schema-driven-agent-runner.test.ts test/infra/scheduler/capabilities.test.ts --runInBand`
- `npx tsc --noEmit --pretty false`

Notes:

- The targeted Jest set passed.
- `tsc --noEmit` passed.
- Jest still reported its existing open-handle warning after completion; the targeted suites themselves passed.
