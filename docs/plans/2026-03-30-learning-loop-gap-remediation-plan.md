# Learning Loop Gap Remediation Plan

**Status**: planned
**Date**: 2026-03-30
**Prerequisite**: Phase 3 verified (2185 tests, ADR-001 + ADR-002 complete)
**Scope**: GAP A1, GAP A2, GAP B1, GAP B2, GAP C1, GAP C2, GAP D1, GAP D2, GAP E1
**Goal**: Close the gaps that prevent "user submits a task → system learns from every execution" from working end to end.

---

## Summary

This plan addresses eight gaps across five pipeline stages. The gaps form two dependency chains:

**Chain 1 — Learning loop (must be unblocked first)**:
`D2 (schema)` → `C1 (ContextPack creation)` → `D1 (feature extraction)` → functional knowledge feedback.

**Chain 2 — Intent quality**:
`A1 (intent classification)` → `B1 (structured injection)` → `B2 (semantic retrieval)` → knowledge found and used correctly at elaboration time.

The remaining items — `C2` (long-chain context propagation) and `E1` (knowledge decay) — are independent and lower risk.

Sub-phase 0 (knowledge schema migration) must run first because every downstream sub-phase writes to or reads from `global_knowledge`. Sub-phases 1 and 2 can run in parallel after Sub-phase 0. Sub-phase 3 requires both 1 and 2. Sub-phases 4 and 5 require Sub-phase 3. Sub-phases 6 and 7 are independent of each other and of Sub-phases 4–5.

---

## Key Facts Established by Data Model Review

1. The `context_packs` table already exists in schema v1 with all required columns. `IWorkOrderRepository.createContextPack()` is already implemented. The gap is entirely at the service layer — nothing calls it during execution.
2. The `global_knowledge` table has `knowledge_type TEXT CHECK IN ('pitfall','pattern','approach','decision')`. Adding new types requires a migration that widens this check constraint and adds new columns.
3. `memory_entries` already uses `embedding BLOB NOT NULL` with cosine-similarity vector search (via `SqliteMemoryRepository`). The same pattern can be applied to `global_knowledge` with a nullable BLOB column and a fallback to tag-based search.
4. `EmbeddingLruCache` in `src/infra/persistence/embedding-lru-cache.ts` provides a reusable in-memory LRU layer in front of `embedding_cache` table — no new infrastructure is required for Sub-phase 5.
5. GoalIntent data can be stored in the existing `goals.context` JSON field (`context.intent`) without a schema migration.
6. Current DB is at migration v3. This plan adds v4 only (global_knowledge extension). No new tables are required.

---

## Assumptions

1. Phase 3 sub-phases 0–4 are complete: `src/autonomy/` no longer exists, files are at `src/runtime/react/react-integration.ts` and `src/runtime/events/daemon-event-emitter.ts`.
2. `materialize_goal` IPC command creates the Goal record and notifies HarnessDaemon. HarnessDaemon's polling loop calls `GoalHarness.elaboratePlanDelegate()`. IntentClassification runs as the first step inside `elaboratePlanDelegate()`, not before it, so no IPC contract changes are needed.
3. GoalHarness's statelessness invariant is preserved: GoalIntent is persisted to `goals.context.intent` immediately after classification, not held in GoalHarness memory.
4. PostGoalEvaluator's "no side effects on scheduler state" invariant is preserved: FeatureExtractionService is called after PostGoalEvaluator produces its report. The LLM call is asynchronous and fire-and-forget with respect to the scheduler.
5. The existing `LLMWorkload` type (`'execution' | 'planning' | 'elaboration' | 'evaluation' | 'conversation' | 'quality-review'`) needs a new value `'intent-classification'` and `'feature-extraction'` to give these calls distinct routing and cost tracking.
6. All new services receive `ILogger` via constructor injection. No `console.*` calls. No global singletons. (ADR-002 invariant.)
7. All existing 2185 tests must continue to pass after each sub-phase.

---

## Sub-phase 0: Global Knowledge Schema Extension (GAP D2)

### Objective
Extend the `global_knowledge` table to support new knowledge types, per-entry scope metadata, embeddings for semantic retrieval, and a decay flag. Update the TypeScript type and `GlobalKnowledgeService` to match.

### Why it matters now
Every downstream sub-phase writes or reads `global_knowledge`. Running the migration and updating the TypeScript surface first means Sub-phases 1–7 all build on the same schema without conflicting ALTER TABLE statements.

### Dependencies
None.

### Constraints
- Migration must be additive and safe to re-run (IF NOT EXISTS, DROP CHECK + re-add pattern for widening the CHECK constraint)
- `GlobalKnowledgeService` public interface must remain backward-compatible — callers passing existing types (`pitfall`, `pattern`, `approach`, `decision`) continue to work without changes
- The `embedding` column is BLOB NULL (not NOT NULL) because older entries will not have embeddings and tag-based fallback must remain functional

### Tasks

**Task 0.1: Write migration v4 SQL**

New file: `src/infra/persistence/migrations/v4-global-knowledge-extension.sql`

```sql
-- Widen knowledge_type: SQLite does not support ALTER COLUMN CHECK,
-- so the CHECK is stored in the table definition. Use a CREATE + INSERT + DROP pattern.

CREATE TABLE IF NOT EXISTS global_knowledge_v4 (
  id TEXT PRIMARY KEY,
  created_at INTEGER,
  source_goal_id TEXT,
  source_context_pack_id TEXT,
  knowledge_type TEXT NOT NULL CHECK(knowledge_type IN (
    'pitfall', 'pattern', 'approach', 'decision',
    'constraint', 'failure_mode', 'time_estimate', 'tool_preference'
  )),
  domain_tags TEXT,
  scope TEXT,                          -- e.g. 'github-api', 'nodejs-fs'
  content TEXT NOT NULL,
  confidence REAL NOT NULL,
  occurrence_count INTEGER DEFAULT 1,
  last_reinforced_at INTEGER,
  embedding BLOB,                      -- nullable; generated on record/reinforce
  embedding_dim INTEGER,
  embedding_model TEXT,
  decayed_at INTEGER                   -- null = active; non-null = soft-deleted
);

INSERT INTO global_knowledge_v4
  SELECT id, created_at, source_goal_id, source_context_pack_id,
         knowledge_type, domain_tags, NULL, content, confidence,
         occurrence_count, last_reinforced_at, NULL, NULL, NULL, NULL
  FROM global_knowledge
  WHERE NOT EXISTS (SELECT 1 FROM global_knowledge_v4 WHERE id = global_knowledge.id);

DROP TABLE IF EXISTS global_knowledge_old;
ALTER TABLE global_knowledge RENAME TO global_knowledge_old;
ALTER TABLE global_knowledge_v4 RENAME TO global_knowledge;
DROP TABLE IF EXISTS global_knowledge_old;

CREATE INDEX IF NOT EXISTS idx_gk_type ON global_knowledge(knowledge_type);
CREATE INDEX IF NOT EXISTS idx_gk_type_conf ON global_knowledge(knowledge_type, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_gk_source ON global_knowledge(source_goal_id);
CREATE INDEX IF NOT EXISTS idx_gk_scope ON global_knowledge(scope);
CREATE INDEX IF NOT EXISTS idx_gk_active ON global_knowledge(decayed_at) WHERE decayed_at IS NULL;
```

Register in `src/infra/persistence/migrations/index.ts` as `{ version: 4, name: 'global-knowledge-extension', up: ... }`.

Verification: `npx jest` passes all 2185 tests. `pragma table_info('global_knowledge')` shows all new columns. Old row data is preserved.

**Task 0.2: Update GlobalKnowledgeEntry TypeScript type**

In `src/domain/knowledge/` (or wherever `GlobalKnowledgeEntry` is defined):
- Extend `knowledge_type` union to include `'constraint' | 'failure_mode' | 'time_estimate' | 'tool_preference'`
- Add optional fields: `scope?: string`, `embedding?: Float32Array`, `decayed_at?: number`
- Update `getRelevantKnowledge(type, tags, threshold)` signature to accept an array of types (e.g. `['pitfall', 'constraint']`) rather than a single type

Verification: `npx tsc --noEmit` produces zero errors. Existing callers that pass `'pitfall'` still compile without changes.

**Task 0.3: Update GlobalKnowledgeService.record() dedup logic**

Current logic deduplicates on `type + content` exact match. Change to:
- Primary: exact match on `type + scope + content` (scope narrows dedup correctly)
- If match found: call `reinforce(id)` (existing method) rather than inserting a duplicate
- If no match: insert new entry

Verification: Unit test — record the same content twice with scope set; verify `occurrence_count = 2` rather than two rows.

### Acceptance Criteria
- Migration v4 runs cleanly on a fresh DB and on a DB with existing v1–v3 data
- All 8 knowledge types are valid in TypeScript and in SQLite CHECK constraint
- New columns (scope, embedding, decayed_at) exist and accept null
- All 2185+ tests pass
- `npx tsc --noEmit` clean

### Handoff
- New knowledge types documented in the domain model for Sub-phases 3, 4
- Migration v4 registered — future migrations start at v5

---

## Sub-phase 1: Intent Classification Service (GAP A1 + GAP A2)

### Objective
Add a structured NLU step as the first action inside `GoalHarness.elaboratePlanDelegate()`. The step produces a typed `GoalIntent` (task type, domain tags, extracted constraints, scope boundary), persists it to `goals.context.intent`, and determines whether clarification is needed before proceeding.

### Why it matters now
Without GoalIntent, the knowledge injected during elaboration cannot be targeted — GlobalKnowledgeService has no domain tags to query with. GoalIntent also feeds directly into Sub-phase 4 (structured constraint injection into the elaboration prompt).

### Dependencies
- Sub-phase 0 complete (new knowledge types, scope field)

### Constraints
- GoalHarness statelessness: GoalIntent is immediately written to `goals.context.intent` via `updateGoalContext()` (or equivalent repo call). GoalHarness does not hold it in memory across ticks.
- The new `'intent-classification'` LLMWorkload must be added to the `LLMWorkload` union type in `src/infra/llm/unified-llm-service.ts`.
- If intent classification fails (LLM error), GoalHarness must not proceed to elaboration. It should transition the goal to `blocked` with an escalation type of `ambiguous`.
- Clarification threshold: `confidence < 0.75` triggers the `clarifying` conversation state. This threshold should be a named constant in the service, not a magic number.

### Tasks

**Task 1.1: Define GoalIntent domain type**

New file: `src/domain/work-order/types/goal-intent.ts`

```typescript
export type TaskType =
  | 'code_implementation'
  | 'code_refactoring'
  | 'code_review'
  | 'test_writing'
  | 'documentation'
  | 'analysis'
  | 'research'
  | 'configuration'
  | 'debugging'
  | 'migration'
  | 'unknown';

export interface ExtractedConstraint {
  description: string;
  type: 'must_not_break' | 'style_requirement' | 'scope_limit' | 'external_dependency' | 'performance' | 'other';
  confidence: number; // 0.0-1.0
}

export interface GoalIntent {
  task_type: TaskType;
  domain_tags: string[];           // e.g. ['nodejs', 'filesystem', 'github-api']
  extracted_constraints: ExtractedConstraint[];
  scope_boundary: string;          // e.g. 'PaymentService only, not PaymentModule'
  classification_confidence: number; // 0.0-1.0 overall confidence
  clarification_questions?: string[]; // populated if confidence < threshold
}
```

Verification: Type compiles. AJV JSON schema defined alongside for runtime validation of LLM output.

**Task 1.2: Create IntentClassificationService**

New file: `src/app/lifecycle/intake/intent-classification-service.ts`

```typescript
const CLARIFICATION_THRESHOLD = 0.75; // exported constant for testability

class IntentClassificationService {
  constructor(
    private readonly llmService: ILLMService,
    private readonly logger: ILogger
  ) {}

  async classify(goal: Goal): Promise<GoalIntent>;
  // Calls LLM with workload 'intent-classification'
  // System prompt instructs strict JSON output matching GoalIntent schema
  // Validates response with AJV
  // Returns GoalIntent with classification_confidence
}
```

LLM prompt strategy:
- System: instruct JSON-only output with GoalIntent schema embedded
- User: goal title + description + success_criteria
- Parse and validate response with AJV GoalIntent schema
- If AJV fails: return `{ task_type: 'unknown', domain_tags: [], extracted_constraints: [], scope_boundary: '', classification_confidence: 0.0 }`

Verification: Unit tests covering: successful classification, LLM returns invalid JSON (graceful fallback), LLM returns low confidence (clarification_questions populated).

**Task 1.3: Integrate into GoalHarness.elaboratePlanDelegate()**

In `src/harness/goal-harness.ts`, add as step 0 (before existing step a. Elaborate):

```
0. Classify intent:
   a. Call IntentClassificationService.classify(goal)
   b. Persist result to goal.context.intent via repository
   c. If confidence < CLARIFICATION_THRESHOLD AND goal.context.skip_clarification is not set:
      - Transition goal to 'blocked' status
      - Emit 'goal.needs_clarification' event with questions
      - Return early with { delegatedToScheduler: false, needsClarification: true }
   d. Else: proceed to step a (elaborate)
```

The `goal.context.skip_clarification = true` flag allows callers to bypass clarification (e.g. automated goals from cron agents).

Verification: Unit test that GoalHarness returns early when confidence is low. Unit test that GoalHarness proceeds when confidence is high.

**Task 1.4: Connect clarification questions to conversation flow**

When GoalHarness returns `needsClarification: true`:
- HarnessDaemon (or the IPC bridge) emits a `session_event` with type `goal.needs_clarification` and the list of clarification questions
- Gateway broadcasts to the client session
- Conversation state transitions to `clarifying`
- User responds via `clarify.respond { goalId, responses }`
- `clarify.process` updates `goal.description` and sets `goal.context.skip_clarification = true`
- HarnessDaemon re-picks up the goal on next poll tick

Verify: End-to-end test using the existing `clarify.*` RPC handler stack. `clarify.analyze` is no longer called speculatively — it is replaced by IntentClassificationService as the authoritative confidence signal.

**Task 1.5: Expose GoalIntent via RPC**

Add to goal-related RPC handlers:
- `goal.intent { goalId }` → returns `goals.context.intent` for goals that have been classified
- Useful for the plan review TUI to show detected constraints before user approves

Verification: Handler registered, returns null cleanly for goals without intent (pre-classification).

### Acceptance Criteria
- Every goal processed by GoalHarness has `goals.context.intent` populated before elaboration runs
- Goals with confidence < 0.75 pause and surface clarification questions to the user
- Goals with confidence >= 0.75 proceed without interruption
- `CLARIFICATION_THRESHOLD` is a named constant, not a magic number
- All 2185+ tests pass; new tests cover classification, low-confidence pause, clarification resume path

### Handoff
- `GoalIntent` type in `src/domain/work-order/types/` for Sub-phases 3, 4
- `CLARIFICATION_THRESHOLD` constant exported for reference in other services
- `goal.context.intent` field documented for downstream services

---

## Sub-phase 2: ContextPack Checkpoint Service (GAP C1)

### Objective
Create a service that writes `ContextPack` records during execution, populating the `knowledge_base` section of `ContextSnapshot` with discoveries made during a goal's execution. This is the data source for Sub-phase 3 (FeatureExtractionService).

### Why it matters now
`IWorkOrderRepository.createContextPack()` exists but is never called. Without ContextPack records, `GlobalKnowledgeService.extractFromContextPack()` has no input, and the learning loop cannot function. This is the structural prerequisite for Sub-phase 3.

### Dependencies
- Sub-phase 0 complete (schema in place)

### Constraints
- PostGoalEvaluator invariant: ContextPackCheckpointService must not be called by PostGoalEvaluator itself (PostGoalEvaluator has no side effects on scheduler state). The checkpoint service is called by SchedulerCore, not PostGoalEvaluator.
- ContextPack creation must be fire-and-forget from SchedulerCore's perspective. A checkpoint write failure must never block execution or cause a retry.
- Memory: ContextSnapshot accumulates across the lifetime of a goal. To prevent unbounded growth, `knowledge_base.pitfalls_discovered` and `knowledge_base.learned_patterns` are capped at 50 entries each per ContextPack. Overflow is handled by oldest-first eviction within the snapshot.

### Tasks

**Task 2.1: Create ContextPackCheckpointService**

New file: `src/app/execution/context-pack-checkpoint-service.ts`

```typescript
class ContextPackCheckpointService {
  constructor(
    private readonly repository: IWorkOrderRepository,
    private readonly logger: ILogger
  ) {}

  // Called after each WorkItem reaches terminal state (done, failed, blocked)
  async checkpointAfterWorkItem(
    goal: Goal,
    completedWorkItem: WorkItem,
    finalRun: Run,
    decisions: Decision[],
    escalations: Escalation[]
  ): Promise<void>;

  // Called by RetryHandler when a Run fails with an error
  async checkpointOnError(
    goal: Goal,
    workItem: WorkItem,
    run: Run,
    errorCode: LLMErrorCode | string
  ): Promise<void>;
}
```

`checkpointAfterWorkItem` builds `ContextSnapshot`:
- `goal_state`: current work items grouped by status (from repository)
- `execution_summary`: aggregated run stats for this goal so far
- `knowledge_base.learned_patterns`: tool names and exit codes from successful runs in this goal
- `knowledge_base.pitfalls_discovered`: error_signatures from failed runs in this goal
- `knowledge_base.successful_approaches`: tool sequences from successful runs (extracted from `run.execution_log` if available)
- `next_actions`: next ready work items, any open escalations

`checkpointOnError` writes a `pack_type: 'error_recovery'` pack with a minimal snapshot focused on the failing run context. This is the recovery anchor for FeatureExtractionService.

Verification: Unit tests with mocked repository. Test that a checkpoint is written after a WorkItem transitions to `done`. Test that a checkpoint is written on LLM error. Test that the 50-entry cap is enforced.

**Task 2.2: Wire ContextPackCheckpointService into SchedulerCore**

In `src/scheduler/core/scheduler.ts`:
- Inject `ContextPackCheckpointService` via constructor (with NoopContextPackCheckpointService default to maintain backward compat)
- After `qualityGateRunner.run()` returns success and work item transitions to `done`: call `checkpointAfterWorkItem()` in a fire-and-forget `catch`-wrapped async block
- After `retryHandler.decide()` returns `shouldRetry: false` (terminal failure): call `checkpointAfterWorkItem()` similarly

In `src/scheduler/retry-handler/retry-handler.ts`:
- After logging a retry decision: call `checkpointOnError()` if the error is classified as a pattern worth recording (i.e., `LLMErrorCode` values `server_error`, `rate_limited`, `timeout`, `context_exceeded` — not `auth_failed` or `content_policy` which are operational, not learning signals)

Verification: Integration test. Submit a goal with two work items; verify two `context_packs` rows exist in the DB after goal completes. Verify SchedulerCore tick tests still pass (NoopContextPackCheckpointService used in existing tests).

**Task 2.3: Add IWorkOrderRepository.getLatestContextPack()**

Add to repository interface and SQLite implementation:
```typescript
getLatestContextPack(goalId: string): Promise<ContextPack | null>
// SELECT * FROM context_packs WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1
```

This is the query used by FeatureExtractionService (Sub-phase 3) and cross-WorkItem context propagation (Sub-phase 6).

Verification: Unit test. Insert two context_packs for same goalId; verify latest is returned.

### Acceptance Criteria
- At least one `context_packs` row is written for every goal that reaches a terminal state (completed or failed)
- `error_recovery` packs are written when a Run fails with a recoverable error
- SchedulerCore tick loop behavior is unchanged if `ContextPackCheckpointService` throws
- `getLatestContextPack(goalId)` returns the most recent pack
- All 2185+ tests pass; new tests cover checkpoint write and error recovery paths

### Handoff
- `ContextPackCheckpointService` at `src/app/execution/context-pack-checkpoint-service.ts`
- `IWorkOrderRepository.getLatestContextPack()` available for Sub-phases 3 and 6
- NoopContextPackCheckpointService available for use in existing test fixtures

---

## Sub-phase 3: Feature Extraction Pipeline (GAP D1)

### Objective
Add `FeatureExtractionService`, called by `PostGoalEvaluator` after producing a `GoalEvaluationReport`. The service uses a structured LLM call to extract `GlobalKnowledgeEntry[]` from the combination of the evaluation report and the latest `ContextPack`. The entries are written to `global_knowledge` via `GlobalKnowledgeService.record()`, closing the learning loop.

### Why it matters now
This is the core gap. Without it, every execution is a dead end — no learning, no improvement. Sub-phases 0, 1, and 2 are all prerequisites that make the input data available and typed correctly.

### Dependencies
- Sub-phase 0 complete (new knowledge types in schema and TypeScript)
- Sub-phase 1 complete (GoalIntent with domain_tags available at `goals.context.intent`)
- Sub-phase 2 complete (ContextPack written during execution)

### Constraints
- PostGoalEvaluator invariant: `PostGoalEvaluator` must not be modified to perform LLM calls or DB writes. `FeatureExtractionService` is invoked by `HarnessDaemon` after `PostGoalEvaluator` completes, not inside it.
- The `'feature-extraction'` LLMWorkload must be added to the `LLMWorkload` union. It routes to the `medium` tier by default (Sonnet-class model sufficient; no need for Opus here).
- LLM JSON output is validated with AJV before writing to `global_knowledge`. Invalid or unparseable entries are logged as warnings and skipped — they must not throw.
- The entire feature extraction is fire-and-forget with respect to HarnessDaemon's polling loop. A failure here must never block goal status transitions.

### Tasks

**Task 3.1: Add 'feature-extraction' LLMWorkload**

In `src/infra/llm/unified-llm-service.ts`, add `'feature-extraction'` to the `LLMWorkload` union:
```typescript
type LLMWorkload = 'execution' | 'planning' | 'elaboration' | 'evaluation'
  | 'conversation' | 'quality-review' | 'intent-classification' | 'feature-extraction';
```
Route `'feature-extraction'` to the `medium` tier (same as `'evaluation'`).

**Task 3.2: Create FeatureExtractionService**

New file: `src/app/lifecycle/evaluation/feature-extraction-service.ts`

```typescript
class FeatureExtractionService {
  constructor(
    private readonly llmService: ILLMService,
    private readonly knowledgeService: GlobalKnowledgeService,
    private readonly repository: IWorkOrderRepository,
    private readonly logger: ILogger
  ) {}

  async extractAndRecord(
    report: GoalEvaluationReport,
    goal: Goal
  ): Promise<void>;
}
```

`extractAndRecord` implementation:
1. Fetch latest ContextPack via `repository.getLatestContextPack(goal.id)`
2. Build extraction prompt (see below)
3. Call `llmService.complete('feature-extraction', messages)`
4. Parse and AJV-validate response as `ExtractionResult[]`
5. For each valid entry: call `knowledgeService.record(entry)` with:
   - `source_goal_id: goal.id`
   - `domain_tags: goal.context.intent?.domain_tags ?? []`
   - `scope: goal.context.intent?.scope_boundary ?? null`

**Extraction prompt structure**:

System:
```
You are a knowledge extractor. Analyse the goal execution report and context snapshot below.
Extract structured knowledge entries that would help future tasks of similar type.
Respond ONLY with a JSON array matching the ExtractionResult schema. No prose, no markdown fences.

ExtractionResult schema:
{
  "knowledge_type": "constraint" | "failure_mode" | "pattern" | "pitfall" | "approach" | "time_estimate" | "tool_preference",
  "scope": string | null,      // e.g. "github-api" or null
  "content": string,            // self-contained, actionable fact (max 200 chars)
  "confidence": number          // 0.0-1.0
}
```

User:
```
Goal: {{ goal.title }}
Task type: {{ intent.task_type }}
Outcome: {{ report.trigger }}

Work item results:
{{ for each workItemResult: title, outcome (publish/retry/replan/escalate) }}

Pitfalls discovered during execution:
{{ contextPack.snapshot_data.knowledge_base.pitfalls_discovered | first 20 }}

Patterns from successful runs:
{{ contextPack.snapshot_data.knowledge_base.learned_patterns | first 20 }}

Error summary:
{{ contextPack.snapshot_data.execution_summary.most_common_errors }}

Extract between 2 and 8 knowledge entries. Only include entries you are confident about.
Do not extract entries with confidence below 0.5.
```

**Task 3.3: Wire FeatureExtractionService into HarnessDaemon**

In `src/harness/harness-daemon.ts`:
- Inject `FeatureExtractionService` via constructor (with Noop default)
- `PostGoalEvaluator` already emits an event or returns a report after evaluation. After receiving the report (or subscribing to its completion):
  ```typescript
  // fire-and-forget
  this.featureExtractionService.extractAndRecord(report, goal)
    .catch(err => this.logger.warn({ err, goalId: goal.id }, 'Feature extraction failed — continuing'));
  ```
- The `60s metrics flush interval` (ADR-002) already runs in HarnessDaemon — no new loop needed

Verification: Integration test. Submit a goal, run it to completion, verify >= 1 row in `global_knowledge` with `source_goal_id` set. Verify HarnessDaemon does not stop if `FeatureExtractionService` throws.

**Task 3.4: Add audit log entry for knowledge extraction**

In `FeatureExtractionService.extractAndRecord()`, after writing knowledge entries:
```
auditLog.log({ actor: 'system', action: 'system.knowledge.extract', entity_type: 'goal', entity_id: goal.id, metadata: { entries_written: N } })
```

Add `SYSTEM_KNOWLEDGE_EXTRACT` to the prefixed constants in `src/domain/audit/audit-naming.ts`.

### Acceptance Criteria
- After every completed or failed goal, at least one `global_knowledge` row with `source_goal_id` set is present (for goals with sufficient execution data)
- The LLM extraction is fire-and-forget — HarnessDaemon continues if it fails
- AJV validation prevents malformed entries from being written
- Entries use domain_tags and scope from GoalIntent (Sub-phase 1)
- Audit log records the extraction event
- All 2185+ tests pass; new tests cover: successful extraction, LLM returns invalid JSON (no crash), empty ContextPack (graceful skip)

### Handoff
- `FeatureExtractionService` at `src/app/lifecycle/evaluation/feature-extraction-service.ts`
- New `SYSTEM_KNOWLEDGE_EXTRACT` audit constant documented
- Learning loop is now end-to-end functional

---

## Sub-phase 4: Structured Knowledge Injection (GAP B1)

### Objective
Replace free-text knowledge injection in `ElaborationService` with structured constraint objects derived from `GoalIntent` and `GlobalKnowledgeService`. Add budget suggestion logic using `time_estimate` knowledge entries.

### Why it matters now
After Sub-phases 1–3, GoalIntent and GlobalKnowledge contain structured, typed data. This sub-phase ensures that data is consumed structurally during elaboration rather than dumped as unformatted text into the LLM prompt.

### Dependencies
- Sub-phase 1 complete (GoalIntent in `goals.context.intent`)
- Sub-phase 3 complete (GlobalKnowledge has entries with new types populated)

### Constraints
- ElaborationService must not call the intent classification LLM again — it reads `goal.context.intent` which was written by Sub-phase 1
- Budget suggestions are advisory only — they must not override a user-set `budget_tokens` or `budget_cost_usd`. They apply only when the field is null (unset).
- Prompt injection must have a token budget cap. Cap the number of injected knowledge entries at 10, ordered by confidence DESC.

### Tasks

**Task 4.1: Modify ElaborationService to consume GoalIntent constraints**

In `src/app/lifecycle/elaboration/elaboration-service.ts`:

Replace the current "inject pitfalls as free text" block with a structured section:

```
TASK CONSTRAINTS (extracted before planning began):
{{ for each extracted_constraint in intent.extracted_constraints }}
- [{{ constraint.type }}] {{ constraint.description }} (confidence: {{ constraint.confidence | round 2 }})

SCOPE BOUNDARY:
{{ intent.scope_boundary }}
```

The typed format gives the planning LLM explicit signal about constraint categories (must_not_break, scope_limit, etc.) rather than a wall of bullets.

**Task 4.2: Modify GlobalKnowledge injection to use new types**

Update the `getRelevantKnowledge()` call in ElaborationService to query by type array:
```typescript
const relevantKnowledge = await knowledgeService.getRelevantKnowledge(
  ['pitfall', 'constraint', 'failure_mode'],
  intent.domain_tags,
  0.5  // confidence threshold
);
```
Order by confidence DESC, take first 10. Emit a structured block:
```
KNOWN CONSTRAINTS AND PITFALLS FOR {{ intent.domain_tags.join(', ') }}:
{{ for each entry, grouped by knowledge_type }}
  [{{ entry.knowledge_type.toUpperCase() }}] {{ entry.content }}
```

**Task 4.3: Add budget suggestion from time_estimate knowledge**

New private method in ElaborationService: `suggestBudgets(goal: Goal, intent: GoalIntent)`:
1. Query GlobalKnowledge: `getRelevantKnowledge(['time_estimate'], intent.domain_tags, 0.6)`
2. If entries found: parse numeric estimate from content (e.g. "~45min, ~80k tokens")
3. If `goal.budget_tokens` is null: suggest `Math.ceil(estimated_tokens * 1.3)` (30% buffer) via an advisory escalation (severity: `low`, type: `validation_failed`, title: "Budget suggestion")
4. Suggestion is non-blocking — if no time_estimate entries exist, skip silently

Verification: Unit test. Seed a `time_estimate` knowledge entry. Verify that a goal with `budget_tokens = null` receives a low-severity escalation with the suggestion.

**Task 4.4: Modify PlanningService to receive structured constraints**

In `src/app/lifecycle/planning/planning-service.ts`:
- Pass the list of `ExtractedConstraint[]` from GoalIntent into the planning prompt's tool call definitions
- Specifically: for constraints of type `scope_limit`, add them as negative-example instructions to the work item generation prompt ("do not create work items that touch X")

Verification: Unit test with a goal intent containing a `scope_limit` constraint. Verify PlanningService prompt contains the constraint as an explicit exclusion.

### Acceptance Criteria
- Elaboration prompt contains structured constraint blocks, not free text dumps
- GlobalKnowledge injection queries by type array and is capped at 10 entries
- Budget suggestions are created as low-severity escalations for goals with null token budgets when time_estimate data is available
- PlanningService receives and uses scope_limit constraints
- All 2185+ tests pass

### Handoff
- Elaboration prompt structure documented for prompt debugging
- Budget suggestion escalation title/type constants added to audit-naming.ts if applicable

---

## Sub-phase 5: Semantic Knowledge Retrieval (GAP B2)

### Objective
Add embedding-based semantic retrieval to `GlobalKnowledgeService` as a complement to existing tag-based retrieval. Use the same embedding infrastructure as `SqliteMemoryRepository`. Tag-based retrieval remains the fallback when embeddings are not available.

### Why it matters now
Tag-based lookup fails when domain tags are inconsistent across goals (e.g. `'nodejs'` vs `'node'`). Semantic retrieval finds conceptually similar knowledge regardless of tag variation, improving relevance of injected knowledge in Sub-phase 4.

### Dependencies
- Sub-phase 0 complete (embedding columns in global_knowledge)
- Sub-phase 3 complete (knowledge entries being written; entries need embeddings generated)

### Constraints
- Must not change `getRelevantKnowledge()` call signature — Sub-phase 4 already uses it. Add a new method `getRelevantKnowledgeSemantic()` alongside it. Callers can opt into semantic search; fall back to tag-based if no embeddings exist.
- Reuse `EmbeddingLruCache` exactly as used in `SqliteMemoryRepository`. Do not create a new cache instance — inject the same one if possible, or create a separate instance with a smaller max size (100 entries, vs 500 for memory).
- The LLM call to generate embeddings must use the same model as `memory_entries` to ensure vectors are comparable (check existing embedding model used in `SqliteMemoryRepository`).

### Tasks

**Task 5.1: Generate embedding when knowledge is recorded**

In `GlobalKnowledgeService.record()`:
After inserting the row, asynchronously generate an embedding for `entry.content`:
```typescript
// fire-and-forget — embedding failure does not fail the record() call
this.generateAndStoreEmbedding(entry.id, entry.content)
  .catch(err => this.logger.warn({ err, entryId: entry.id }, 'Knowledge embedding failed'));
```

`generateAndStoreEmbedding()` calls the existing embedding infrastructure (same API call used by `SqliteMemoryRepository`), stores `embedding BLOB`, `embedding_dim`, `embedding_model` via:
```sql
UPDATE global_knowledge SET embedding = ?, embedding_dim = ?, embedding_model = ? WHERE id = ?
```

**Task 5.2: Implement getRelevantKnowledgeSemantic()**

In `GlobalKnowledgeService`:
```typescript
async getRelevantKnowledgeSemantic(
  queryText: string,
  types: GlobalKnowledgeType[],
  limit: number,
  confidenceThreshold: number
): Promise<GlobalKnowledgeEntry[]>
```

Implementation:
1. Generate embedding for `queryText` (use EmbeddingLruCache — cache miss → generate → store in cache)
2. Load all `global_knowledge` entries where `embedding IS NOT NULL` and `knowledge_type IN (types)` and `confidence >= confidenceThreshold` and `decayed_at IS NULL`
3. Compute cosine similarity (same helper used in `SqliteMemoryRepository`)
4. Return top `limit` results ordered by similarity DESC

Fallback: if no entries have embeddings, fall back to `getRelevantKnowledge()` with tag-based matching.

**Task 5.3: Update ElaborationService to use semantic retrieval**

In `src/app/lifecycle/elaboration/elaboration-service.ts`, replace the `getRelevantKnowledge()` call from Sub-phase 4 with:
```typescript
const relevantKnowledge = await knowledgeService.getRelevantKnowledgeSemantic(
  `${goal.title} ${intent.scope_boundary}`,  // query text
  ['pitfall', 'constraint', 'failure_mode'],
  10,
  0.5
);
```

The query text is the natural language description of the task, giving semantic search the best signal.

Verification: Unit test — record a knowledge entry with content "GitHub API rate limit 5000 req/hr". Query with "github rate limiting" (no exact tag match). Verify the entry is returned.

### Acceptance Criteria
- Embeddings are generated asynchronously when `record()` is called
- `getRelevantKnowledgeSemantic()` returns results by cosine similarity
- Falls back to tag-based if no entries have embeddings
- ElaborationService uses semantic retrieval for knowledge injection
- EmbeddingLruCache is used (no direct DB query per retrieval)
- All 2185+ tests pass

### Handoff
- Semantic retrieval available for future callers (e.g. Sub-phase 6's cross-WorkItem context lookup)

---

## Sub-phase 6: Cross-WorkItem Context Propagation (GAP C2)

### Objective
Ensure that constraints and discoveries made during one WorkItem's execution are available to subsequent WorkItems in the same goal's DAG, without requiring a full knowledge cycle (i.e., without waiting for PostGoalEvaluator and FeatureExtractionService to write to global_knowledge).

### Why it matters now
Long task chains (5+ WorkItems) currently execute with only the global knowledge available at elaboration time. If a constraint is discovered during WorkItem 2 (e.g. "this library's API changed in v3"), WorkItem 3 starts without knowing it. This causes repeated failures on the same constraint within a single goal.

### Dependencies
- Sub-phase 2 complete (ContextPack written per WorkItem; `getLatestContextPack()` available)

### Constraints
- Injected context must have a hard size cap to prevent prompt bloat. Maximum 15 items from the latest ContextPack's `knowledge_base`.
- This is intra-goal context only. It must not write to `global_knowledge` — that is the job of FeatureExtractionService. The goal is fast within-goal propagation, not permanent learning.
- SchedulerCore must not change its tick loop or DAG ordering logic. Context injection happens at the point of building the execution prompt, not at orchestration time.

### Tasks

**Task 6.1: Add goal-level accumulated context to execution prompt**

In `src/app/lifecycle/execution/execution-service.ts` (or wherever the system prompt for a WorkItem execution is assembled):

Before building the system prompt, call:
```typescript
const latestPack = await repository.getLatestContextPack(workItem.goal_id);
const intraGoalContext = latestPack
  ? extractIntraGoalContext(latestPack, MAX_INTRA_GOAL_ITEMS = 15)
  : null;
```

`extractIntraGoalContext()` is a pure function (no async, no LLM):
- Takes `ContextPack.snapshot_data.knowledge_base`
- Returns `{ pitfalls: string[], patterns: string[] }` capped at MAX_INTRA_GOAL_ITEMS total
- Orders by: pitfalls first (most actionable), then patterns

Inject into system prompt as a dedicated section:
```
DISCOVERIES FROM EARLIER STEPS IN THIS GOAL:
{{ pitfalls | bulleted }}
{{ patterns | bulleted }}
(These were found during execution of preceding work items in this goal.)
```

**Task 6.2: Verify propagation does not double-count global knowledge**

The elaboration prompt (from Sub-phase 4) already contains global knowledge injected at planning time. The intra-goal context (this sub-phase) contains discoveries made since planning began. The two must not overlap in confusing ways.

Add a comment in the execution prompt builder documenting the distinction:
```
// Global knowledge (from GlobalKnowledgeService) = cross-goal, permanent
// Intra-goal context (from ContextPack) = within-goal, transient
// These are distinct sections in the prompt and are sourced independently
```

Verification: Integration test. Create a goal with two sequential WorkItems. Make WorkItem 1 write a known pitfall to its ContextPack (via ContextPackCheckpointService). Verify WorkItem 2's execution prompt contains the pitfall in the intra-goal context section.

### Acceptance Criteria
- WorkItem N+1 execution prompts contain the top-15 discoveries from preceding WorkItems in the same goal
- Cap is enforced; oversized ContextPacks do not cause prompt overflow
- Global knowledge and intra-goal context are kept as distinct prompt sections
- No changes to SchedulerCore tick loop or DAG ordering
- All 2185+ tests pass

### Handoff
- `extractIntraGoalContext()` is a pure utility function, easily tested and reusable
- Cap constant `MAX_INTRA_GOAL_ITEMS = 15` is a named export for configurability

---

## Sub-phase 7: Knowledge Decay Policy (GAP E1)

### Objective
Introduce a scheduled maintenance policy that reduces confidence on stale knowledge entries and soft-deletes entries that have fallen below the usability threshold. Add semantic deduplication to clean up near-duplicate entries written from different goals over time.

### Why it matters now
Without decay, `global_knowledge` accumulates forever. After months of operation, the injection step in Sub-phase 4 would surface outdated constraints (e.g. a library's old API restrictions after an upgrade). Low confidence is meaningless without enforcement.

### Dependencies
- Sub-phase 0 complete (decayed_at column in schema)
- Sub-phase 5 complete (embeddings on entries enable semantic dedup)

### Constraints
- Must use existing cron infrastructure (same pattern as Phase 3 Sub-phase 2 entropy agent)
- Decay must be reversible in principle: use soft-delete (`decayed_at = NOW`) not `DELETE`
- Semantic dedup uses cosine similarity > 0.95 as the merge threshold (conservative to avoid false merges)
- All queries on `global_knowledge` in all other services already filter `WHERE decayed_at IS NULL` (this invariant must be verified before this sub-phase ships)

### Tasks

**Task 7.1: Verify all GlobalKnowledgeService queries filter decayed_at**

Before writing any new code: audit all `SELECT` queries in `GlobalKnowledgeService` and its repository. Add `AND decayed_at IS NULL` to any query that retrieves entries for use (record(), reinforce(), getRelevantKnowledge(), getRelevantKnowledgeSemantic()). The index `idx_gk_active` from Sub-phase 0 makes this efficient.

Verification: grep `src/` for `FROM global_knowledge` — every query that returns rows for active use must include the `decayed_at IS NULL` filter.

**Task 7.2: Create KnowledgeDecayService**

New file: `src/app/knowledge/knowledge-decay-service.ts`

```typescript
class KnowledgeDecayService {
  // Decay rules:
  // - age_days > 90 AND occurrence_count < 3: reduce confidence by 0.15
  // - confidence < 0.1: set decayed_at = NOW (soft delete)
  async applyAgeDecay(): Promise<{ decayed: number; confidenceReduced: number }>;

  // Semantic dedup: for entries with cosine similarity > 0.95,
  // keep the one with higher confidence + occurrence_count.
  // Set decayed_at on the weaker duplicate.
  async deduplicateSemantically(similarityThreshold = 0.95): Promise<{ merged: number }>;
}
```

Both methods use direct SQL via `IWorkOrderRepository.getDatabase()` (following the same pattern as `SQLiteMetricsRecorder` and `RuntimeEventTracer`).

**Task 7.3: Create knowledge-decay cron persona**

New file: `config/personas/knowledge-decay.json`:

```json
{
  "agent_id": "knowledge-decay-agent",
  "name": "Knowledge Decay Agent",
  "schedule": "0 2 * * 0",
  "timezone": "UTC",
  "task": "Run knowledge decay and semantic deduplication on the global_knowledge store. Call KnowledgeDecayService.applyAgeDecay() then KnowledgeDecayService.deduplicateSemantically(). Create an escalation of severity 'low' summarising: entries decayed, duplicates merged, current total active entries.",
  "policy": {
    "allowed_tools": [],
    "max_tokens": 4000,
    "max_cost_usd": 0.10
  }
}
```

The agent is config-only and calls the service via a new internal tool `knowledge.decay.run` (Layer 1, autonomous).

Verification: JSON validates against persona schema. Start scheduler daemon; confirm log shows agent registered. Run manually with `pb agent run knowledge-decay-agent --dry-run` (or equivalent debug path) to verify decay logic without writing.

### Acceptance Criteria
- All `global_knowledge` queries filter `decayed_at IS NULL`
- Age decay reduces confidence on entries >90 days old with low occurrence
- Entries below 0.1 confidence are soft-deleted
- Semantic dedup merges near-identical entries (threshold 0.95)
- Cron agent registered and running weekly (Sunday 2 AM UTC)
- Low-severity escalation created summarising each decay run
- All 2185+ tests pass

### Handoff
- `KnowledgeDecayService` available for direct invocation in tests and CLI debug commands
- Decay cron schedule documented in operations runbook section

---

## Execution Order and Parallelism

```
Sub-phase 0 (knowledge schema)         ----[2-3 hours]---->
Sub-phase 1 (intent classification)    --------[2-3 days]-------->   (starts after 0)
Sub-phase 2 (ContextPack checkpoint)   ------[2-3 days]-------->     (starts after 0, parallel with 1)
Sub-phase 3 (feature extraction)       ----------[3-4 days]---------> (requires 0, 1, 2)
Sub-phase 4 (structured injection)     ------[1-2 days]------->       (requires 1, 3)
Sub-phase 5 (semantic retrieval)       --------[2-3 days]-------->    (requires 0, 3; parallel with 4)
Sub-phase 6 (cross-WorkItem context)   ------[1-2 days]------->       (requires 2; parallel with 4-5)
Sub-phase 7 (knowledge decay)          ----[1-2 days]---->            (requires 0, 5; parallel with 6)
```

Critical path: `0 → 2 → 3 → (4 and 5 parallel)`.  
Sub-phases 6 and 7 are off the critical path and can run alongside 4–5.

---

## Verification Checklist

| Sub-phase | Verification method | Evidence required |
|-----------|--------------------|--------------------|
| 0 | `npx jest` pass; `pragma table_info('global_knowledge')` shows all columns; `npx tsc --noEmit` clean | Test count >= 2185, 8 knowledge types valid, zero compile errors |
| 1 | New unit tests for IntentClassificationService; end-to-end test via TUI submitting a task | Goals have `context.intent` populated; low-confidence goal shows clarification questions to user |
| 2 | Unit tests for checkpoint service; integration test showing `context_packs` rows after goal completion | >= 1 context_pack per completed goal; `error_recovery` pack on retry |
| 3 | Integration test: complete a goal, verify `global_knowledge` rows with `source_goal_id` | >= 1 knowledge row per completed goal; fire-and-forget verified (no crash on LLM fail) |
| 4 | Unit test showing structured constraint block in elaboration prompt; budget suggestion test | Prompt contains typed constraint section; low-severity escalation created when `budget_tokens` is null |
| 5 | Unit test: record entry, query with semantically similar text (no tag match), verify returned | Result returned without exact tag match; fallback to tag-based when no embeddings |
| 6 | Integration test: 2-WorkItem goal, pitfall in WorkItem 1 ContextPack appears in WorkItem 2 prompt | Intra-goal context section present in WorkItem 2 execution prompt |
| 7 | Unit tests for decay rules; cron agent registered in daemon log; dry-run produces escalation | Decay logic correct; entries below threshold soft-deleted; agent shown in `pb agent list` |

---

## Risk Register

| Risk | Sub-phase | Mitigation |
|------|-----------|------------|
| Migration v4 data loss if ALTER fails mid-run | 0 | CREATE + INSERT + RENAME pattern; test against DB with existing data before ship |
| GoalHarness invariant broken if intent classification holds state | 1 | Intent immediately written to `goals.context`; GoalHarness references DB, not memory |
| ContextPack write blocks SchedulerCore tick | 2 | All checkpoint writes are fire-and-forget with catch; NoopImpl used in all existing tests |
| FeatureExtractionService LLM call adds latency to post-goal path | 3 | Call is async fire-and-forget from HarnessDaemon; PostGoalEvaluator is not blocked |
| AJV schema too strict, drops valid LLM output | 3 | Log and skip invalid entries; never throw. Monitor skip rate via metrics |
| Embedding generation increases token cost per knowledge record | 5 | Embeddings are generated once per entry, cached in EmbeddingLruCache; same model as memory_entries |
| Semantic dedup merges entries it should not (false positive at 0.95) | 7 | Threshold 0.95 is conservative; audit merged entries in escalation report; dedup is soft-delete only |
| Decay removes knowledge that is still valid | 7 | Soft-delete only (decayed_at); hard purge is a separate, future step; `reinforce()` resets the clock |
| Cross-WorkItem context grows unbounded for goals with many WorkItems | 6 | Hard cap of 15 items; `extractIntraGoalContext()` is a pure capped function |

---

## Files to Read First (for implementers)

**Sub-phase 0:**
- `src/infra/persistence/migrations/index.ts`
- `src/domain/knowledge/` — GlobalKnowledgeEntry type and GlobalKnowledgeService interface
- `src/infra/persistence/` — any file containing `SELECT * FROM global_knowledge` (must add `decayed_at IS NULL`)

**Sub-phase 1:**
- `src/harness/goal-harness.ts` — `elaboratePlanDelegate()` to identify insertion point
- `src/harness/goal-harness-interface.ts` — interface contracts
- `src/app/lifecycle/elaboration/elaboration-service.ts` — current knowledge injection
- `src/scheduler-daemon/conversation-bootstrap/` — how `materialize_goal` flows to GoalHarness
- `src/gateway/rpc/handlers/` — existing clarify.* handlers

**Sub-phase 2:**
- `src/scheduler/core/scheduler.ts` — tick loop and post-execution flow
- `src/scheduler/retry-handler/retry-handler.ts` — retry decision point
- `src/infra/persistence/` — `IWorkOrderRepository.createContextPack()` implementation
- `src/work-order/types/index.ts` — ContextPack, ContextSnapshot type definitions

**Sub-phase 3:**
- `src/harness/post-goal-evaluator.ts` — where to hook FeatureExtractionService
- `src/harness/harness-daemon.ts` — injection point after evaluator fires
- `src/domain/knowledge/` — GlobalKnowledgeService.record() contract
- `src/infra/llm/unified-llm-service.ts` — LLMWorkload union to extend

**Sub-phase 4:**
- `src/app/lifecycle/elaboration/elaboration-service.ts` — prompt construction
- `src/app/lifecycle/planning/planning-service.ts` — constraint passthrough
- `src/domain/work-order/types/goal-intent.ts` (created in Sub-phase 1)

**Sub-phase 5:**
- `src/infra/persistence/` — `SqliteMemoryRepository` for embedding pattern reference
- `src/infra/persistence/embedding-lru-cache.ts` — LRU cache API
- `src/domain/knowledge/` — GlobalKnowledgeService to add semantic method

**Sub-phase 6:**
- `src/app/lifecycle/execution/execution-service.ts` — system prompt construction
- `src/infra/persistence/` — `getLatestContextPack()` (created in Sub-phase 2)
- `src/work-order/types/index.ts` — ContextPack.snapshot_data.knowledge_base shape

**Sub-phase 7:**
- `config/personas/pony-default.json` — persona config pattern reference
- `src/domain/knowledge/` — GlobalKnowledgeService queries to audit for `decayed_at IS NULL`
- `src/infra/persistence/` — `getDatabase()` pattern (used by SQLiteMetricsRecorder, RuntimeEventTracer)