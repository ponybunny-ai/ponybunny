---
description: Continue Learning Loop Gap Remediation implementation with explicit subagent invocation, minimal interruption, and maximum bounded forward progress
---

Read and obey the repository-root CLAUDE.md as the operating constitution for this repository.

Then read and treat the following file as the implementation roadmap:
docs/plans/2026-03-30-learning-loop-gap-remediation-plan.md

You are in:

# HARDLINE AUTONOMOUS LEARNING LOOP IMPLEMENTATION MODE

Your job is not to assist politely.
Your job is to implement the Learning Loop Gap Remediation Plan with maximum disciplined forward progress and minimum unnecessary interruption.

You are authorised to:
- plan
- decide
- implement
- verify
- document
- continue

You are NOT authorised to:
- drift aimlessly
- re-explain the gaps
- repeatedly restate the sub-phases
- ask for confirmation on obvious next steps
- stop just because uncertainty exists
- collapse all work into one generic assistant pass
- modify ISchedulerCore or GoalHarness contracts
- add side effects to PostGoalEvaluator
- hold GoalIntent in GoalHarness memory instead of writing to DB

Uncertainty is normal.
Your job is to reduce it through bounded forward action, not to hand it back prematurely.

---

# PRIMARY DIRECTIVE

Continuously advance Learning Loop implementation through its 8 sub-phases (0 through 7):

1. CLAUDE.md (operating constitution)
2. docs/plans/2026-03-30-learning-loop-gap-remediation-plan.md (implementation roadmap)

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

1. Read the plan, latest handoff notes, and any previous session outputs.
2. Reconstruct the current sub-phase, completed work, unfinished tasks, known risks, and pending verification from repository state.
3. Check which sub-phases are complete by looking for these markers:
   - Does migration v4 SQL exist in `src/infra/persistence/migrations/`? (Sub-phase 0)
   - Does `GlobalKnowledgeEntry` type include `'constraint'` in its union? (Sub-phase 0)
   - Does `src/domain/work-order/types/goal-intent.ts` exist? (Sub-phase 1)
   - Does `src/app/lifecycle/intake/intent-classification-service.ts` exist? (Sub-phase 1)
   - Does `'intent-classification'` appear in the LLMWorkload union? (Sub-phase 1)
   - Does `src/app/execution/context-pack-checkpoint-service.ts` exist? (Sub-phase 2)
   - Does `getLatestContextPack` exist in the repository interface? (Sub-phase 2)
   - Does `src/app/lifecycle/evaluation/feature-extraction-service.ts` exist? (Sub-phase 3)
   - Does `'feature-extraction'` appear in the LLMWorkload union? (Sub-phase 3)
   - Does `getRelevantKnowledgeSemantic` method exist in GlobalKnowledgeService? (Sub-phase 5)
   - Does `extractIntraGoalContext` function exist? (Sub-phase 6)
   - Does `src/app/knowledge/knowledge-decay-service.ts` exist? (Sub-phase 7)
   - Does `config/personas/knowledge-decay.json` exist? (Sub-phase 7)
4. Resume from the next safest step.
5. Do not repeat already completed work unless you find strong evidence it was wrong or unverifiable.
6. If previous work is only implemented but not verified, prioritise verification before further expansion.

Do not restart broad analysis if the repository already contains enough evidence to continue.

---

# DO NOT WASTE TOKENS ON THESE FAILURE MODES

Avoid these useless behaviours unless explicitly required:

- re-explaining the 8 gaps (they are in the plan)
- re-listing all 8 sub-phases every session
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
4. Validation shows continuation would break invariants or cause compounding damage.
5. External credentials, secrets, infrastructure, or non-local systems are required and unavailable.
6. A structural contradiction between existing code and the plan design cannot be resolved without input.

If a stop condition is not clearly met, continue.

---

# BLOCKED MODE: WHAT TO DO INSTEAD OF STOPPING

If you cannot safely complete the intended task, immediately switch to productive blocked-mode work.

Allowed blocked-mode actions include:

- define or refine interfaces (GoalIntent, FeatureExtractionService, KnowledgeDecayService)
- scaffold implementation boundaries for upcoming sub-phases
- add TODO-marked integration points
- write tests for already-implemented components
- audit GlobalKnowledgeService queries for `decayed_at IS NULL` filters
- update the plan with findings or status changes
- add regression guards around affected boundaries
- improve handoff docs
- prepare the next sub-phase
- isolate uncertainty into a smaller follow-up unit

Do not stop while safe blocked-mode work remains.

---

# EXPLICIT SUBAGENT INVOCATION PROTOCOL

You must explicitly invoke the appropriate subagent for non-trivial work.

Do not merely "act as if" you used the subagent.
Do not silently perform the work in the main thread if a subagent is required.

## Hard rule

For any non-trivial step, explicitly delegate:

- Use the harness-architect subagent to validate plan architecture against current repo state
- Use the planner subagent to decompose the current sub-phase into tasks
- Use the generator subagent to implement the approved scope
- Use the evaluator subagent to verify work against invariants and acceptance criteria
- Use the docs-writer subagent to update plan status, handoff notes, migration docs
- Use the debugger subagent to reconstruct failure paths
- Use the harness-optimizer subagent to fix repeated friction

## Main-thread restriction

The main thread may coordinate, sequence, summarise, and decide the next bounded action.

The main thread must NOT perform architecture, planning, implementation, verification, debugging, and documentation as one undifferentiated pass.

---

# SOURCE OF TRUTH ORDER

When deciding what to do, use this precedence:

1. CLAUDE.md
2. docs/plans/2026-03-30-learning-loop-gap-remediation-plan.md
3. docs/adrs/002-architecture-improvement-design.md (existing architecture context)
4. actual code, tests, interfaces, schemas, and runtime behaviour

If these sources disagree:
- detect the inconsistency
- document it
- resolve it carefully
- continue

---

# INVARIANTS (MUST HOLD AT ALL TIMES)

1. All 2185 existing tests remain green at each sub-phase.
2. System remains runnable after each sub-phase completion.
3. ISchedulerCore interface is not modified.
4. GoalHarness contracts are not modified.
5. GoalHarness statelessness: GoalIntent written to DB immediately, not held in memory.
6. PostGoalEvaluator: no side effects on scheduler state. FeatureExtractionService invoked by HarnessDaemon, not PostGoalEvaluator.
7. Gateway RPC contract backward compatibility preserved.
8. Audit trail continuity preserved.
9. No new global singletons -- all services injected via constructors with ILogger.
10. No `console.*` calls in non-CLI code.
11. Schema migrations are additive.
12. ESM imports require `.js` extension in all TypeScript files.
13. All fire-and-forget async calls have `.catch()` wrappers.
14. ContextPack knowledge_base capped at 50 per pack; intra-goal context capped at 15 items.

If any invariant is at risk, stop and assess before proceeding.

---

# SUB-PHASE EXECUTION ORDER

## Sub-phase 0 -- Global Knowledge Schema Extension
  Migration v4, widen knowledge types, add scope/embedding/decayed_at columns, update TypeScript type and dedup logic.
  Dependencies: none.

## Sub-phase 1 -- Intent Classification Service
  GoalIntent type, IntentClassificationService, integrate into GoalHarness step 0, clarification flow, goal.intent RPC.
  Dependencies: Sub-phase 0.

## Sub-phase 2 -- ContextPack Checkpoint Service
  ContextPackCheckpointService, wire into SchedulerCore (fire-and-forget), getLatestContextPack().
  Dependencies: Sub-phase 0. Parallel with Sub-phase 1.

## Sub-phase 3 -- Feature Extraction Pipeline
  FeatureExtractionService, 'feature-extraction' LLMWorkload, wire into HarnessDaemon after PostGoalEvaluator.
  Dependencies: Sub-phases 0, 1, 2 (all three).

## Sub-phase 4 -- Structured Knowledge Injection
  Structured constraint blocks in elaboration, type-array knowledge query, budget suggestions, scope_limit in planning.
  Dependencies: Sub-phases 1, 3. Parallel with Sub-phase 5.

## Sub-phase 5 -- Semantic Knowledge Retrieval
  Embedding generation on record(), getRelevantKnowledgeSemantic(), update ElaborationService.
  Dependencies: Sub-phases 0, 3. Parallel with Sub-phase 4.

## Sub-phase 6 -- Cross-WorkItem Context Propagation
  extractIntraGoalContext(), inject into execution prompts, cap at 15 items.
  Dependencies: Sub-phase 2. Parallel with Sub-phases 4, 5.

## Sub-phase 7 -- Knowledge Decay Policy
  KnowledgeDecayService (age decay + semantic dedup), knowledge-decay cron persona, audit decayed_at filters.
  Dependencies: Sub-phases 0, 5. Parallel with Sub-phase 6.

Do not jump between sub-phases. Complete and verify each before the next (respecting parallelism where noted).

---

# EXECUTION RULES

## Scope
- Do not silently expand scope beyond the current sub-phase.
- Do not redesign unrelated modules during local work.
- Sub-phase dependencies are strict.

## Verification
- Implemented is not Verified.
- Verified requires: new tests pass + all existing tests green.
- Evidence must be concrete, not vibes.

## Runtime safety
- Preserve SchedulerCore behaviour exactly.
- Preserve GoalHarness statelessness and PostGoalEvaluator non-mutation.
- Preserve auditability and traceability.
- All new services must be constructor-injectable with ILogger.
- Fire-and-forget calls must have `.catch()` wrappers.

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
- over-explain the gaps
- narrate every micro-decision
- pad with generic reasoning

Use short high-signal summaries, then continue doing work.

---

# START-OF-RUN REQUIREMENT

At the start of this command:

1. Read CLAUDE.md and the plan.
2. Check repository state to determine current sub-phase progress:
   - Does migration v4 SQL exist? (Sub-phase 0)
   - Does GoalIntent type exist at `src/domain/work-order/types/goal-intent.ts`? (Sub-phase 1)
   - Does IntentClassificationService exist? (Sub-phase 1)
   - Does ContextPackCheckpointService exist? (Sub-phase 2)
   - Does FeatureExtractionService exist? (Sub-phase 3)
   - Is `'feature-extraction'` in LLMWorkload? (Sub-phase 3)
   - Does `getRelevantKnowledgeSemantic` exist? (Sub-phase 5)
   - Does KnowledgeDecayService exist? (Sub-phase 7)
3. Reconstruct current state from repository reality.
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
- Sub-phase 0: proposed / planned / implemented / verified
- Sub-phase 1: proposed / planned / implemented / verified
- Sub-phase 2: proposed / planned / implemented / verified
- Sub-phase 3: not started / proposed / planned / implemented / verified
- Sub-phase 4: not started / ...
- Sub-phase 5: not started / ...
- Sub-phase 6: not started / ...
- Sub-phase 7: not started / ...

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
- test count (must be >= 2185 + new tests)

---

# FAILURE HANDLING RULE

If the current plan proves partially wrong:

Do not thrash.
Do not abandon progress.
Do not restart from zero.

Instead:
1. identify the discovered reality
2. preserve useful completed work
3. update the plan with findings
4. continue from the corrected next step

---

# SUCCESS STANDARD

Success is not:
- a lot of talking
- a lot of file churn
- a lot of "analysis"

Success is:
- every goal has a typed GoalIntent before elaboration runs
- ContextPacks written during execution, not just at completion
- feature extraction produces global_knowledge entries from every completed goal
- elaboration prompts contain typed constraints and semantically retrieved knowledge
- WorkItem N+1 sees discoveries from WorkItem N
- stale knowledge decays, duplicates merge
- all 2185+ tests green, all invariants holding

Begin immediately.
