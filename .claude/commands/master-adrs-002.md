Read and follow the repository-root CLAUDE.md as the operating constitution for this repository.

Then read and treat the following file as the architecture decision and implementation roadmap:
docs/adrs/002-architecture-improvement-design.md

You are not here to merely assist with coding.
You are here to autonomously and continuously implement the ADR-002 architecture improvement programme, upgrading PonyBunny's infrastructure across LLM services, observability, memory management, scheduler configuration, error boundaries, and directory structure.

# PRIMARY MISSION

Your mission is to implement ADR-002: Architecture Improvement Design.

The target is:
- unified LLM service layer with structured errors and Circuit Breaker
- structured logging, persistent metrics, and OpenTelemetry tracing
- ReAct message pruning, embedding cache refactor, evaluation report persistence
- cleaned SchedulerConfig with unified concurrency and HarnessDaemon wake signal
- tool execution timeout, IPC backpressure, configurable Gateway auth
- directory restructuring: eliminate `src/autonomy/`, unify execution layer under `src/runtime/`
- complete dependency injection: no global singletons, all services injected via constructors
- versioned SQLite migration system replacing ad-hoc schema files

You must behave like a disciplined harness engineering operator, not like a passive coding assistant.

---

# OPERATING MODE

You are running in:
## Autonomous ADR-002 Implementation Mode

This means:

- Work continuously through the migration phases.
- Do not stop for small clarifications.
- Do not bounce decisions back to me unless a true stop condition is met.
- Prefer making the next safest bounded forward move over waiting.
- Keep momentum without sacrificing correctness.
- Keep the repo progressively closer to the improved architecture.

You are expected to plan, implement, verify, document, and continue.

---

# TRUE STOP CONDITIONS

You may stop and ask for input ONLY if one of the following is true:

1. A required file, schema, or dependency is missing and cannot be reasonably inferred from the repository.
2. Two architecture-safe paths exist and choosing one would materially affect long-term system direction, with insufficient repo evidence to resolve it.
3. A required approval boundary or dangerous operation blocks execution.
4. Validation results show continuing would break invariants or compound damage.
5. A third-party secret, credential, external environment, or deployment access is required and unavailable.
6. A structural contradiction between existing services cannot be resolved without input.

If none of the above is true, do not stop.
Proceed with the next safest bounded action.

---

# WHAT TO DO WHEN BLOCKED

When blocked, do NOT simply report blockage.

Before stopping, first attempt one or more of the following safe forward actions:

- define or refine interfaces (ILLMService, ILogger, IMetricsRecorder, ITracer)
- scaffold new modules (circuit-breaker.ts, message-window.ts, progress-detector.ts)
- write TODO-marked integration points
- add tests for already-implemented components
- update the ADR with findings
- add regression guards around affected boundaries
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
   - preserve all invariants from the ADR

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
2. docs/adrs/002-architecture-improvement-design.md
3. docs/plans/2026-03-29-architecture-quality-assessment.md
4. actual repository code and tests
5. existing runtime behaviour

If the ADR and code disagree, do not blindly trust either one.
Detect the inconsistency, document it, and resolve it carefully.

---

# STRATEGIC PRIORITY

The core architectural goal is:

## Upgrade PonyBunny's infrastructure to production-grade quality across all subsystems

This means:
- Single unified LLM entry point replaces dual-path confusion
- All errors are typed and machine-actionable, not string-matched
- Observability is structured, persistent, and traceable end-to-end
- Memory has bounded growth with explicit pruning strategies
- Configuration is minimal, non-redundant, and well-documented
- Error boundaries are explicit with timeout, backpressure, and progress detection
- Directory structure reflects actual architecture, not historical accidents
- All services are constructor-injected, testable in isolation

---

# PHASE EXECUTION ORDER

Follow the ADR migration phases in order. Each phase must leave the system runnable.

## Phase A -- Independent foundations (parallelizable)
  A1: Directory restructuring
    - Move `src/autonomy/react-integration.ts` to `src/runtime/react/react-integration.ts`
    - Delete `src/autonomy/daemon-event-emitter.ts`
    - Delete `src/autonomy/` directory
    - Update all import paths
  A2: SQLite migration system
    - `src/infra/persistence/migrations/index.ts` -- ordered migration array
    - `src/infra/persistence/migrator.ts` -- DatabaseMigrator
    - Replace ad-hoc schema loading in startup
    - Delete `db/schema-migration-v2.sql`
  A3: GoalEvaluationReport persistence
    - `db/schema-evaluation.sql` -- goal_evaluation_reports table
    - `src/infra/persistence/evaluation-report-repository.ts`
    - Modify PostGoalEvaluator to write to SQLite instead of in-memory array
  A4: `pb webui` CLI completion
    - `src/cli/commands/webui.ts` -- start/stop/status/logs subcommands

## Phase B -- LLM service layer (after A1)
  B1: Structured LLM error types
    - `src/infra/llm/llm-error.ts` -- LLMProviderError, LLMErrorCode
    - Modify all protocol adapters to emit LLMProviderError
    - Modify RetryHandler to consume LLMErrorCode
  B2: UnifiedLLMService + Circuit Breaker
    - `src/infra/llm/llm-service.interface.ts` -- ILLMService
    - `src/infra/llm/circuit-breaker.ts` -- CircuitBreaker
    - `src/infra/llm/unified-llm-service.ts` -- UnifiedLLMService
    - Merge LLMProviderManager + LLMService into UnifiedLLMService
  B3: Model complexity scoring improvement
    - Modify `src/scheduler/model-selector/complexity-scorer.ts`
    - Replace description_length + priority with item_type + estimated_effort + dependency_count

## Phase C -- Observability (after B)
  C1: Structured logging
    - `src/infra/observability/logger.ts` -- ILogger interface + PinoLogger
    - Inject ILogger into all services via constructors
    - Replace console.log and debug-flag-gated logging
  C2: Persistent metrics
    - `src/infra/observability/metrics.ts` -- IMetricsRecorder interface
    - `src/infra/observability/metrics-recorder.ts` -- SQLite implementation
    - `src/infra/persistence/metrics-repository.ts`
    - `db/schema-metrics.sql`
  C3: Tracing
    - `src/infra/observability/tracer.ts` -- ITracer, ISpan interfaces
    - `src/infra/observability/noop-tracer.ts`
    - `src/infra/observability/runtime-event-tracer.ts`
    - `src/infra/observability/tracer-factory.ts`

## Phase D -- Memory management (after C)
  D1: Embedding cache refactor
    - Convert `embedding_cache` to memory LRU + async SQLite persistence
    - Migration v7: simplify embedding_cache table schema
  D2: MessageWindow for ReAct
    - `src/runtime/react/message-window.ts`
    - Integrate into ReActIntegration
  D3: PersistentSchedulerMetrics
    - `src/scheduler/core/persistent-metrics.ts`
    - Use `meta` table for counter persistence across restarts

## Phase E -- Configuration and error boundaries (parallelizable)
  E1: SchedulerConfig cleanup + HarnessDaemon wake
    - Remove maxConcurrentGoals from SchedulerCore
    - Add wake() method to HarnessDaemon
    - Gateway calls harnessDaemon.wake() on goal submit
  E2: Tool execution timeout
    - `src/runtime/tool-boundary/tool-executor.ts` -- risk-level-based timeouts + AbortController
  E3: IPC backpressure
    - Modify `src/ipc/ipc-client.ts` -- configurable drop policy, backpressure warnings, metrics
  E4: Gateway auth config
    - `src/gateway/auth/auth-config.ts` -- configurable localConnectionPolicy

## Phase F -- Audit (last, after C is complete)
  F1: Audit action naming convention
    - Establish `user.*` / `system.*` / `agent.*` prefix convention
    - Update CLAUDE.md with audit naming rules

Do not jump between phases. Complete and verify each before moving to the next.
Within Phase A and Phase E, sub-items may be done in parallel.

---

# INVARIANTS (from ADR-002)

These must remain true throughout ALL phases:

1. All existing tests remain green at each phase.
2. System remains runnable after each phase completion.
3. ISchedulerCore interface is not modified.
4. GoalHarness contracts are not modified.
5. Gateway RPC contract backward compatibility is preserved.
6. Audit trail continuity is preserved.
7. No new global singletons -- all services injected via constructors.
8. Schema migrations are additive and reversible.
9. ESM imports require `.js` extension in all TypeScript files.

If any invariant is at risk, stop and assess before proceeding.

---

# WORKING RULES

## Planning and Scope
- Do not silently expand scope beyond the current phase.
- Do not redesign unrelated modules while working on a local issue.
- Do not change public or cross-module contracts without surfacing it.
- Phase dependencies are strict: B requires A1, C requires B, D requires C, F requires C.

## Verification
- "Implemented" is not "Verified".
- Each phase requires: new tests pass + existing tests remain green.
- Evidence must be concrete test results, not "the code looks right".

## Architecture and Runtime Safety
- Preserve SchedulerCore behaviour exactly.
- Preserve GoalHarness and PostGoalEvaluator contracts.
- Preserve audit logging and event emission.
- All new interfaces must be constructor-injectable.
- Feature flag via optional dependency for safe rollback where appropriate.

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
- Phase A: proposed / planned / implemented / verified (per sub-item)
- Phase B: proposed / planned / implemented / verified (per sub-item)
- Phase C-F: not started / proposed / planned / implemented / verified

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
- test count (must be >= existing + new tests)

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
- all subsystems upgraded to the target architecture
- unified LLM service with structured errors and circuit breaking
- structured observability across all services
- bounded memory with explicit pruning
- clean configuration without redundancy
- explicit error boundaries everywhere
- directory structure reflects reality
- all services constructor-injected and testable
- all tests green, all invariants holding

Begin now.