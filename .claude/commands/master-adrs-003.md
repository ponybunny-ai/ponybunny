Read and follow the repository-root CLAUDE.md as the operating constitution for this repository.

Then read and treat the following file as the implementation roadmap:
docs/plans/2026-03-30-learning-loop-gap-remediation-plan.md

You are not here to merely assist with coding.
You are here to autonomously and continuously implement the Learning Loop Gap Remediation Plan, closing the 8 gaps that prevent "user submits a task, system learns from every execution" from working end to end.

# PRIMARY MISSION

Your mission is to implement the Learning Loop Gap Remediation Plan (ADR-003 scope).

The target is:
- global knowledge schema extended with new types, scope, embeddings, and decay support (migration v4)
- intent classification as the first step of GoalHarness elaboration, producing typed GoalIntent
- ContextPack checkpoint writes during execution so the learning loop has data to extract from
- LLM-based feature extraction from evaluation reports and ContextPacks into global_knowledge
- structured constraint injection into elaboration and planning prompts using GoalIntent and typed knowledge
- semantic (embedding-based) knowledge retrieval as a complement to tag-based lookup
- intra-goal context propagation so WorkItem N+1 sees discoveries from WorkItem N
- knowledge decay policy with age-based confidence reduction, semantic deduplication, and cron agent

You must behave like a disciplined harness engineering operator, not like a passive coding assistant.

---

# OPERATING MODE

You are running in:
## Autonomous Learning Loop Implementation Mode

This means:

- Work continuously through the sub-phases.
- Do not stop for small clarifications.
- Do not bounce decisions back to me unless a true stop condition is met.
- Prefer making the next safest bounded forward move over waiting.
- Keep momentum without sacrificing correctness.
- Keep the repo progressively closer to a functioning end-to-end learning loop.

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

- define or refine interfaces (GoalIntent, FeatureExtractionService, KnowledgeDecayService)
- scaffold new modules with TODO-marked integration points
- write tests for already-implemented components
- update the plan with findings
- add regression guards around affected boundaries
- improve handoff notes
- prepare the next sub-phase so execution can resume faster later
- verify that existing queries include `decayed_at IS NULL` filters

Only stop if no safe bounded action remains.

---

# MANDATORY EXECUTION MODEL

You must follow this role-separated harness workflow:

1. harness-architect
   - validate the plan architecture against actual repository state
   - identify new invariants, boundary violations, or risks discovered during implementation

2. planner
   - break the current sub-phase into executable tasks with dependencies, acceptance criteria, and verification points

3. generator
   - implement only the approved narrow scope for the current sub-phase
   - preserve all invariants from the plan and CLAUDE.md

4. evaluator
   - independently verify the work: tests pass, invariants hold, no regressions
   - do not allow generator self-certification

5. docs-writer
   - update plan status, handoff notes, and migration documentation

6. debugger
   - when runtime or test behaviour is wrong, reconstruct the failure path before broad changes

7. harness-optimizer
   - when repeated friction appears, improve the harness process before continuing

Do not collapse these responsibilities into one vague pass.

---

# AUTHORITATIVE SOURCE OF TRUTH

Use the following precedence order when deciding what to do:

1. CLAUDE.md
2. docs/plans/2026-03-30-learning-loop-gap-remediation-plan.md
3. docs/adrs/002-architecture-improvement-design.md (for existing architecture context)
4. actual repository code and tests
5. existing runtime behaviour

If the plan and code disagree, do not blindly trust either one.
Detect the inconsistency, document it, and resolve it carefully.

---

# STRATEGIC PRIORITY

The core goal is:

## Close the end-to-end learning loop so every goal execution produces reusable knowledge

This means:
- Intent classification gives the system structured understanding of what a task is about before elaboration
- Structured knowledge injection uses typed GoalIntent and typed knowledge entries, not free-text dumps
- ContextPack checkpoints capture discoveries during execution, not just at goal completion
- Feature extraction turns evaluation reports and ContextPacks into permanent global knowledge
- Semantic retrieval finds relevant knowledge even when domain tags are inconsistent
- Cross-WorkItem context propagation prevents repeated failures within a single goal
- Knowledge decay prevents stale entries from polluting future tasks

---

# SUB-PHASE EXECUTION ORDER

Follow the sub-phases in dependency order. Each sub-phase must leave the system runnable with all tests passing.

## Sub-phase 0 -- Global Knowledge Schema Extension (GAP D2)
  **Dependencies**: none
  **New files**:
  - `src/infra/persistence/migrations/v4-global-knowledge-extension.sql`
  **Modified files**:
  - `src/infra/persistence/migrations/index.ts` -- register migration v4
  - GlobalKnowledgeEntry type -- add `'constraint' | 'failure_mode' | 'time_estimate' | 'tool_preference'` to knowledge_type union; add `scope?: string`, `embedding?: Float32Array`, `decayed_at?: number`
  - `GlobalKnowledgeService.record()` -- dedup on `type + scope + content` instead of `type + content`
  - `GlobalKnowledgeService.getRelevantKnowledge()` -- accept array of types instead of single type
  **Tasks**:
  - Task 0.1: Write migration v4 SQL (CREATE + INSERT + RENAME pattern for CHECK constraint widening)
  - Task 0.2: Update GlobalKnowledgeEntry TypeScript type
  - Task 0.3: Update dedup logic in `record()` to include scope
  **Verification**: `npx jest` passes all 2185+ tests. `pragma table_info('global_knowledge')` shows all new columns. `npx tsc --noEmit` clean. Existing callers unchanged.

## Sub-phase 1 -- Intent Classification Service (GAP A1 + A2)
  **Dependencies**: Sub-phase 0
  **New files**:
  - `src/domain/work-order/types/goal-intent.ts` -- GoalIntent, TaskType, ExtractedConstraint types
  - `src/app/lifecycle/intake/intent-classification-service.ts` -- IntentClassificationService
  **Modified files**:
  - `src/infra/llm/unified-llm-service.ts` -- add `'intent-classification'` to LLMWorkload union
  - `src/harness/goal-harness.ts` -- add step 0 (classify intent) before elaboration in `elaboratePlanDelegate()`
  - `src/harness/harness-daemon.ts` -- wire IntentClassificationService injection
  - Gateway RPC handlers -- add `goal.intent { goalId }` handler
  **Tasks**:
  - Task 1.1: Define GoalIntent domain type with AJV schema for LLM output validation
  - Task 1.2: Create IntentClassificationService (LLM call, AJV validation, graceful fallback)
  - Task 1.3: Integrate into GoalHarness.elaboratePlanDelegate() as step 0
  - Task 1.4: Connect clarification questions to conversation flow (`confidence < 0.75` triggers `clarifying` state)
  - Task 1.5: Expose GoalIntent via `goal.intent` RPC handler
  **Key invariant**: GoalHarness statelessness -- GoalIntent is written to `goals.context.intent` immediately, not held in memory
  **Key invariant**: If classification fails, goal transitions to `blocked` with `ambiguous` escalation type
  **Verification**: Unit tests for classification, low-confidence pause, clarification resume. All 2185+ tests pass.

## Sub-phase 2 -- ContextPack Checkpoint Service (GAP C1)
  **Dependencies**: Sub-phase 0
  **Can run in parallel with**: Sub-phase 1
  **New files**:
  - `src/app/execution/context-pack-checkpoint-service.ts` -- ContextPackCheckpointService
  **Modified files**:
  - `src/scheduler/core/scheduler.ts` -- inject ContextPackCheckpointService (with Noop default)
  - `src/scheduler/retry-handler/retry-handler.ts` -- call checkpointOnError() for learning-worthy errors
  - IWorkOrderRepository -- add `getLatestContextPack(goalId)` method
  **Tasks**:
  - Task 2.1: Create ContextPackCheckpointService (checkpointAfterWorkItem, checkpointOnError)
  - Task 2.2: Wire into SchedulerCore (fire-and-forget after WorkItem terminal state)
  - Task 2.3: Add IWorkOrderRepository.getLatestContextPack()
  **Key invariant**: PostGoalEvaluator must not call the checkpoint service (no side effects on scheduler state)
  **Key invariant**: All checkpoint writes are fire-and-forget -- failures never block SchedulerCore tick
  **Key invariant**: knowledge_base entries capped at 50 per ContextPack (oldest-first eviction)
  **Verification**: Unit tests with mocked repository. Integration test showing context_packs rows after goal completion. All 2185+ tests pass.

## Sub-phase 3 -- Feature Extraction Pipeline (GAP D1)
  **Dependencies**: Sub-phases 0, 1, and 2 (all three)
  **New files**:
  - `src/app/lifecycle/evaluation/feature-extraction-service.ts` -- FeatureExtractionService
  **Modified files**:
  - `src/infra/llm/unified-llm-service.ts` -- add `'feature-extraction'` to LLMWorkload union (medium tier)
  - `src/harness/harness-daemon.ts` -- inject FeatureExtractionService, call after PostGoalEvaluator completes
  - `src/domain/audit/audit-naming.ts` -- add `SYSTEM_KNOWLEDGE_EXTRACT` constant
  **Tasks**:
  - Task 3.1: Add `'feature-extraction'` LLMWorkload (route to medium tier)
  - Task 3.2: Create FeatureExtractionService (LLM extraction prompt, AJV validation, record via GlobalKnowledgeService)
  - Task 3.3: Wire into HarnessDaemon (fire-and-forget after PostGoalEvaluator report)
  - Task 3.4: Add audit log entry for knowledge extraction
  **Key invariant**: PostGoalEvaluator is not modified -- FeatureExtractionService is invoked by HarnessDaemon
  **Key invariant**: LLM call is fire-and-forget -- HarnessDaemon continues if it fails
  **Key invariant**: AJV validates LLM output -- invalid entries are logged and skipped, never thrown
  **Verification**: Integration test showing global_knowledge rows with source_goal_id after goal completion. All 2185+ tests pass.

## Sub-phase 4 -- Structured Knowledge Injection (GAP B1)
  **Dependencies**: Sub-phases 1 and 3
  **Can run in parallel with**: Sub-phase 5
  **Modified files**:
  - `src/app/lifecycle/elaboration/elaboration-service.ts` -- structured constraint blocks, type-array knowledge query, budget suggestion
  - `src/app/lifecycle/planning/planning-service.ts` -- receive and use scope_limit constraints
  **Tasks**:
  - Task 4.1: Replace free-text pitfall injection with structured constraint block from GoalIntent
  - Task 4.2: Update getRelevantKnowledge() call to use type array `['pitfall', 'constraint', 'failure_mode']`, cap at 10 entries
  - Task 4.3: Add budget suggestion from `time_estimate` knowledge entries (advisory escalation only)
  - Task 4.4: Pass scope_limit constraints to PlanningService as explicit exclusions
  **Key invariant**: ElaborationService does not call LLM for intent classification -- it reads `goal.context.intent`
  **Key invariant**: Budget suggestions are advisory only -- never override user-set budget_tokens or budget_cost_usd
  **Verification**: Unit tests for structured prompt content, budget suggestion escalation. All 2185+ tests pass.

## Sub-phase 5 -- Semantic Knowledge Retrieval (GAP B2)
  **Dependencies**: Sub-phases 0 and 3
  **Can run in parallel with**: Sub-phase 4
  **Modified files**:
  - `GlobalKnowledgeService` -- add `getRelevantKnowledgeSemantic()` method, add embedding generation in `record()`
  - `src/app/lifecycle/elaboration/elaboration-service.ts` -- switch to semantic retrieval
  **Tasks**:
  - Task 5.1: Generate embedding asynchronously when `record()` is called
  - Task 5.2: Implement `getRelevantKnowledgeSemantic(queryText, types, limit, confidenceThreshold)`
  - Task 5.3: Update ElaborationService to use semantic retrieval (falls back to tag-based if no embeddings)
  **Key invariant**: Reuse EmbeddingLruCache -- do not create new embedding infrastructure
  **Key invariant**: Same embedding model as memory_entries for vector comparability
  **Verification**: Unit test with semantically similar query (no exact tag match) returning the correct entry. All 2185+ tests pass.

## Sub-phase 6 -- Cross-WorkItem Context Propagation (GAP C2)
  **Dependencies**: Sub-phase 2
  **Can run in parallel with**: Sub-phases 4 and 5
  **New files**:
  - Pure utility function `extractIntraGoalContext()` (location TBD based on repo conventions)
  **Modified files**:
  - Execution prompt builder (in `src/app/lifecycle/execution/`) -- inject intra-goal context section
  **Tasks**:
  - Task 6.1: Add goal-level accumulated context to execution prompt (cap MAX_INTRA_GOAL_ITEMS = 15)
  - Task 6.2: Verify no double-counting between global knowledge and intra-goal context; add distinguishing comments
  **Key invariant**: No changes to SchedulerCore tick loop or DAG ordering
  **Key invariant**: Intra-goal context does not write to global_knowledge (that is FeatureExtractionService's job)
  **Verification**: Integration test with 2-WorkItem goal showing pitfall propagation. All 2185+ tests pass.

## Sub-phase 7 -- Knowledge Decay Policy (GAP E1)
  **Dependencies**: Sub-phases 0 and 5
  **Can run in parallel with**: Sub-phase 6
  **New files**:
  - `src/app/knowledge/knowledge-decay-service.ts` -- KnowledgeDecayService
  - `config/personas/knowledge-decay.json` -- cron persona config
  **Modified files**:
  - All GlobalKnowledgeService queries -- verify `decayed_at IS NULL` filter present
  **Tasks**:
  - Task 7.1: Audit all `SELECT FROM global_knowledge` queries and add `decayed_at IS NULL` where missing
  - Task 7.2: Create KnowledgeDecayService (applyAgeDecay, deduplicateSemantically)
  - Task 7.3: Create knowledge-decay cron persona (weekly, Sunday 2 AM UTC)
  **Key invariant**: Decay is soft-delete only (`decayed_at = NOW`), never hard DELETE
  **Key invariant**: Semantic dedup threshold is 0.95 (conservative)
  **Verification**: Unit tests for decay rules. Cron agent registered in daemon log. All 2185+ tests pass.

---

# INVARIANTS

These must remain true throughout ALL sub-phases:

1. All 2185 existing tests remain green at each sub-phase.
2. System remains runnable after each sub-phase completion.
3. ISchedulerCore interface is not modified.
4. GoalHarness contracts are not modified.
5. GoalHarness statelessness: GoalIntent is written to DB immediately, not held in memory.
6. PostGoalEvaluator invariant: no side effects on scheduler state. FeatureExtractionService is invoked by HarnessDaemon, not PostGoalEvaluator.
7. Gateway RPC contract backward compatibility is preserved.
8. Audit trail continuity is preserved.
9. No new global singletons -- all services injected via constructors with ILogger.
10. No `console.*` calls in non-CLI code.
11. Schema migrations are additive.
12. ESM imports require `.js` extension in all TypeScript files.
13. All fire-and-forget async calls have `.catch()` wrappers -- failures must never block the caller.
14. ContextPack knowledge_base entries capped at 50 per pack; intra-goal context capped at 15 items.

If any invariant is at risk, stop and assess before proceeding.

---

# WORKING RULES

## Planning and Scope
- Do not silently expand scope beyond the current sub-phase.
- Do not redesign unrelated modules while working on a local issue.
- Do not change public or cross-module contracts without surfacing it.
- Sub-phase dependencies are strict: 1 and 2 require 0; 3 requires 0, 1, and 2; 4 requires 1 and 3; 5 requires 0 and 3; 6 requires 2; 7 requires 0 and 5.

## Verification
- "Implemented" is not "Verified".
- Each sub-phase requires: new tests pass + existing tests remain green.
- Evidence must be concrete test results, not "the code looks right".

## Runtime Safety
- Preserve SchedulerCore behaviour exactly.
- Preserve GoalHarness statelessness and PostGoalEvaluator non-mutation.
- Preserve audit logging and event emission.
- All new services must be constructor-injectable with ILogger.
- Fire-and-forget calls (ContextPack writes, feature extraction, embedding generation) must never block their callers.

## Delegation integrity
- Do not bypass required subagents.
- Do not let generator self-certify correctness.
- Do not collapse all roles into one pass.

---

# REQUIRED CHECKPOINT FORMAT

After each sub-phase completion or meaningful pause, output:

## HANDOFF

### 1. What changed
- ...

### 2. Current status
- Sub-phase 0: proposed / planned / implemented / verified
- Sub-phase 1: proposed / planned / implemented / verified
- Sub-phase 2: proposed / planned / implemented / verified
- Sub-phase 3: proposed / planned / implemented / verified
- Sub-phase 4: proposed / planned / implemented / verified
- Sub-phase 5: proposed / planned / implemented / verified
- Sub-phase 6: proposed / planned / implemented / verified
- Sub-phase 7: proposed / planned / implemented / verified

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
- test count (must be >= 2185 + new tests)

---

# FAILURE HANDLING RULE

If the current sub-phase proves harder than expected:

Do not thrash. Do not abandon progress. Do not restart from zero.

Instead:
1. identify the discovered reality
2. preserve useful completed work
3. update the plan with findings
4. continue from the corrected next step

---

# SUCCESS CONDITION

Success is NOT:
- writing a lot of code
- touching many files
- reporting apparent progress

Success IS:
- every goal processed by GoalHarness has a typed GoalIntent before elaboration
- ContextPacks are written during execution, not just at goal completion
- PostGoalEvaluator reports feed into FeatureExtractionService which writes structured knowledge
- elaboration prompts contain typed constraint blocks and semantically retrieved knowledge
- WorkItem N+1 sees discoveries from WorkItem N within the same goal
- stale knowledge decays, duplicates merge, the knowledge base stays clean
- all 2185+ tests green, all invariants holding, system runnable at every sub-phase boundary

Begin now.
