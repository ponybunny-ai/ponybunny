# Session 46: ConversationWorker Extraction Design

## Scope

This session is documentation-only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery
- redesign `ToolWorker`
- implement `ConversationWorker`
- move process ownership across gateway and scheduler

The goal is to define the initial safe extraction boundary for conversation/session orchestration after Session 45 closed the current local `ToolWorker` line as stable enough to pause.

## Current Conversation / Session Path

### 1. Gateway conversation handlers are already thin transport adapters

[`src/gateway/rpc/handlers/conversation-handlers.ts`](src/gateway/rpc/handlers/conversation-handlers.ts) is no longer the main owner of conversation execution.

Current behavior:

- validates RPC input
- reads gateway session metadata such as `channelType` and `channelSessionId`
- forwards conversation commands through `IPCBridge`
- returns the scheduler-side result to the caller
- emits gateway-local failure events only on transport failure

For `conversation.message`, the gateway forwards:

- `gatewaySessionId`
- optional `sessionId`
- optional `personaId`
- optional `userProfileId`
- optional `agentId`
- message and attachments
- channel routing metadata

This is already close to the intended transport seam. The gateway does not currently own analysis, session state transitions, goal creation, or response generation.

### 2. IPCBridge is the gateway-facing conversation transport seam

[`src/gateway/integration/ipc-bridge.ts`](src/gateway/integration/ipc-bridge.ts) currently does two different jobs for conversation flow:

1. command transport from gateway to scheduler daemon
2. session-targeted event fanout back into the gateway event bus

Outbound responsibilities:

- builds one `requestId` per scheduler command
- sends `session_open`, `session_list`, `session_message`, `session_history`, `session_end`, `session_archive`, `session_resume`, and `session_status`
- waits on `scheduler_command_result`

Inbound responsibilities:

- consumes `session_event`
- caches `schedulerSessionId -> gatewaySessionId`
- republishes payloads into the gateway event bus

This is an important hotspot: the current bridge mixes command correlation with gateway-session routing knowledge. That means the scheduler-facing conversation seam is not transport-neutral yet.

### 3. Scheduler daemon session intake is the current composition root and façade

[`src/scheduler-daemon/session-intake.ts`](src/scheduler-daemon/session-intake.ts) is the real current owner of the conversation stack.

`SchedulerSessionIntake` currently:

- constructs `PersonaEngine`
- constructs `SqliteSessionRepository`
- constructs `SqliteMemoryRepository`
- constructs `ConversationMemoryService`
- constructs `InputAnalysisService`
- constructs `ResponseGenerator`
- constructs `RetryHandler`
- constructs `SchedulerTaskBridge`
- constructs `SessionManager`

It also exposes the operational façade used by the daemon command switch:

- `openSession(...)`
- `listSessions(...)`
- `processMessage(...)`
- `getHistory(...)`
- `endSession(...)`
- `archiveSession(...)`
- `resumeSession(...)`
- `getStatus(...)`

That means composition, orchestration, persistence access, gateway binding cache, and event publication are all still collapsed into one class.

### 4. Scheduler daemon command dispatch is a thin command router over session intake

[`src/scheduler-daemon/daemon.ts`](src/scheduler-daemon/daemon.ts) handles `session_*` commands by validating command fields and delegating to `this.sessionIntake`.

This layer is intentionally simple today. For the first extraction, that is useful: the daemon command switch can remain unchanged while the implementation behind `sessionIntake` changes.

### 5. SessionManager is the main conversation orchestration engine today

[`src/app/conversation/session-manager.ts`](src/app/conversation/session-manager.ts) currently owns the main per-message flow:

1. load or create session
2. update session metadata (`userProfileId`, `activeAgentId`, title)
3. add user turn
4. index memory for the user turn
5. load persona
6. recall relevant memories
7. analyze input
8. determine next state using `ConversationStateMachine`
9. either:
   - create a goal through `ITaskBridge` in `executing`
   - narrate progress in `monitoring`
   - produce retry text in `retrying`
   - generate a conversational response in other states
10. add assistant turn
11. index assistant memory
12. persist final session state
13. return response plus optional task info and decision metadata

So the actual orchestration target for extraction is not the gateway handler and not the daemon switch. It is the `SessionManager`-centered conversation pipeline plus the composition around it.

### 6. InputAnalysisService and PersonaEngine are domain-adjacent helpers, not transport layers

[`src/app/conversation/input-analysis-service.ts`](src/app/conversation/input-analysis-service.ts):

- turns recent turns into an LLM analysis request
- classifies intent/emotion/purpose
- provides fallback analysis on LLM failure

[`src/app/conversation/persona-engine.ts`](src/app/conversation/persona-engine.ts):

- resolves persona data from repository
- generates persona prompt text
- owns prompt template loading and prompt override application

These services are conversation dependencies, but they are not themselves session-routing or scheduler-authority layers.

### 7. ResponseGenerator is still coupled to global tool exposure

[`src/app/conversation/response-generator.ts`](src/app/conversation/response-generator.ts) generates conversation replies, progress narration, and result summaries. It also still reaches into global tool exposure:

- pulls tools from `getGlobalToolProvider()`
- filters tool definitions for conversation use
- can execute allowed tool calls through `ToolEnforcer`

This means conversation response generation is not only prompt/LLM work. It is also coupled to the tool stack and global tool registration state. That is a dependency hotspot for extraction even if `ToolWorker` itself is out of scope this session.

### 8. Session persistence and memory persistence are already separate repositories

[`src/infra/persistence/sqlite-session-repository.ts`](src/infra/persistence/sqlite-session-repository.ts) owns:

- sessions table
- session turns table
- lifecycle/archive metadata persistence
- session summaries and turn history

[`src/app/conversation/memory-service.ts`](src/app/conversation/memory-service.ts) plus `SqliteMemoryRepository` own:

- vector and keyword memory indexing
- core memory summarization and retrieval
- owner-scope memory lookup

These are persistence concerns, not worker orchestration concerns. They are dependencies that a worker may call through, but they should not become transport-owned concerns.

### 9. SchedulerTaskBridge is the current goal materialization seam

[`src/scheduler-daemon/session-intake.ts`](src/scheduler-daemon/session-intake.ts) defines `SchedulerTaskBridge`, which currently:

- creates goals directly through the work-order repository
- creates the initial work item directly
- annotates goal/work item context with conversation metadata
- optionally submits the goal through `SchedulerCore`
- serves task status reads for monitoring narration

This is the strongest scheduler-authority coupling in the conversation path. `SessionManager.handleExecuting(...)` calls the task bridge directly and then stores `activeGoalId` in the session.

For the first cut, this materialization path must remain authoritative outside any new worker boundary. Moving it at the same time would blur conversation extraction with scheduler execution/recovery ownership.

### 10. Event publication back to gateway sessions still depends on gateway identity

`SchedulerSessionIntake` currently publishes:

- `conversation.new`
- `conversation.message.started`
- `conversation.response`
- `conversation.message.succeeded`
- `conversation.ended`
- `conversation.archived`
- `conversation.resumed`

Those events are published with optional `gatewaySessionId` and `sessionId`, then `IPCBridge.handleSessionEvent(...)` stores the binding and republishes to the gateway event bus, and `BroadcastManager` uses `gatewaySessionId` to target the correct websocket session.

This is another hotspot:

- the scheduler-side path knows about `gatewaySessionId`
- the gateway bridge knows about `schedulerSessionId`
- the broadcast layer depends on `gatewaySessionId` being present or recoverable

The first `ConversationWorker` seam must not absorb gateway session routing ownership.

## Current Dependency Map

### Primary runtime path

1. Gateway RPC `conversation.message`
2. `IPCBridge.sendSessionMessage(...)`
3. daemon `handleSchedulerCommand('session_message')`
4. `SchedulerSessionIntake.processMessage(...)`
5. `SessionManager.processMessage(...)`
6. `InputAnalysisService` / `PersonaEngine` / memory services / `ResponseGenerator`
7. optional `SchedulerTaskBridge.createGoalFromConversation(...)`
8. `SchedulerSessionIntake.publishEvent(...)`
9. `IPCBridge.handleSessionEvent(...)`
10. gateway event bus
11. `BroadcastManager` targeted delivery to websocket session

### Dependency-oriented coupling graph

`conversation-handlers`

- depends on `IPCBridge`
- depends on gateway session metadata
- should remain transport-only

`IPCBridge`

- depends on IPC server connectivity
- depends on scheduler command protocol
- depends on cached `schedulerSessionId -> gatewaySessionId`
- depends on gateway event bus
- currently mixes transport, command correlation, and session routing concerns

`SchedulerSessionIntake`

- depends on runtime config loading
- depends on persona repository selection
- depends on session repository and memory repository construction
- depends on `LLMService`
- depends on `SchedulerTaskBridge`
- depends on `publishSessionEvent`
- currently mixes composition root, orchestration façade, gateway binding cache, and event publishing

`SessionManager`

- depends on `ISessionRepository`
- depends on `IPersonaEngine`
- depends on `IInputAnalysisService`
- depends on `IResponseGenerator`
- depends on `ITaskBridge`
- depends on `IRetryHandler`
- depends on optional `IConversationMemoryService`
- currently mixes message orchestration, state machine ownership, task-creation trigger points, and session metadata mutation

`ResponseGenerator`

- depends on `LLMService`
- depends on `PersonaEngine`
- depends on global tool provider
- optionally depends on concrete `ToolEnforcer`
- this is the conversation path’s most obvious non-local global dependency

`SchedulerTaskBridge`

- depends on work-order repository authority
- depends on `SchedulerCore.submitGoal(...)`
- writes scheduler-owned goal/work item records
- must remain outside any first-cut conversation worker authority line

`SqliteSessionRepository` / memory repositories

- depend on the memory database
- own durable session and memory state
- should remain persistence adapters, not worker lifecycle owners

## Coupling Hotspots

### 1. `SchedulerSessionIntake` is over-collapsed

This is the most important structural problem.

It currently owns:

- object graph construction
- operational conversation API
- gateway binding cache
- event publication
- fallback persona repository creation

That makes it hard to extract a worker without either:

- copying too much composition logic into the worker, or
- dragging gateway/session routing concerns into the worker boundary

### 2. Goal materialization is directly triggered inside session orchestration

`SessionManager.handleExecuting(...)` immediately calls `ITaskBridge.createGoalFromConversation(...)`.

That means one message-processing call currently owns both:

- conversational interpretation
- scheduler-authoritative task creation

This is the most dangerous coupling hotspot found in the current codebase because it sits exactly at the boundary between conversation orchestration and scheduler-owned execution authority.

If this moves too early, the extraction risks:

- duplicating goal creation authority
- weakening scheduler-owned identity rules
- blurring replay and recovery ownership
- making conversation dedupe inseparable from task dedupe

### 3. Gateway session routing metadata leaks into scheduler-facing flow

`gatewaySessionId`, `channelType`, and `channelSessionId` currently travel through conversation command handling and event publication.

Some of that is necessary for transport today, but it should not become part of the worker’s core orchestration responsibility. Otherwise the worker boundary would be transport-shaped instead of conversation-shaped.

### 4. Response generation still reaches into global tool state

`ResponseGenerator` depends on `getGlobalToolProvider()` and optional `ToolEnforcer`.

This does not block extraction, but it means the first worker boundary should wrap the current response generation implementation rather than trying to re-architect tool exposure now.

### 5. Session persistence and memory persistence are intertwined with orchestration timing

`SessionManager` writes turns, indexes memories, updates session state, and archives/resumes sessions inline with message handling.

Those operations should stay as invoked dependencies in the first cut. Extracting repository ownership itself would be too broad.

## Concern Split For First Extraction

### Conversation-orchestration concerns that could move behind a `ConversationWorker` boundary

- accepting one normalized conversation request
- loading or creating the session through existing repository-backed services
- running persona resolution, memory recall, input analysis, and response generation
- deciding conversation state transitions
- producing the response text and decision metadata
- returning whether the turn requested task creation

### Session persistence concerns that should remain elsewhere

- SQLite session schema ownership
- session turn storage
- archive/resume persistence semantics
- memory repository ownership
- embedding cache ownership
- core memory summarization storage

These should remain in repositories/services injected behind the worker, not move into a transport worker protocol.

### Task/goal materialization concerns that must remain authoritative outside the worker for the first cut

- creating goals in the work-order repository
- creating initial work items
- submitting goals to `SchedulerCore`
- goal/work item status authority
- run identity and execution dispatch authority

The worker can request materialization through a narrow callback or return an intent/result that an outer authority consumes, but it should not become the authoritative owner of scheduler-side task creation yet.

### Transport/session-targeting concerns that should not leak into scheduler-facing seams

- websocket `gatewaySessionId`
- gateway event bus targeting
- channel fanout routing rules
- IPC command request IDs
- pending IPC command timeout management

These are outer transport concerns and should remain outside the first conversation orchestration boundary.

## Safest First `ConversationWorker` Extraction Model

### Recommendation

The first `ConversationWorker` should be an in-process scheduler-local orchestration worker that wraps the existing `SessionManager` stack but does not own scheduler-side task materialization authority or gateway routing authority.

This mirrors the earlier execution/tool extraction strategy:

- create a narrow boundary first
- keep topology local
- preserve authoritative outer owners
- defer activation of broader worker semantics

### Minimal `ConversationWorker` responsibility

Minimal responsibility:

- accept one normalized conversation request
- call the current conversation orchestration stack
- produce one normalized result
- emit narrow worker-local lifecycle events if later needed
- preserve one request -> one result behavior for the caller

For the first cut, it should be the authoritative local seam for conversation-orchestration work only.

### What should remain outside the worker in the first cut

- scheduler daemon IPC command handling
- gateway session binding and websocket targeting
- session and memory repository ownership
- `SchedulerTaskBridge` authority for goal/work item creation
- scheduler-owned execution/run identity
- replay/recovery ownership
- direct-mode execution behavior

### What should not be extracted yet

- full goal/task materialization ownership
- gateway session routing ownership
- memory repository ownership
- persona/prompt redesign
- `ResponseGenerator` tool-exposure redesign
- multi-process conversation workers
- durable conversation request ledger or replay model

## Initial ConversationWorker Boundary Contract

The contract should stay narrow and request/result-shaped, similar in spirit to the execution and tool boundary work.

### Request

```ts
interface ConversationRequest {
  conversationRequestId: string;
  sessionId?: string;
  message: string;
  personaId?: string;
  userProfileId?: string;
  agentId?: string;
  attachments?: Array<{
    type: 'image' | 'file' | 'audio';
    url?: string;
    base64?: string;
    mimeType: string;
    filename?: string;
  }>;
  context?: {
    channelType?: string;
    channelSessionId?: string;
  };
}
```

### Result

```ts
interface ConversationResult {
  conversationRequestId: string;
  sessionId: string;
  response: string;
  state: ConversationState;
  decision: 'goal_created' | 'clarification_requested' | 'response_only';
  decisionReason?: string;
  taskInfo?: {
    goalId: string;
    status: string;
    progress?: number;
  };
  taskCreation?: {
    attempted: boolean;
    createdGoalId?: string;
  };
}
```

### Why `conversationRequestId` is needed

The current session path has no explicit request identity beyond IPC command `requestId`, which is transport-scoped rather than conversation-scoped.

The first worker contract should introduce `conversationRequestId` so that later sessions can reason about:

- duplicate dispatch
- late completion
- inspection
- eventual worker activation

without overloading IPC request IDs or gateway session IDs.

### Relationship to `sessionId` and gateway session binding

- `sessionId` remains the durable conversation/session identity
- `conversationRequestId` identifies one processing attempt for one inbound turn
- gateway session binding remains outside the worker
- outer layers may associate `conversationRequestId` with `gatewaySessionId`, but the worker should not own websocket targeting

### Task-creation side effects

For the first cut, task creation should still happen through the current outer-authoritative scheduler-side seam.

Safe options:

1. keep `SessionManager` calling the existing `ITaskBridge`, but treat that bridge as an injected authority owned outside the worker
2. later narrow further so the worker returns a materialization intent and outer code invokes the bridge

For Session 46, option 1 is the safer first extraction target because it minimizes semantic change.

### Duplicate request concerns

The current code has no conversation-level duplicate protection.

The first extraction should define, but not fully implement, this rule:

- duplicate `conversationRequestId` within one local worker lifetime should resolve to the same in-flight or completed result

However, do not introduce durable dedupe or replay semantics yet. Local in-process duplicate suppression is enough for the first boundary design.

### Late response concerns

Late response handling should also be defined conservatively:

- once the caller has already timed out or otherwise stopped waiting, a late worker result must not create a second outer continuation
- late results may still be diagnostic-only
- gateway routing of late results must remain an outer policy concern, not worker-owned behavior

This is directly analogous to the local `ToolWorker` late-result rule: one caller continuation should observe at most one terminal result.

## Interaction With Existing Execution / Recovery / Tool Invariants

Conversation extraction must preserve the invariants already established on the execution/recovery and tool lines.

### Preserve scheduler-owned run identity

Conversation orchestration may create goals, but it must not take ownership of:

- run creation
- run sequencing
- evented dispatch checkpoints
- replacement run / replay lineage

Those remain scheduler-owned.

### Preserve durable evented dispatch semantics

Conversation extraction must not introduce a second execution authority path.

If a conversation turn leads to a goal:

- goal creation still flows through the existing scheduler-authoritative seam
- downstream execution still uses the existing direct/evented mechanisms unchanged

### Preserve replay invariants

Manual replay and orphan/recovery logic are defined around scheduler-owned run identity and durable execution checkpoints.

Conversation extraction must not:

- redefine replay ownership
- create conversation-owned replacement execution
- create a second replay trigger path

### Preserve `ReActIntegration` continuation ownership

Conversation work may use tools through `ResponseGenerator`, but the execution/tool line already established that:

- `ReActIntegration` owns execution-loop continuation after `ToolResult`
- `LocalToolWorker` is only the local authoritative tool dispatch seam

Conversation extraction must not redesign that relationship. If conversation response generation still invokes tools, it continues to do so through the existing underlying stack.

### Preserve direct-mode stability

Direct mode remains the default stability baseline for execution.

Conversation extraction should therefore:

- stay local and in-process first
- avoid introducing evented conversation dispatch
- avoid daemon/gateway topology changes
- avoid any new async ownership model that could perturb current direct execution follow-through

## What ConversationWorker extraction should not do first

Tempting but premature directions:

- moving full goal/work-item materialization into the worker
- moving gateway websocket session routing into the worker
- replacing session/memory repositories with a new worker-owned persistence protocol
- redesigning persona prompts or conversation prompt strategy
- redesigning `ResponseGenerator` tool exposure together with conversation extraction
- introducing multi-process conversation workers
- introducing durable conversation replay, retries, or recovery semantics
- converting the gateway/session path into a new evented conversation pipeline

These are tempting because the current path is clearly coupled, but they would broaden scope beyond the safe first seam.

## Recommended Incremental Extraction Shape

### Phase 1

Introduce a narrow local `ConversationPort` / `ConversationRequest` / `ConversationResult` boundary and make `SchedulerSessionIntake` delegate message processing through it.

Keep:

- daemon command handling unchanged
- IPC unchanged
- `SessionManager` implementation unchanged
- `SchedulerTaskBridge` authority unchanged

### Phase 2

Split `SchedulerSessionIntake` into:

- a composition root that wires repositories/services
- a transport-facing intake adapter
- a local authoritative `ConversationWorker`

Move only orchestration dispatch behind the worker boundary.

### Phase 3

If still justified, narrow task creation further by separating conversation orchestration from task materialization side effects, while keeping scheduler authority outside the worker.

Do not go beyond that until the first local boundary is proven stable.

## Recommended Session 47

Session 47 should implement the first narrow local conversation boundary:

- add `ConversationPort` / `ConversationRequest` / `ConversationResult`
- add a local in-process `ConversationWorker`
- make `SchedulerSessionIntake` delegate `processMessage(...)` through that boundary
- keep `SessionManager`, `SchedulerTaskBridge`, IPC, gateway behavior, and direct/evented execution semantics unchanged

This is the single safest next coding session because it creates the seam without yet moving authority for persistence, transport routing, or scheduler-owned materialization.

## Summary Judgment

The current architecture is already transport-thin at the gateway edge. The real extraction target is the scheduler-side collapse around `SchedulerSessionIntake` and `SessionManager`.

The safest first `ConversationWorker` is therefore:

- local
- in-process
- authoritative only for conversation orchestration
- request/result-shaped
- still dependent on injected existing repositories and task bridge

The most dangerous hotspot is the direct coupling between session orchestration and scheduler-authoritative goal/materialization inside `SessionManager.handleExecuting(...)` through `SchedulerTaskBridge`.

That coupling should be wrapped first, not moved first.
