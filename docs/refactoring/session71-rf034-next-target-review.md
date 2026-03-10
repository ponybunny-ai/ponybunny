# Session 71: RF-034 Next Target Review

## Scope

This session is documentation-only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution/recovery
- redesign `ToolWorker`
- redesign `ConversationWorker`
- redesign provider-selection, endpoint health, or fallback semantics
- redesign streaming callback semantics
- perform broad module moves or renames

The goal is to identify the single highest-value remaining `RF-034` target after Session 70 removed the `LLMProviderManager` -> `gatewayEventBus` streaming back-edge.

## Review basis

This review is based on the current codebase, especially:

- `src/scheduler-daemon/session-intake.ts`
- `src/scheduler-daemon/daemon.ts`
- `src/app/conversation/response-generator.ts`
- `src/runtime/tooling-context/runtime-tooling-context.ts`
- `src/runtime/workers/conversation-worker.ts`
- `src/gateway/integration/scheduler-factory.ts`
- `docs/refactoring/session53-conversationworker-closure-review.md`
- `docs/refactoring/session58-runtime-core-cleanup-closure-review.md`
- `docs/refactoring/session69-rf034-discovery-review.md`
- `docs/refactoring/session70-llm-stream-event-sink-boundary.md`

## Lines that should not be casually reopened

The following are not the next target unless a new narrow problem statement appears:

- `RF-033` execution/runtime cleanup
- the `ToolWorker` seam
- the `ConversationWorker` seam
- the `LLMStreamEventSink` boundary introduced in Session 70

Why:

- Session 68 already closed the execution/runtime line as stable enough to pause. The remaining pressure there is broader orchestration ownership, not one more obvious narrow import or constructor knot.
- Session 53 already closed the current local-authoritative `ConversationWorker` line. Reopening it now would blur the distinction between worker-seam stability and higher-level composition pressure above the worker.
- Session 45 already paused the `ToolWorker` line for its current local-authoritative scope.
- Session 70 just removed the concrete provider-manager streaming back-edge with an injected `LLMStreamEventSink` plus gateway-owned adapter. Reopening that line immediately would be churn, not the next best dependency-direction win.

`RF-034` should therefore move to the next still-live constructor/composition pressure point instead of revisiting these stabilized seams.

## Candidate check after Session 70

After the provider-manager streaming back-edge removal, two reviewed candidates still stand out:

### A. `SchedulerSessionIntake`

Current shape in `src/scheduler-daemon/session-intake.ts`:

- the class is still the scheduler-daemon-facing facade for session lifecycle, gateway-session binding, and session-event publication
- its constructor also assembles the default conversation runtime graph:
  - persona repository selection
  - `PersonaEngine`
  - SQLite-backed session and memory repositories
  - `LocalEmbeddingService`
  - `CoreMemorySummaryService`
  - `ConversationMemoryService`
  - `InputAnalysisService`
  - `ResponseGenerator`
  - `RetryHandler`
  - `SchedulerTaskBridge`
  - `SessionManager`
  - default `ConversationWorker`
- it still reads runtime config directly and still owns agent-model-hint resolution support through `SchedulerTaskBridge`

This remains the largest non-execution constructor/composition hotspot on a live migrated path.

### B. `gateway/integration/scheduler-factory.ts`

Current shape:

- scheduler composition is still owned by a gateway-named module
- the file assembles `SchedulerCore`, repository adapters, lane/model/budget/retry helpers, quality-gate wiring, and the default `LocalExecutionAdapter`

This is a real ownership-direction smell, but it is less urgent now because it does not currently create the same live source-of-truth ambiguity on a migrated runtime-owned path that `SchedulerSessionIntake` does.

## Is `SchedulerSessionIntake` now the best next target?

Yes.

After Session 70, `SchedulerSessionIntake` is now the single highest-value remaining `RF-034` target.

The reason is not merely that it has a large constructor. The real problem is narrower:

- the scheduler-daemon-facing intake facade is still also the default conversation-runtime composition root
- that composition root mixes migrated explicit runtime-owned inputs with locally fabricated conversation/tooling collaborators
- the strongest example is the `ResponseGenerator` assembly:
  - it receives the explicit migrated `RuntimeToolingContext`
  - but `SchedulerSessionIntake` also fabricates a separate empty `ToolRegistry`, empty `ToolAllowlist`, and a new local `ToolEnforcer`

That means one class currently owns:

- outer scheduler/gateway-facing intake behavior
- conversation bootstrap composition
- a tooling-adjacent policy assembly choice

This is the highest-value remaining pressure point because it is both:

- a constructor/composition pressure problem
- a source-of-truth ownership smell on a path that was explicitly tightened in Sessions 55-58

## The exact narrow knot inside `SchedulerSessionIntake`

The narrow knot is:

the inline default conversation-runtime assembly inside `SchedulerSessionIntake`'s constructor, especially the tooling-adjacent `ResponseGenerator` setup that combines explicit `RuntimeToolingContext` with a separately fabricated local `ToolEnforcer` graph.

More concretely, `SchedulerSessionIntake` currently does all of the following in one place:

1. loads runtime config
2. chooses persona repository strategy
3. constructs memory/session persistence adapters
4. constructs conversation services
5. constructs a local empty tool-enforcement setup for response generation
6. constructs `SessionManager`
7. constructs the default `ConversationWorker`
8. remains the scheduler-daemon facade that publishes session events and owns gateway-session bindings

That is too much ownership for one class above an already-stabilized worker seam.

## Problem classification

### Constructor/composition pressure

Yes.

This is the main classification. The constructor assembles a broad graph of repositories, services, runtime-config readers, and worker defaults before the class even begins its actual intake/facade role.

### Source-of-truth ownership smell

Yes.

This is the most important secondary classification.

`RuntimeToolingContext` was made authoritative on migrated runtime-owned paths in Sessions 55-58. But `SchedulerSessionIntake` still locally fabricates tooling-adjacent collaborators next to that context for conversation response generation. Even without changing behavior, that is the wrong ownership signal: the intake facade is still deciding too much about tooling shape for the conversation path.

### True back-edge

No current concrete back-edge comparable to the removed provider-manager -> gateway dependency was found in this target.

### Dependency-direction smell

Yes.

The smell is not a literal cycle. It is that an outer scheduler-daemon intake facade still depends inward on too many concrete infra/app composition details and partially reconstructs capability shape that should be supplied through a narrower boundary.

## Why this matters architecturally now

This matters now because Session 70 removed the clearest concrete infra -> gateway back-edge, so the next highest-value `RF-034` move should be the next narrow live pressure point rather than a broad ownership clean-up elsewhere.

`SchedulerSessionIntake` is that point because it sits at the intersection of:

- scheduler-daemon facade ownership
- conversation bootstrap composition
- migrated `RuntimeToolingContext` ownership rules
- the already-paused `ConversationWorker` seam

If left untouched, the class will continue to be the obvious place to add one more repository, one more policy choice, one more config read, or one more conversation dependency. That creates growth pressure exactly above a worker seam that was intentionally stabilized and paused.

## What invariant or seam this could threaten if left untouched

If left untouched, this knot most directly threatens:

### 1. `ConversationWorker` local-authoritative seam invariants

The worker seam is supposed to remain the authoritative local message-execution boundary, while `SchedulerSessionIntake` stays the outer facade and continuation owner.

If intake keeps owning the full default conversation graph assembly, it becomes too easy for more orchestration or policy logic to accrete above the worker seam instead of being passed through a narrow explicit boundary.

### 2. `RuntimeToolingContext` source-of-truth rules on migrated paths

Sessions 55-58 established that migrated runtime-owned paths should consume explicit `RuntimeToolingContext` rather than recreate tooling shape locally.

The current intake constructor weakens that direction by building a separate local empty tool-enforcement setup next to the explicit context. Even if behavior is preserved, the ownership line is muddy.

### 3. Outer transport/process ownership lines

`SchedulerSessionIntake` should stay the scheduler-daemon-facing facade, not become the forever-home for all conversation bootstrap decisions. If that continues, later daemon/gateway composition cleanup becomes harder because the intake facade has too much hidden assembly authority.

## Why `gateway/integration/scheduler-factory.ts` should not go first

It remains a real later cleanup target, but it should not be first now.

Why:

- it is primarily a module-ownership/composition-root placement smell
- addressing it first risks broadening into naming, module moves, or process-boundary cleanup
- it does not currently present the same active source-of-truth ambiguity on a migrated conversation path that `SchedulerSessionIntake` does

That makes it a later `RF-034` ownership cleanup, not the first post-Session-70 step.

## Single highest-value first RF-034 target now

The single highest-value first `RF-034` target now is:

the inline default conversation-runtime assembly boundary inside `SchedulerSessionIntake`.

More precisely:

extract or tighten a narrow scheduler-owned conversation composition boundary so `SchedulerSessionIntake` no longer directly assembles the default `SessionManager` + `ResponseGenerator` + repository/memory/persona graph inline.

This should be treated as a conversation-bootstrap/composition cleanup, not as a `ConversationWorker` redesign.

## Safest first cleanup model

The safest first cleanup model is:

introduce a narrow scheduler-owned conversation runtime assembly boundary that builds the default conversation graph for `SchedulerSessionIntake`, while leaving the intake facade, `ConversationWorker`, `SessionManager`, and current behavior intact.

### Boundary to introduce or tighten

Introduce a small scheduler-owned builder/factory boundary for the default conversation stack. The boundary should assemble and return only the concrete collaborators that `SchedulerSessionIntake` actually needs, for example:

- `sessionManager`
- `conversationPort` or the ingredients required to create the default `ConversationWorker`
- any supporting facade-level collaborators that legitimately belong to intake composition

The important point is not the exact type name. The important point is that the intake facade should receive a preassembled conversation stack instead of constructing it inline.

### What should be extracted

Extract only the default conversation graph assembly now:

- runtime-config read used only for conversation bootstrap
- persona repository selection and fallback choice
- session/memory repository setup
- memory/input/retry/response service assembly
- `SchedulerTaskBridge` creation
- default `SessionManager` creation
- default `ConversationWorker` creation

Also tighten the tooling ownership line in that builder:

- use the existing explicit `RuntimeToolingContext` as the conversation tooling source of truth on the migrated path
- avoid letting `SchedulerSessionIntake` remain the place that locally fabricates tooling-adjacent enforcement state

### What should be left in place

Leave these in `SchedulerSessionIntake`:

- gateway-session binding ownership
- session-event publication through the injected publisher
- outer message request creation and result validation
- outer continuation ownership after `ConversationPort.process(...)`
- non-message facade operations such as open/list/history/end/archive/resume/status

### What should not be touched yet

Do not touch:

- `ConversationWorker` request-registry, timeout, or inspection behavior
- `SessionManager` message semantics or task-materialization semantics
- `SchedulerTaskBridge` authority for goal/work-item creation
- gateway behavior
- IPC
- direct vs evented execution semantics
- streaming callbacks
- provider-selection, endpoint health, or fallback logic
- broad container/IoC introduction
- broad module moves/renames

## Preserved invariants

Any Session 72 cleanup based on this review must explicitly preserve:

- scheduler-owned run identity and execution/recovery invariants
- `ReActIntegration` continuation ownership
- `ToolWorker` local-authoritative seam invariants
- `ConversationWorker` local-authoritative seam invariants
- `RuntimeToolingContext` source-of-truth rules on migrated paths
- `LLMStreamEventSink` ownership direction
- outer transport ownership lines
- durable ownership lines

For this target specifically, that means:

- `SchedulerSessionIntake` remains the outer scheduler-daemon facade
- `ConversationWorker` remains the authoritative local message-execution seam
- `SchedulerTaskBridge` remains scheduler-authoritative for goal/work-item materialization
- session routing and session-event publication remain outside the worker seam
- no new transport, IPC, or durable ownership is introduced
- no new streaming ownership path is introduced

## What RF-034 should not do next

Tempting but premature directions in the current codebase:

- reopening provider-manager streaming design just after Session 70
- broad `SchedulerSessionIntake` rewrite instead of one narrow extraction
- broad container/IoC introduction to solve constructor size indirectly
- worker seam redesign, especially `ConversationWorker` or `ToolWorker`
- transport ownership changes between gateway and scheduler
- execution/recovery redesign
- repackaging `gateway/integration/scheduler-factory.ts` as part of the same step
- broad runtime-tooling cleanup beyond the single conversation-bootstrap boundary

Why these are wrong next:

- the current problem is a narrow composition/ownership knot, not missing infrastructure for a full container architecture
- the worker seams are already paused as stable enough for current local-authoritative use
- transport/process-boundary work would broaden scope beyond `RF-034`'s safest next step
- bundling scheduler-factory movement with session-intake cleanup would mix two different ownership problems into one risky change

## Short roadmap for the next RF-034 sub-phase

1. Extract the default conversation-runtime assembly out of `SchedulerSessionIntake` into one narrow scheduler-owned builder/factory boundary.
2. Prove that the intake facade still owns only gateway/session bindings, event publication, request creation, result validation, and lifecycle facade operations.
3. Reassess whether the remaining follow-up is then the scheduler composition-root ownership smell in `gateway/integration/scheduler-factory.ts`.

This keeps the sub-phase incremental and avoids reopening stabilized seams.

## Recommended Session 72

Session 72 should be one narrow coding session that extracts the default conversation-runtime assembly boundary from `SchedulerSessionIntake` without changing behavior.

Rationale:

- it directly addresses the highest-value remaining post-Session-70 constructor/ownership knot
- it is narrow enough to preserve current gateway behavior, IPC, worker seams, and conversation semantics
- it improves the `RuntimeToolingContext` ownership story on the migrated conversation path without reopening runtime-core or worker-line design

## Summary judgment

After the `LLMProviderManager` streaming back-edge removal, `SchedulerSessionIntake` is now the best next `RF-034` target.

The real narrow problem is not “big constructor” in the abstract. It is that the scheduler-daemon intake facade still assembles the default conversation runtime graph inline, including a tooling-adjacent local enforcement setup next to the explicit migrated `RuntimeToolingContext`.

The safest next step is therefore a narrow conversation-bootstrap/composition extraction from `SchedulerSessionIntake`, while leaving worker seams, gateway behavior, IPC, execution/recovery, and transport ownership unchanged.
