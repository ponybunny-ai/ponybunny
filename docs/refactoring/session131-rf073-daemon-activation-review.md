# Session 131: RF-073 Daemon-Owned Agent Activation Boundary Review

## Scope

Session 131 is a documentation/review-only session.

This session does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume paused lines by default
- redesign scheduler semantics
- redesign gateway/daemon transport semantics
- redesign provider execution/fallback behavior
- redesign full daemon startup/bootstrap broadly
- redesign full subagent process lifecycle
- redesign runner-registration ownership broadly
- change existing RPC/event/status payload shapes
- change TUI behavior

The goal is to identify the single safest first cleanup slice inside the live startup cluster centered on `SchedulerDaemon.start()` and to define that slice tightly enough for one bounded follow-up session.

## Reviewed Sources

Reviewed documentation:

- `docs/refactoring/session130-daemon-activation-line-review.md`
- `docs/refactoring/ponybunny_refactor_master_task_list.md`

Reviewed current code:

- `src/scheduler-daemon/daemon.ts`
- `src/scheduler-daemon/agent-scheduler.ts`
- `src/infra/agents/runner-registry.ts`
- `src/infra/scheduler/cron-job-reconciler.ts`
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
- `src/infra/agents/agent-registry.ts`
- `src/infra/agents/schema-driven-agent-runner.ts`

## Current Startup / Activation Cluster in `SchedulerDaemon.start()`

### What happens there today

`SchedulerDaemon.start()` currently performs the following startup sequence in one method:

1. Acquire singleton/process startup prerequisites:
   - guard against duplicate daemon start
   - take the daemon PID lock
   - initialize the repository
   - reconcile evented in-flight runs on startup
2. Perform daemon-owned agent activation preparation:
   - get the global `AgentRegistry`
   - load agent definitions from the current workspace
   - derive `availableAgentIds`
   - resolve `mainAgentId`
   - reconcile cron jobs from the loaded registry, optionally scoped to the selected main agent
   - log the main-agent decision and cron reconciliation summary
3. Bring up runtime/process connectivity:
   - connect to gateway IPC
   - start the daemon control server
   - create session intake
   - assemble the default daemon runtime
   - start the execution worker
   - retain the scheduler instance
   - subscribe scheduler/debug forwarding
4. Start steady-state scheduler execution:
   - start the scheduler
   - recover queued goals
   - mark the daemon as running
5. Enable agent-execution and recurring dispatch surfaces:
   - register schema-driven runners into the global runner registry
   - if `agentsEnabled`, create `AgentScheduler`
   - start the recurring `dispatchOnce()` interval loop
6. Start remaining maintenance loops:
   - start run-event retention
   - log startup completion

Codebase grounding:

- Startup preparation and cron reconciliation are inline in `src/scheduler-daemon/daemon.ts:158`
- Runtime assembly still depends on global agent/runner registries through `createDefaultSchedulerDaemonRuntime(...)` in `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts:60`
- Runner registration and recurring enablement remain inline in `src/scheduler-daemon/daemon.ts:233`

### Which steps are truly daemon-owned

The clearly daemon-owned responsibilities in this cluster are:

- loading agents for daemon startup from the workspace via `AgentRegistry.loadAgents(...)` in `src/infra/agents/agent-registry.ts:59`
- selecting the daemon’s effective startup `mainAgentId` in `src/scheduler-daemon/daemon.ts:72`
- reconciling persisted cron-job state from the just-loaded registry in `src/infra/scheduler/cron-job-reconciler.ts:65`
- deciding whether recurring agent dispatch is enabled for this daemon process in `src/scheduler-daemon/daemon.ts:239`
- defining when runner availability becomes safe for daemon-owned agent ticks, because both recurring ticks and local execution agent-tick resolution ultimately depend on the global runner registry in `src/infra/agents/runner-registry.ts:4` and `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts:63`

These are daemon-owned because they are startup-time process decisions, not scheduler-core semantics and not gateway transport concerns.

### Which parts are ordering-sensitive

The current sequence has several real ordering constraints:

- Agent definitions must load before `reconcileCronJobsFromRegistry(...)`, because reconciliation reads `registry.getAgents()` and persists `definition_hash` plus enabled/schedule state from those loaded definitions in `src/infra/scheduler/cron-job-reconciler.ts:72`.
- `mainAgentId` selection currently happens before cron reconciliation because reconciliation uses it to scope which agent jobs remain active in `src/infra/scheduler/cron-job-reconciler.ts:76`.
- Runner registration must happen before recurring agent ticks are allowed to dispatch, because the agent-tick path resolves runners from the global registry and will throw for enabled agents if no matching runner is available in `src/infra/agents/runner-registry.ts:15`.
- Recurring enablement must remain after scheduler startup, because `AgentScheduler` is constructed with the live scheduler instance and its `dispatchOnce()` path immediately creates goals/work items and submits them through steady-state scheduler dependencies in `src/scheduler-daemon/agent-scheduler.ts:79`.
- Runtime assembly currently happens before explicit runner registration even though both rely on the same global runner registry; that means the first safe cleanup must preserve the existing “no agent tick before registration” behavior rather than reinterpret the broader order.

### Which responsibilities are mixed together but likely belong to distinct ownership sub-boundaries

The method currently mixes at least four ownership groups:

- daemon startup prerequisites and generic runtime bring-up
- daemon-owned activation preparation for loaded agents and cron-state reconciliation
- runner availability activation for schema-driven agent execution
- recurring schedule enablement and recurring dispatch loop startup

Those groups are adjacent, but they are not the same owner. The first group is general daemon lifecycle. The second is agent activation preparation. The third is execution capability availability. The fourth is recurring scheduling enablement.

## Issue Classification

### 1. Daemon-owned activation preparation

The start method currently inlines agent loading, available-agent discovery, main-agent selection, and cron reconciliation together in one startup block in `src/scheduler-daemon/daemon.ts:158`.

This is the clearest daemon-owned activation residue because it decides what agents exist for this daemon process and what persisted cron state should be considered active before recurring dispatch is ever enabled.

### 2. Startup ordering / choreography pressure

The same method also owns IPC connection, control server startup, session-intake creation, runtime assembly, scheduler start, queued-goal recovery, runner registration, recurring-loop enablement, and retention-loop enablement in one linear sequence in `src/scheduler-daemon/daemon.ts:189`.

That creates choreography pressure because a future cleanup can easily drift from ownership extraction into broad startup rewrite if it does not isolate one step cleanly.

### 3. Runner availability / registration timing

Runner registration is still a thin late startup side effect in `src/scheduler-daemon/daemon.ts:233`, while runner resolution is relied on by the agent-tick path through the runtime assembly in `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts:63` and `src/infra/agents/runner-registry.ts:15`.

This is a real boundary issue, but the current residue is mostly about timing and capability availability, not yet about replacing the global registry or redesigning runner ownership broadly.

### 4. Recurring-schedule enablement coupling

Recurring enablement is coupled directly to runner registration and to the same loaded registry used earlier for cron reconciliation in `src/scheduler-daemon/daemon.ts:239`.

`AgentScheduler.dispatchOnce()` expects valid definitions, enabled schedules, and working runner-backed execution later on its path in `src/scheduler-daemon/agent-scheduler.ts:94`. That makes recurring enablement adjacent to activation preparation, but not the same concern.

### 5. Compatibility / reporting residue

The current startup block also derives and logs `availableAgentIds`, `mainAgentId`, cron reconciliation totals, persona-enabled reporting, and later runner-registration / recurring-loop activation logs in `src/scheduler-daemon/daemon.ts:161`.

This reporting residue is real, but by itself it is not a strong first slice. Pulling log lines into helpers without changing ownership would be cosmetic only.

## Plausible First Slices

Only slices that fit the current codebase and stay inside the live seam are considered below.

### Slice A: Extract daemon-owned activation preparation before recurring enablement

Definition:

- introduce one narrow daemon-owned startup boundary that encapsulates:
  - `registry.loadAgents(...)`
  - available-agent ID derivation
  - `mainAgentId` selection
  - `reconcileCronJobsFromRegistry(...)`
  - startup activation summary/log data
- return a small result object that the rest of `SchedulerDaemon.start()` continues to consume
- leave runner registration, scheduler startup, and recurring-loop enablement where they are

Evaluation:

- Structural gain: high
- Semantic risk: low to medium
- Scope tightness: high
- True ownership/composition/boundary cleanup: yes
- Drift risk: low to medium

Why it fits:

This is the current daemon-owned activation preparation seam already living together in one contiguous block. It creates a new owner without forcing any reordering of scheduler startup or recurring enablement.

### Slice B: Isolate main-agent selection and available-agent summary derivation

Definition:

- extract only `availableAgentIds` derivation and `resolveMainAgentId(...)`
- keep agent loading and cron reconciliation inline

Evaluation:

- Structural gain: low
- Semantic risk: low
- Scope tightness: high
- True ownership/composition/boundary cleanup: weak
- Drift risk: low

Why it is weaker:

This would mostly split selection/reporting from the actual activation work. The hard daemon-owned responsibility is not just “pick a main id”; it is “prepare the daemon’s active agent set for startup reconciliation.” This slice is too cosmetic.

### Slice C: Tighten runner-registration timing boundary

Definition:

- extract runner registration into a helper or boundary
- possibly make registration happen at a more explicit point relative to runtime assembly

Evaluation:

- Structural gain: medium
- Semantic risk: medium to high
- Scope tightness: moderate
- True ownership/composition/boundary cleanup: yes
- Drift risk: high

Why it is riskier:

This slice immediately pulls on the runtime assembly’s use of the same global runner registry in `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts:63`. That invites a broader discussion about runtime bootstrap order, runner authority, and agent-tick lifecycle safety. It is a real future slice, but not the safest first one.

### Slice D: Separate recurring enablement from initial activation preparation

Definition:

- extract creation of `AgentScheduler` and startup of its recurring loop into a separate owner
- leave prior startup preparation inline

Evaluation:

- Structural gain: medium
- Semantic risk: medium
- Scope tightness: moderate
- True ownership/composition/boundary cleanup: yes
- Drift risk: medium to high

Why it is not first:

This would help recurring-schedule ownership, but it starts at the back end of the cluster while leaving the front-end activation preparation knot untouched. It also stays coupled to scheduler-start order and runner readiness, so it is not the lowest-risk first cut.

## Chosen Safest First Slice

### Selected boundary

The safest first slice is **extracting daemon-owned activation preparation before recurring enablement**.

More concretely, the first boundary should own exactly:

- startup-time agent loading
- available-agent ID derivation
- main-agent selection
- cron-job reconciliation against the loaded registry
- activation summary data needed for startup logging/reporting

This boundary should be introduced as a daemon-owned startup/activation preparation seam consumed by `SchedulerDaemon.start()`. It should return a narrow result such as:

- loaded registry reference
- selected `mainAgentId`
- activation/reconciliation summary for logging

### Current problematic seam

The current problematic seam is that `SchedulerDaemon.start()` performs the daemon’s agent-activation preparation inline and then later continues into unrelated runtime bring-up and recurring enablement phases in the same method, even though those phases have different ownership and different ordering hazards.

That is visible most clearly in the contiguous `registry.loadAgents(...)` -> `availableAgentIds` -> `resolveMainAgentId(...)` -> `reconcileCronJobsFromRegistry(...)` sequence in `src/scheduler-daemon/daemon.ts:158`.

### What must remain in place for startup-ordering safety

The first cut must preserve all of the following:

- cron reconciliation must still run after agent loading
- `mainAgentId` scoping must still be applied exactly as it is today
- the scheduler must still start before recurring agent dispatch is enabled
- runner registration must still occur before the recurring `AgentScheduler` loop is started
- no change should be made yet to how runtime assembly reads the global registries
- startup logs and warning behavior must remain materially the same

### Why this is the right first cut

This is the right first cut because it isolates a real owner without forcing a new startup choreography.

It also creates a stable seam for later work:

- future runner-registration timing cleanup can consume the same activation-preparation result
- future recurring-enablement cleanup can depend on an already-separated activation-prepared state
- the daemon startup method becomes easier to reason about without pretending to solve the whole bootstrap graph

Most importantly, this slice does not drift into:

- broad bootstrap rewrite
- scheduler redesign
- runner lifecycle redesign
- full daemon lifecycle redesign

## What Is Not Next

The following are explicitly not the next step after Session 131:

- broad bootstrap rewrite across all of `SchedulerDaemon.start()`
- broad runner-registration redesign or replacement of the global runner registry
- full daemon lifecycle redesign
- reopening the paused subagent execution line by default
- broad recurring-scheduler redesign
- broad main-agent semantics redesign
- cosmetic startup helper splitting that only moves log lines without creating a real ownership boundary

## Recommended Session 132

Recommend exactly one next session:

**Session 132 should be one bounded coding session implementing the daemon-owned activation-preparation boundary selected above.**

That session should:

- extract the startup-time agent loading / main-agent selection / cron reconciliation block behind one daemon-owned boundary
- keep scheduler startup, runner registration, recurring-loop enablement, and runtime assembly in their current order
- preserve existing startup logs, warnings, and reconciliation semantics

It should not:

- redesign the runner-registration boundary
- move recurring enablement earlier
- change runtime assembly dependencies
- alter payload shapes or scheduler semantics

## Practical RF-073 Roadmap

1. Phase 1: extract daemon-owned activation preparation as one explicit startup boundary while preserving current order and behavior.
2. Phase 2: reassess whether runner-registration timing now has one bounded ownership slice without reopening broader bootstrap/runtime assembly work.
3. Phase 3: reassess whether recurring-schedule enablement can be separated cleanly from remaining daemon startup choreography.
4. Phase 4: pause the line once no further clearly bounded ownership slice remains.

## Validation

Validation for Session 131 remains documentation-only:

- reviewed the live startup/activation code paths in the files listed above
- verified that this session changes only:
  - `docs/refactoring/session131-rf073-daemon-activation-review.md`
  - `docs/refactoring/ponybunny_refactor_master_task_list.md`
- confirmed no runtime source files were edited in this session
