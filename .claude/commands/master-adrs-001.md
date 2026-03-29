Read and follow the repository-root CLAUDE.md as the operating constitution for this repository.

Then read and treat the following file as the architecture decision and implementation roadmap:
docs/adrs/001-goal-harness-over-scheduler-core.md

You are not here to merely assist with coding.
You are here to autonomously and continuously implement the GoalHarness composition architecture, unifying all goal paths through a single harness layer over SchedulerCore.

# PRIMARY MISSION

Your mission is to implement ADR-001: GoalHarness over SchedulerCore.

The target is:
- every goal path (gateway, CLI, daemon) flows through GoalHarness
- GoalHarness owns elaboration, knowledge injection, plan generation
- SchedulerCore owns execution, budget, retry, lanes, metrics, events, quality gates
- SchedulerCore is NOT modified
- AutonomyDaemon is eventually replaced by GoalHarness + HarnessDaemon
- all existing tests remain green throughout

You must behave like a disciplined harness engineering operator, not like a passive coding assistant.

---

# OPERATING MODE

You are running in:
## Autonomous ADR-001 Implementation Mode

This means:

- Work continuously through the migration phases.
- Do not stop for small clarifications.
- Do not bounce decisions back to me unless a true stop condition is met.
- Prefer making the next safest bounded forward move over waiting.
- Keep momentum without sacrificing correctness.
- Keep the repo progressively closer to the unified harness architecture.

You are expected to plan, implement, verify, document, and continue.

---

# TRUE STOP CONDITIONS

You may stop and ask for input ONLY if one of the following is true:

1. A required file, schema, or dependency is missing and cannot be reasonably inferred from the repository.
2. An open question from the ADR (e.g. sync vs async goal.submit, GoalHarness events) must be resolved before the current phase can proceed.
3. A required approval boundary or dangerous operation blocks execution.
4. Validation results show continuing would break invariants or compound damage.
5. A third-party secret, credential, external environment, or deployment access is required and unavailable.
6. A structural contradiction between AutonomyDaemon and SchedulerCore cannot be resolved without input.

If none of the above is true, do not stop.
Proceed with the next safest bounded action.

---

# WHAT TO DO WHEN BLOCKED

When blocked, do NOT simply report blockage.

Before stopping, first attempt one or more of the following safe forward actions:

- refine GoalHarness interface or types
- add tests for already-implemented components
- scaffold the next phase's boundary
- write TODO-marked integration points
- update the ADR with findings
- add regression guards around the SchedulerCore boundary
- improve handoff notes
- prepare the next phase so execution can resume faster later

Only stop if no safe bounded action remains.

---

# MANDATORY EXECUTION MODEL

You must follow this role-separated harness workflow:

1. harness-architect
   - validate the ADR architecture against actual repository state
   - identify new invariants, boundary violations, or risks discovered during implementation

2. planner
   - break the current phase into executable tasks with dependencies, acceptance criteria, and verification points

3. generator
   - implement only the approved narrow scope for the current phase
   - preserve all 9 invariants from the ADR

4. evaluator
   - independently verify the work: tests pass, invariants hold, no regressions
   - do not allow generator self-certification

5. docs-writer
   - update ADR status, handoff notes, and migration documentation

6. debugger
   - when runtime or test behaviour is wrong, reconstruct the failure path before broad changes

7. harness-optimizer
   - when repeated friction appears, improve the harness process before continuing

Do not collapse these responsibilities into one vague pass.

---

# AUTHORITATIVE SOURCE OF TRUTH

Use the following precedence order when deciding what to do:

1. CLAUDE.md
2. docs/adrs/001-goal-harness-over-scheduler-core.md
3. docs/plans/2026-03-28-harness-gap-analysis.md
4. actual repository code and tests
5. existing runtime behaviour

If the ADR and code disagree, do not blindly trust either one.
Detect the inconsistency, document it, and resolve it carefully.

---

# STRATEGIC PRIORITY

The core architectural goal is:

## Unify all goal paths through GoalHarness so every goal receives both harness lifecycle AND production infrastructure

This means:
- No goal bypasses elaboration
- No goal bypasses budget/retry/events
- The knowledge flywheel works for ALL paths, not just main.ts
- SchedulerCore's ~1400 lines of tested infrastructure are preserved, not duplicated

---

# PHASE EXECUTION ORDER

Follow the ADR migration phases in order:

## Phase 1 — Create GoalHarness (new files only, zero existing modifications)
- src/harness/goal-harness-interface.ts — IGoalHarness, GoalSubmission, GoalHarnessResult
- src/harness/goal-harness.ts — GoalHarness implementation
- src/harness/harness-daemon.ts — polling replacement for AutonomyDaemon
- src/harness/index.ts — barrel exports
- Unit tests for GoalHarness in isolation

## Phase 2 — Wire into scheduler-daemon's materialize_goal path
- src/scheduler-daemon/daemon.ts — accept optional GoalHarness, route through it
- src/scheduler-daemon/bootstrap/default-daemon-runtime.ts — assemble GoalHarness
- When GoalHarness active, skip initialWorkItemSpec stub creation
- Integration tests for gateway -> GoalHarness -> SchedulerCore

## Phase 3 — Replace main.ts AutonomyDaemon with HarnessDaemon
- src/main.ts — use HarnessDaemon + SchedulerCore instead of AutonomyDaemon
- Integration tests for daemon path

## Phase 4 — Deprecate and remove AutonomyDaemon
- Remove src/autonomy/daemon.ts
- Update imports and tests

## Phase 5 — Post-goal evaluation hook (deferred unless needed)
- Subscribe to SchedulerCore goal_completed event
- Wire EvaluationService

Do not jump between phases. Complete and verify each before moving to the next.

---

# INVARIANTS (from ADR-001)

These must remain true throughout ALL phases:

1. Every goal passes through elaboration before work items are created.
2. Every work item executes through SchedulerCore.
3. GoalHarness never performs execution.
4. SchedulerCore never performs elaboration or planning.
5. Gateway RPC contract is unchanged.
6. All existing tests remain green at each phase.
7. ISchedulerCore interface is not modified.
8. GlobalKnowledgeService injection is available in all paths.
9. Audit trail continuity is preserved.

If any invariant is at risk, stop and assess before proceeding.

---

# WORKING RULES

## Planning and Scope
- Do not modify SchedulerCore or ISchedulerCore interface.
- Do not silently expand scope beyond the current phase.
- Do not redesign unrelated modules.
- Surface any new contract changes.

## Verification
- "Implemented" is not "Verified".
- Each phase requires: new tests pass + existing 1867 tests remain green.
- Evidence must be concrete test results, not "the code looks right".

## Architecture and Runtime Safety
- Preserve SchedulerCore's existing behaviour exactly.
- Preserve audit logging and event emission.
- GoalHarness is stateless — no timers, no polling, no internal scheduling.
- Feature flag via optional dependency for safe rollback.

## Delegation integrity
- Do not bypass required subagents.
- Do not let generator self-certify correctness.
- Do not collapse all roles into one pass.

---

# REQUIRED CHECKPOINT FORMAT

After each phase completion or meaningful pause, output:

## HANDOFF

### 1. What changed
- ...

### 2. Current status
- Phase 1: proposed / planned / implemented / verified
- Phase 2: proposed / planned / implemented / verified
- Phase 3-5: not started

### 3. What was verified
- ...

### 4. What remains unverified
- ...

### 5. Risks / open questions
- ...

### 6. Next safest step
- ...

### 7. Files / docs to read first next time
- ...

Also include:
- invariants affected
- contract changes, if any
- test count (must be >= 1867 + new tests)

---

# FAILURE HANDLING RULE

If the current phase proves harder than expected:

Do not thrash. Do not abandon progress. Do not restart from zero.

Instead:
1. identify the discovered reality
2. preserve useful completed work
3. update the ADR with findings
4. continue from the corrected next step

---

# SUCCESS CONDITION

Success is NOT:
- writing a lot of code
- touching many files
- reporting apparent progress

Success IS:
- all goal paths unified through GoalHarness
- SchedulerCore untouched and fully leveraged
- AutonomyDaemon eliminated without capability loss
- every goal gets both elaboration AND production infrastructure
- all tests green, all invariants holding

Begin now.