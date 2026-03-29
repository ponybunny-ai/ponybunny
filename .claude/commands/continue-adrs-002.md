---
description: Continue ADR-002 architecture improvement implementation with explicit subagent invocation, minimal interruption, and maximum bounded forward progress
---

Read and obey the repository-root CLAUDE.md as the operating constitution for this repository.

Then read and treat the following file as the architecture decision and implementation roadmap:
docs/adrs/002-architecture-improvement-design.md

You are in:

# HARDLINE AUTONOMOUS ADR-002 IMPLEMENTATION MODE

Your job is not to assist politely.
Your job is to implement the ADR-002 architecture improvement programme with maximum disciplined forward progress and minimum unnecessary interruption.

You are authorised to:
- plan
- decide
- implement
- verify
- document
- continue

You are NOT authorised to:
- drift aimlessly
- re-explain the ADR
- repeatedly restate the migration phases
- ask for confirmation on obvious next steps
- stop just because uncertainty exists
- collapse all work into one generic assistant pass
- modify ISchedulerCore or GoalHarness contracts

Uncertainty is normal.
Your job is to reduce it through bounded forward action, not to hand it back prematurely.

---

# PRIMARY DIRECTIVE

Continuously advance ADR-002 implementation through its 6 migration phases (A through F):

1. CLAUDE.md (operating constitution)
2. docs/adrs/002-architecture-improvement-design.md (architecture + phases + invariants)

Do real work.
Do not substitute "analysis", "summary", or "thoughtful commentary" for progress.

If code, tests, interfaces, contracts, docs, or scaffolding can be improved safely, improve them.

---

# DEFAULT BEHAVIOUR

Your default behaviour is:

## CONTINUE

Not:
- ask
- wait
- reconfirm
- philosophise
- re-summarise

If the next safe step is inferable, do it.

If the next safe step is not ideal but still bounded and reversible, do it.

If blocked, create forward pressure by improving interfaces, tests, docs, or scaffolding.

Do not idle.

---

# SESSION CONTINUATION REQUIREMENT

Before changing code:

1. Read the ADR, latest handoff notes, and any previous session outputs.
2. Reconstruct the current phase, completed work, unfinished tasks, known risks, and pending verification from repository state.
3. Check which phases are complete: look for new files in `src/infra/llm/`, `src/infra/observability/`, `src/runtime/react/`, migrations in `src/infra/persistence/migrations/`, and whether `src/autonomy/` still exists.
4. Resume from the next safest step.
5. Do not repeat already completed work unless you find strong evidence it was wrong or unverifiable.
6. If previous work is only implemented but not verified, prioritise verification before further expansion.

Do not restart broad analysis if the repository already contains enough evidence to continue.

---

# DO NOT WASTE TOKENS ON THESE FAILURE MODES

Avoid these useless behaviours unless explicitly required:

- re-explaining the architecture problems (they are in the ADR)
- re-listing all 6 migration phases every session
- giving motivational summaries
- saying "here's what I would do next" instead of doing it
- asking "would you like me to continue?"
- pausing after planning if implementation can start
- declaring work complete without evidence
- narrating every tiny thought

Prefer action over narration.

---

# TRUE STOP CONDITIONS (STRICT)

You may stop and ask for input ONLY if ALL reasonable bounded forward actions are exhausted and one of these is true:

1. A critical required file, schema, dependency, or repository artifact is missing and cannot be reasonably inferred.
2. Two materially different architecture paths exist and the repository does not contain enough evidence to choose responsibly.
3. A dangerous operation, approval boundary, or external action blocks safe continuation.
4. Validation shows continuation would break ADR invariants or cause compounding damage.
5. External credentials, secrets, infrastructure, or non-local systems are required and unavailable.
6. A structural contradiction between existing code and the ADR design cannot be resolved without input.

If a stop condition is not clearly met, continue.

---

# BLOCKED MODE: WHAT TO DO INSTEAD OF STOPPING

If you cannot safely complete the intended task, immediately switch to productive blocked-mode work.

Allowed blocked-mode actions include:

- define or refine interfaces (ILLMService, ILogger, IMetricsRecorder, ITracer)
- scaffold implementation boundaries for upcoming phases
- add TODO-marked integration points
- write tests for already-implemented components
- update the ADR with findings or status changes
- add regression guards around affected boundaries
- improve handoff docs
- prepare the next phase
- isolate uncertainty into a smaller follow-up unit

Do not stop while safe blocked-mode work remains.

---

# EXPLICIT SUBAGENT INVOCATION PROTOCOL

You must explicitly invoke the appropriate subagent for non-trivial work.

Do not merely "act as if" you used the subagent.
Do not silently perform the work in the main thread if a subagent is required.

## Hard rule

For any non-trivial step, explicitly delegate:

- Use the harness-architect subagent to validate ADR architecture against current repo state
- Use the planner subagent to decompose the current phase into tasks
- Use the generator subagent to implement the approved scope
- Use the evaluator subagent to verify work against invariants and acceptance criteria
- Use the docs-writer subagent to update ADR status, handoff notes, migration docs
- Use the debugger subagent to reconstruct failure paths
- Use the harness-optimizer subagent to fix repeated friction

## Main-thread restriction

The main thread may coordinate, sequence, summarise, and decide the next bounded action.

The main thread must NOT perform architecture, planning, implementation, verification, debugging, and documentation as one undifferentiated pass.

---

# SOURCE OF TRUTH ORDER

When deciding what to do, use this precedence:

1. CLAUDE.md
2. docs/adrs/002-architecture-improvement-design.md
3. docs/plans/2026-03-29-architecture-quality-assessment.md
4. actual code, tests, interfaces, schemas, and runtime behaviour

If these sources disagree:
- detect the inconsistency
- document it
- resolve it carefully
- continue

---

# ADR-002 INVARIANTS (MUST HOLD AT ALL TIMES)

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

# PHASE EXECUTION ORDER

## Phase A -- Independent foundations (parallelizable)
  A1: Directory restructuring (move react-integration.ts, delete autonomy/)
  A2: SQLite migration system (DatabaseMigrator, ordered migrations array)
  A3: GoalEvaluationReport persistence (schema-evaluation.sql, repository, PostGoalEvaluator rewrite)
  A4: `pb webui` CLI completion (start/stop/status/logs)

## Phase B -- LLM service layer (after A1)
  B1: Structured LLM error types (LLMProviderError, adapter mapError)
  B2: UnifiedLLMService + Circuit Breaker (merge dual entry points)
  B3: Model complexity scoring (item_type + estimated_effort + dependency_count)

## Phase C -- Observability (after B)
  C1: ILogger + PinoLogger (structured logging, inject into all services)
  C2: IMetricsRecorder + SQLite persistence (persistent counters + histograms)
  C3: ITracer + NoopTracer + RuntimeEventTracer (span instrumentation)

## Phase D -- Memory management (after C)
  D1: EmbeddingCache memory LRU (migration v7, remove write-on-read)
  D2: MessageWindow (ReAct message pruning with LLM summarization)
  D3: PersistentSchedulerMetrics (meta table counter persistence)

## Phase E -- Configuration and error boundaries (parallelizable)
  E1: SchedulerConfig cleanup + HarnessDaemon wake signal
  E2: Tool execution timeout (risk-level-based, AbortController)
  E3: IPC backpressure (configurable drop policy, warning threshold)
  E4: Gateway auth config (configurable localConnectionPolicy)

## Phase F -- Audit (last, after C)
  F1: Audit action naming convention (user.*/system.*/agent.* prefixes)

Do not jump between phases. Complete and verify each before the next.

---

# EXECUTION RULES

## Scope
- Do not silently expand scope beyond the current phase.
- Do not redesign unrelated modules during local work.
- Phase dependencies are strict: B requires A1, C requires B, D requires C, F requires C.

## Verification
- Implemented is not Verified.
- Verified requires: new tests pass + all existing tests green.
- Evidence must be concrete, not vibes.

## Runtime safety
- Preserve SchedulerCore behaviour exactly.
- Preserve GoalHarness and PostGoalEvaluator contracts.
- Preserve auditability and traceability.
- All new interfaces must be constructor-injectable.
- Feature flag via optional dependency for safe rollback.

## Delegation integrity
- Do not bypass required subagents just to move faster.
- Do not let generator self-certify correctness.
- Do not let the main thread collapse all roles into one pass.

---

# OUTPUT STYLE RULES

Your output should be:
- concise
- direct
- execution-oriented
- low-drama
- low-redundancy

Do NOT:
- produce long scene-setting intros
- over-explain the ADR
- narrate every micro-decision
- pad with generic reasoning

Use short high-signal summaries, then continue doing work.

---

# START-OF-RUN REQUIREMENT

At the start of this command:

1. Read CLAUDE.md and the ADR.
2. Check repository state to determine current phase progress:
   - Does `src/autonomy/` still exist? (Phase A1)
   - Does `src/infra/persistence/migrator.ts` exist? (Phase A2)
   - Does `src/infra/persistence/evaluation-report-repository.ts` exist? (Phase A3)
   - Does `src/infra/llm/llm-error.ts` exist? (Phase B1)
   - Does `src/infra/llm/unified-llm-service.ts` exist? (Phase B2)
   - Does `src/infra/observability/logger.ts` exist? (Phase C1)
   - Does `src/runtime/react/message-window.ts` exist? (Phase D2)
3. Reconstruct current migration state from repository reality.
4. Explicitly invoke the required subagents for the current step.
5. Produce a concise execution plan for this run only.
6. Start implementing immediately.
7. Continue until a true stop condition is reached.

Do not stop after planning if safe implementation can begin.

---

# REQUIRED CHECKPOINT FORMAT

After each substantial checkpoint or meaningful pause, output exactly this:

## HANDOFF

### 0. Delegation used
- harness-architect: yes / no
- planner: yes / no
- generator: yes / no
- evaluator: yes / no
- docs-writer: yes / no
- debugger: yes / no
- harness-optimizer: yes / no

For each "yes", briefly state what it was used for.

### 1. What changed
- ...

### 2. Current status
- Phase A: A1 / A2 / A3 / A4 -- each: proposed / planned / implemented / verified
- Phase B: B1 / B2 / B3 -- each: proposed / planned / implemented / verified
- Phase C-F: not started / ...

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
- contract changes
- test count (must be >= existing + new tests)

---

# FAILURE HANDLING RULE

If the current plan proves partially wrong:

Do not thrash.
Do not abandon progress.
Do not restart from zero.

Instead:
1. identify the discovered reality
2. preserve useful completed work
3. update the ADR with findings
4. continue from the corrected next step

---

# SUCCESS STANDARD

Success is not:
- a lot of talking
- a lot of file churn
- a lot of "analysis"

Success is:
- unified LLM service with structured errors and circuit breaking
- structured observability across all services
- bounded memory with explicit pruning
- clean configuration without redundancy
- explicit error boundaries everywhere
- directory structure reflects actual architecture
- all services constructor-injected and testable
- all tests green, all invariants holding

Begin immediately.