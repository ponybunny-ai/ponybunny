# Session 112: RF-030 Conversation Materialization Review

## Scope

Session 112 starts `RF-030` as a bounded review/design line.

This session is documentation only. It does not:

- change runtime behavior
- reopen `RF-034`, `RF-059`, `RF-060`, or `RF-061`
- resume the paused Sessions 95-100, 101-103, 104-109, or `RF-062` lines
- redesign scheduler semantics
- redesign startup/bootstrap behavior
- redesign gateway/daemon transport semantics
- redesign provider execution or fallback behavior
- change RPC/event/status payload shapes
- change TUI behavior
- perform broad package or module cleanup

The goal is to identify the single highest-value, semantics-preserving first target inside the live conversation materialization seam.

## Reviewed Current-Code Surfaces

Primary files reviewed:

- `src/app/conversation/session-manager.ts`
- `src/app/conversation/task-bridge.ts`
- `src/runtime/conversation-boundary/conversation-port.ts`
- `src/runtime/workers/conversation-worker.ts`
- `src/scheduler-daemon/session-intake.ts`
- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`
- `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- `docs/refactoring/session111-rf062-line-review.md`

These are the live code paths that currently control conversation-triggered goal creation, first work-item materialization, scheduler submission, and later task observation.

## Current End-to-End Materialization Path

### 1. Conversation/session side initiates the flow

`SchedulerSessionIntake` is the daemon-facing facade, but it is not where materialization happens.

- `src/scheduler-daemon/session-intake.ts` builds the default conversation stack through `createDefaultConversationBootstrap(...)`
- that bootstrap constructs `SessionManager` and injects a `SchedulerTaskBridge`
- `SchedulerSessionIntake.processMessage(...)` forwards a `ConversationRequest` through `conversationPort.process(...)`
- `ConversationWorker` then calls `SessionManager.processMessage(...)`

So the live conversation-triggered materialization entrypoint is still `SessionManager`, reached through the worker/intake path rather than directly from the gateway.

### 2. `SessionManager` decides when to create executable scheduler work

Inside `src/app/conversation/session-manager.ts`, `handleExecuting(...)`:

- extracts conversation requirements from analysis
- calls `this.taskBridge.createGoalFromConversation(...)`
- stores `session.activeGoalId`
- subscribes to progress through `this.taskBridge.subscribeToProgress(...)`
- generates the user-facing confirmation response using returned task metadata

That means the conversation/session owner still decides both when executable work begins and which bridge method should create it.

### 3. `SchedulerTaskBridge` currently owns materialization and submit

Inside `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`, `createGoalFromConversation(...)` currently does all of the following:

- resolves the effective selected-model compatibility projection
- creates the goal in the work-order repository
- stamps conversation provenance into goal context
- creates the first work item directly in the work-order repository
- stamps the same conversation/model provenance into work-item context
- fetches the scheduler via `schedulerProvider()`
- submits the goal to the scheduler if one exists
- returns `goalId` plus the created first work item

This is the strongest remaining ownership knot in the line. The same bridge method is both:

- the conversation-facing creation API
- the materializer of scheduler-owned records
- the submitter into the scheduler runtime

### 4. Bootstrap currently wires the mixed bridge as one default dependency

Inside `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`:

- the default bootstrap still instantiates `new SchedulerTaskBridge(deps.repository, deps.schedulerProvider)`
- that single object is then injected into `SessionManager`

So the bootstrap boundary currently publishes one dependency that already mixes:

- conversation-facing bridge API
- repository-backed goal/work-item creation
- scheduler submission
- later status reads

### 5. Progress and status observation remain on the same bridge

After creation:

- `SessionManager.handleExecuting(...)` subscribes to progress through `taskBridge.subscribeToProgress(...)`
- `SessionManager.handleMonitoring(...)` later reads status through `taskBridge.getTaskStatus(session.activeGoalId)`
- `SchedulerTaskBridge.subscribeToProgress(...)` is currently a no-op unsubscribe stub
- `SchedulerTaskBridge.getTaskStatus(...)` reads goal and work-item state directly from the repository

So observation currently shares the same bridge surface as creation/submission, even though the observation path is structurally different from the materialization path.

## Current Ownership Blur

The main ownership blur is not that too many files are involved. The blur is that one conversation-facing bridge hides several distinct responsibilities that belong to different layers.

### Materialization ownership leakage

`SessionManager` is still the conversation/session owner, but the bridge it calls immediately materializes scheduler-facing records. The conversation layer therefore reaches a method whose semantic effect is not just "request task start", but "create goal, create first work item, and maybe submit now."

### Bridge carrying too much orchestration responsibility

`SchedulerTaskBridge` is not just an adapter. It currently:

- resolves model projection inputs
- creates repository records
- determines initial work-item shape
- conditionally submits into the scheduler
- exposes later task observation reads

That is too much orchestration load for a single bridge boundary.

### Conversation-side reach-through into scheduler-facing concepts

`SessionManager` must reason in terms of a bridge named around task creation and later reads `goalId`/status through the same surface. Even though it does not directly touch the repository or scheduler, it still depends on a boundary whose primary meaning is scheduler materialization rather than conversation orchestration.

### Bootstrap/materialization coupling

The default bootstrap still exports one default dependency that already bundles materialization plus observation behavior. That makes the composition root publish a wider ownership seam than needed.

### Progress/status observation mixed with creation/submission behavior

`subscribeToProgress(...)` and `getTaskStatus(...)` are read/observation concerns, but they currently sit beside creation/submission on the same concrete bridge. Even with the subscription path still stubbed, the shape of the boundary keeps observation coupled to materialization.

## Plausible First Targets Inside RF-030

Only targets grounded in the current code are evaluated here.

### Target A: Decouple goal/work-item materialization from the `SessionManager`-facing bridge call

Description:

- keep `SessionManager` as the initiator of conversation-triggered work
- replace the current "create goal from conversation" bridge meaning with a narrower intake/request boundary
- move goal creation and first work-item materialization behind a more explicitly scheduler-daemon-owned intake/materializer owner

Evaluation:

- Structural gain: high. This directly attacks the live seam where conversation-facing code triggers a bridge that still owns scheduler record creation.
- Semantic risk: low to moderate if done narrowly. The risk is mainly preserving exact goal/work-item fields, model projection, and submit timing.
- Scope tightness: good if limited to extraction of a materialization owner and rewiring the bridge contract locally.
- True ownership/composition/wiring cleanup: yes. This is the exact boundary confusion currently left in the code.
- Drift risk: moderate. It must not turn into broad conversation lifecycle redesign or new scheduler APIs.

Judgment:

This is a strong candidate, but it is still a little broad. As phrased, it can drift into redesigning the conversation-facing abstraction itself instead of first shrinking the concrete mixed owner.

### Target B: Narrow `SchedulerTaskBridge` so it stops owning both materialization and submit

Description:

- keep the existing conversation-facing call shape initially
- extract the goal/work-item creation plus submit sequence behind a narrower materialization/intake owner
- leave `SchedulerTaskBridge` as a thin delegating conversation adapter plus observation surface for now

Evaluation:

- Structural gain: high. The biggest mixed owner becomes smaller without forcing a broad contract redesign in the same session.
- Semantic risk: low. Existing `SessionManager` behavior, return shape, and scheduler submit timing can remain identical.
- Scope tightness: very high. The cut can stay local to the conversation bootstrap and scheduler-daemon materialization path.
- True ownership/composition/wiring cleanup: yes. This is explicit decomposition of a mixed bridge owner.
- Drift risk: low. It avoids broad lifecycle redesign and avoids scheduler-core changes.

Judgment:

This is the best first coding target because it removes the mixed owner first, while preserving the current call contract and semantics.

### Target C: Separate conversation-side task observation from creation/submission responsibilities

Description:

- split `subscribeToProgress(...)` / `getTaskStatus(...)` out from the creation path
- give `SessionManager` separate observation vs creation dependencies

Evaluation:

- Structural gain: moderate. The separation is real, but today the highest-value confusion is still the materialization/submit knot.
- Semantic risk: low.
- Scope tightness: good.
- True ownership/composition/wiring cleanup: partly. It is boundary cleanup, but it leaves the bigger materialization owner untouched.
- Drift risk: moderate. It can devolve into mostly interface hygiene while the concrete scheduler materializer remains mixed.

Judgment:

This is valuable, but it is not the best first cut. It improves the surface shape without first removing the heavier mixed owner underneath.

### Target D: Tighten bootstrap ownership around initial scheduler intake

Description:

- reshape `default-conversation-bootstrap.ts` so conversation bootstrap publishes a more explicit scheduler intake/materialization dependency graph

Evaluation:

- Structural gain: moderate.
- Semantic risk: low to moderate depending on how far the bootstrap rewrite goes.
- Scope tightness: only good if very carefully bounded.
- True ownership/composition/wiring cleanup: yes, but only as a consequence of extracting a narrower materialization owner.
- Drift risk: high if treated as a bootstrap redesign project.

Judgment:

This is not the first target by itself. It is the composition consequence of a narrower extraction, not the primary seam to attack first.

## Highest-Value First Target

Choose exactly one first target:

### Narrow `SchedulerTaskBridge` by extracting a dedicated conversation materialization owner that creates the goal, creates the first work item, and submits to the scheduler, while leaving `SessionManager` and task-observation semantics unchanged

This is the best first cut because the current problematic seam is concentrated and concrete:

- it lives in `src/scheduler-daemon/conversation-bootstrap/scheduler-task-bridge.ts`
- the same concrete class currently owns materialization, first-work-item creation, scheduler submission, and later status reads
- `SessionManager` in `src/app/conversation/session-manager.ts` calls into that mixed owner through a conversation-facing bridge method

The boundary that should own the materialization sequence instead is a narrower scheduler-daemon-side materialization/intake component, composed by the existing conversation bootstrap and invoked by the bridge. In other words:

- `SessionManager` should continue to initiate "conversation wants executable work"
- a scheduler-daemon-side materialization owner should own "create goal, create first work item, submit"
- `SchedulerTaskBridge` should become a thinner adapter boundary rather than the place where all orchestration lives

Why this is the highest-value first cut:

- it removes the strongest remaining ownership knot identified in Session 111
- it preserves the existing `SessionManager` call contract, response flow, and session-state updates
- it avoids scheduler-core redesign
- it avoids conversation lifecycle redesign
- it keeps bootstrap changes local and consequence-driven rather than turning them into a rewrite

What must remain untouched for semantics safety:

- `SessionManager` remains the initiator of execution from conversation analysis
- goal fields, work-item fields, and context payloads remain unchanged
- selected-model compatibility projection behavior remains unchanged
- first work-item kind and initial shape remain unchanged
- scheduler submission timing and conditional `schedulerProvider()` behavior remain unchanged
- `goalId` / `taskInfo` shapes remain unchanged
- monitoring/status reads remain behaviorally unchanged in this first cut
- `ConversationWorker`, `ConversationPort`, `SchedulerSessionIntake`, gateway transport, RPC/event/status payloads, and TUI behavior remain unchanged

## What Is Not Next

The next session should not broaden beyond this first target.

Explicitly not next:

- broad conversation lifecycle redesign
- scheduler redesign
- bootstrap semantics rewrite
- event protocol cleanup
- TUI or session UX changes
- repo-wide naming or package cleanup
- reopening paused lines
- changing progress-subscription semantics
- changing startup/bootstrap behavior outside the narrow extraction
- changing provider execution or fallback behavior

## Recommended Session 113

Recommend exactly one next session:

Session 113 should be one bounded coding session that extracts the concrete goal/work-item materialization plus scheduler-submit sequence out of `SchedulerTaskBridge` into one narrower scheduler-daemon-owned component, while preserving all current call shapes and runtime semantics.

That is the smallest coding step that meaningfully improves the live boundary without drifting into redesign.

## Practical RF-030 Roadmap

Keep the roadmap small and grounded in the current code.

### Phase 1

Extract the dedicated scheduler-daemon materialization owner and make `SchedulerTaskBridge` delegate creation/submission to it.

### Phase 2

Reassess whether the remaining `SchedulerTaskBridge` surface should still combine conversation-triggered creation with observation reads, or whether the observation side should become a separate dependency.

### Phase 3

Only if Phase 2 still shows clear structural value, tighten bootstrap publication so conversation bootstrap exposes narrower materialization and observation owners explicitly.

Anything beyond that should require a fresh review rather than being assumed upfront.

## Validation

Validation for Session 112 is intentionally review-oriented:

- reviewed the live conversation-to-scheduler materialization files listed above
- traced the current execution, materialization, submission, and status-observation path through the actual codebase
- confirmed this session remains documentation-only and does not change runtime code

No runtime code changes were made in Session 112.
