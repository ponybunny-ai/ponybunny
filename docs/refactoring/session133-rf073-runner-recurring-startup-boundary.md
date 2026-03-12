# Session 133: RF-073 Runner + Recurring Startup Boundary

## Targeted Cluster

This session completed the second bounded coding cluster for `RF-073` by extracting the later startup sequence in `src/scheduler-daemon/daemon.ts` that still mixed:

- touched runner registration / runner-availability preparation
- recurring `AgentScheduler` enablement
- recurring loop startup timing

The targeted slice was the block that ran after scheduler startup plus queued-goal recovery and before the retention loop was enabled.

## Introduced Daemon-Owned Boundary

This session introduced `src/scheduler-daemon/daemon-recurring-startup.ts` as the daemon-owned later-startup boundary for that path.

`startDaemonRecurringStartup(...)` now owns:

- registering the schema-driven runner on the touched daemon startup path for both `default` and `market_listener`
- constructing `AgentScheduler` when recurring agents are enabled
- starting the recurring dispatch loop through the extracted `startAgentSchedulerLoop(...)` helper
- returning the minimal lifecycle handle that `SchedulerDaemon.start()` still needs for cleanup (`agentScheduler` plus the interval handle)

Two narrow support changes were added to keep the seam explicit without broadening scope:

- `RunnerRegistry.registerMany(...)` in `src/infra/agents/runner-registry.ts`
- `startAgentSchedulerLoop(...)` in `src/scheduler-daemon/agent-scheduler.ts`

## What Moved Out of `SchedulerDaemon.start()`

Moved out:

- the touched runner alias registration block
- recurring `AgentScheduler` construction
- the guarded interval loop that suppresses overlapping dispatches
- the recurring-loop error hook wiring for `[SchedulerDaemon] AgentScheduler dispatch failed:`

Intentionally left inline:

- PID lock acquisition, repository initialization, and evented startup reconciliation
- daemon-owned activation preparation introduced in Session 132
- Gateway IPC connection and control socket startup
- session-intake creation
- runtime assembly, execution-worker startup, scheduler startup, and queued-goal recovery
- `isRunning` transition, retention-loop startup, and outer startup success/failure handling

## Preserved Semantics and Ordering

The extraction intentionally preserved the reviewed startup behavior:

- activation preparation still happens before the later recurring-startup boundary
- scheduler startup and queued-goal recovery still happen before runner registration on this path
- runner registration still completes immediately before recurring loop enablement
- recurring enablement still uses the same `claimTtlMs = tickIntervalMs * 2` and `scheduler-daemon-${process.pid}` instance-ID semantics
- startup logs for runner registration, recurring-loop enablement, and recurring dispatch failures remain materially unchanged
- daemon startup success/failure behavior, RPC/event/status payload shapes, and TUI behavior were not changed

## Residue Intentionally Left for Runtime-Driven Follow-Up

This session intentionally did not try to redesign the rest of daemon startup.

Left in place on purpose:

- global runner-registry ownership and broader runner composition
- queued-goal recovery ordering
- retention-loop ownership
- outer daemon lifecycle and cleanup structure
- broader subagent or startup/bootstrap refactors outside this touched path

The remaining next step should be runtime-driven runnable validation/fixes, not another design-heavy RF-073 extraction pass.
