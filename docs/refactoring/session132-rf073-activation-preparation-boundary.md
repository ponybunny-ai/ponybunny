# Session 132: RF-073 Activation-Preparation Boundary

## Targeted Cluster

This session completed the first major coding cluster for `RF-073` by extracting the daemon-owned activation-preparation block out of `SchedulerDaemon.start()`.

The targeted cluster was the startup-time sequence that previously lived inline in `src/scheduler-daemon/daemon.ts`:

- load agent definitions from the daemon workspace
- derive available agent IDs from the loaded registry
- resolve the effective startup `mainAgentId`
- reconcile persisted cron jobs against the loaded registry, optionally scoped to the selected main agent
- return the reconciliation summary that startup logging reports

## Introduced Boundary

This session introduced `src/scheduler-daemon/daemon-activation-preparation.ts` as the explicit daemon-owned startup boundary for that sequence.

The new helper owns:

- `AgentRegistry.loadAgents(...)` for the daemon startup path
- `availableAgentIds` derivation from the loaded registry
- current `mainAgentId` selection semantics, including configured-id preference and the existing `lead` / first-agent fallback
- `reconcileCronJobsFromRegistry(...)` invocation against the same loaded registry
- the activation summary returned to `SchedulerDaemon.start()` for startup reporting

`SchedulerDaemon.start()` now delegates that bounded preparation step instead of mixing it inline with daemon bring-up, runtime assembly, scheduler startup, runner registration, and recurring enablement.

## What Moved vs Stayed Inline

Moved out of `SchedulerDaemon.start()`:

- daemon-owned agent loading
- available-agent ID derivation
- effective main-agent resolution
- cron-job reconciliation invocation
- reconciliation summary materialization for startup reporting

Intentionally left inline in `SchedulerDaemon.start()`:

- PID lock / repository initialization / evented startup reconciliation
- gateway IPC connection and control socket startup
- session-intake creation
- runtime assembly and execution-worker startup
- scheduler startup and queued-goal recovery
- runner registration
- recurring `AgentScheduler` enablement
- retention-loop startup
- startup warning/log emission that consumes the returned activation summary

## Preserved Semantics and Ordering

The extraction intentionally preserved the existing reviewed behavior:

- agent loading still happens before cron reconciliation
- `mainAgentId` scoping still uses the same configured-id, `lead`, then first-available fallback order
- cron reconciliation still uses the loaded registry from the same startup path
- scheduler startup still happens before recurring enablement
- runner registration still happens before the recurring `AgentScheduler` loop starts
- runtime assembly ordering and global-registry reads were not changed
- startup log strings and warning conditions remain materially unchanged

## Likely Next Review Surface

The next review should evaluate the remaining live residue around `SchedulerDaemon.start()` after this extraction, not start another small opportunistic cleanup.

The most likely remaining review targets are:

- whether runner registration should become its own daemon-owned capability-activation seam
- whether recurring `AgentScheduler` enablement should become a separate later-phase boundary
- whether the remaining inline startup choreography now has a clear second bounded slice or should be re-ranked behind other work
