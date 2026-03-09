# Session 33: ToolWorker Extraction Design

## Scope

This session establishes the initial ToolWorker extraction design baseline for PonyBunny.

It is documentation-only.

It does not:

- change gateway behavior
- change IPC
- change direct vs evented execution semantics
- redesign execution or recovery behavior
- broaden into conversation worker extraction
- implement ToolWorker code

The goal is to identify the safest first tool boundary that can follow the execution/recovery work completed through Session 32.

## Why ToolWorker is the next seam

Session 32 concluded that the execution/recovery line is stable enough to pause as the primary focus.
Scheduler-owned run identity, durable evented dispatch, claim-once continuation, guarded replay, and direct-mode stability now provide the invariants needed before extracting the next worker-facing seam.

The next large coupling cluster is tool execution.
Today, tool registration, tool exposure to the model, policy scoping, resource selection, local tool execution, and MCP-backed tool invocation are still assembled inside the execution stack.

That means execution orchestration still owns both:

- the LLM/tool loop
- the concrete tool dispatch substrate

ToolWorker should separate those without moving scheduler authority or reopening execution/recovery semantics.

## Current tool-execution path today

The current path is:

1. `SchedulerCore` creates the scheduler-owned run and builds the `ExecutionRequest`.
2. In direct mode it calls `ExecutionPort.execute(...)` immediately.
3. In evented mode it publishes `task.ready` with the same scheduler-owned `ExecutionRequest`.
4. `LocalExecutionWorker` consumes `task.ready` and calls the same `ExecutionPort`.
5. `LocalExecutionAdapter` maps the scheduler request onto the existing `ExecutionService`.
6. `ExecutionService` builds the tool runtime:
   - creates `ToolRegistry`
   - registers built-in local tools
   - creates `ToolAllowlist`
   - creates `ToolEnforcer`
   - installs a global `ToolProvider`
   - optionally initializes skills
   - optionally initializes MCP connections and registers MCP tools
7. `ExecutionService.executeWorkItem(...)` applies route-context normalization, human-approval gating, resource-policy selection, scoped tool policy resolution, skill pre-search, and internal run persistence.
8. `ExecutionService` calls `ReActIntegration.executeWorkCycle(...)`.
9. `ReActIntegration`:
   - generates the execution prompt through `PromptProvider`
   - gets LLM tool definitions from `ToolProvider`
   - calls the model with native tool-calling enabled
   - receives tool calls
   - executes each tool call directly through `ToolEnforcer` + `ToolRegistry`
10. A selected tool executes as one of two broad cases:
   - local built-in tool: direct local Node/process/filesystem/network behavior
   - MCP tool: namespaced registry entry whose `execute(...)` calls `MCPConnectionManager.callTool(...)`
11. `ReActIntegration` returns a run-level execution result to `ExecutionService`.
12. `ExecutionService` completes its internal run, updates spending, persists tool-policy decision metadata, and returns the adapted result.
13. Scheduler continuation remains scheduler-owned:
   - direct mode continues immediately from the returned result
   - evented mode continues only after the durable claim-once result path accepts `execution.completed` or `execution.failed`

## Current component relationships

### Scheduler-owned execution flow

`SchedulerCore` owns:

- work item readiness
- model selection
- lane selection
- scheduler-owned run creation
- direct vs evented dispatch mode
- durable `evented_dispatch` checkpoint state
- claim-once post-result continuation

The scheduler does not currently see individual tool requests or tool results.
From the scheduler-facing seam, tools are hidden inside the execution black box.

### ExecutionService

`ExecutionService` is currently the main assembly point for tool execution concerns.

It directly owns or initializes:

- built-in tool registration
- baseline tool allowlist population
- `ToolEnforcer` construction
- global `ToolProvider` installation
- skill loading entry points
- MCP initialization entry points
- policy audit attachment to work item context
- resource selection for skills and MCP tools
- approval/escalation checks that can short-circuit before the ReAct loop

This makes `ExecutionService` the largest current tool coupling hotspot.

### ReActIntegration

`ReActIntegration` currently mixes three responsibilities:

- LLM interaction and loop control
- tool-schema exposure to the model
- concrete tool invocation

It asks `PromptProvider` for the execution prompt, asks `ToolProvider` for tool definitions, and then executes tool calls inline through `ToolEnforcer.registry.getTool(...).execute(...)`.

That direct invocation is the most natural future insertion point for a ToolWorker boundary.

### ToolProvider / ToolRegistry

`ToolRegistry` is the runtime registry of concrete tool implementations.

`ToolProvider` is an LLM-facing adapter over that registry.
It turns registered tools into:

- prompt summaries
- LLM-native JSON-schema tool definitions
- MCP schema exposure using cached MCP schemas

Today the same registry instance indirectly serves both:

- model-facing schema generation
- execution-facing tool lookup

That shared use is convenient, but it couples prompt/tool exposure and execution dispatch around the same mutable registry.

### ToolEnforcer / policy checks

`ToolEnforcer` currently owns enforcement at the point of invocation:

- baseline allowlist checks
- layered policy checks
- policy audit snapshots

`ExecutionService` also owns policy shaping before invocation:

- extraction of `tool_allowlist`
- extraction of layered policy
- extraction of policy context from route/work-item state
- attachment of policy audit to work-item context
- persistence of tool-policy decisions

This means policy authority is already split across setup and enforcement layers.
ToolWorker extraction must not worsen that split.

### MCP tool invocation

MCP behavior enters through registration, not through a separate execution seam.

Current flow:

1. `initializeMCPIntegration(...)` initializes `MCPConnectionManager`.
2. `registerMCPTools(...)` lists all server tools.
3. `adaptMCPTool(...)` converts each MCP tool into a namespaced `ToolDefinition`.
4. The adapted tool is stored in the same `ToolRegistry` as local tools.
5. At execution time, ReAct sees `mcp__...` tools as ordinary tools.
6. The adapted tool’s `execute(...)` calls `MCPConnectionManager.callTool(...)`.

This is architecturally useful because local and MCP tools already share one invocation shape.
It is also a coupling hotspot because MCP transport details are hidden behind the same registry entry that the LLM-facing tool layer consumes.

### Local tool invocation

Local built-in tools are concrete `ToolDefinition` implementations that execute directly against the local runtime.

Examples include:

- filesystem reads/writes
- shell command execution
- code search
- web search

They receive a `ToolContext` from `ReActIntegration` and execute inline in the same process as the execution loop.

### Prompt and tool schema generation

Prompt and schema generation remain tightly coupled to the same tool registry:

- `PromptProvider` gets available tools from the global `ToolProvider`
- `SystemPromptBuilder` renders prompt sections that include core/domain/skill/MCP tools
- `ReActIntegration` also asks `ToolProvider` for the same tool definitions when calling the LLM

This means tool exposure and tool execution are not separate seams today.
Any mutation to the registry affects both the prompt and the concrete dispatch path.

## Concern classification

### Execution-core concerns that should stay with execution orchestration

These should stay inside execution for the first cut:

- the ReAct loop
- model prompting and response handling
- tool selection by the model
- `complete_task` handling
- fallback heuristics when the model emits no useful tool call
- run-level logs, token accounting, and cost accounting
- approval gates and escalation creation
- skill/MCP candidate selection and ambiguity blocking
- scheduler-owned continuation and replay semantics

These are execution concerns because they decide whether a tool call should happen at all and how the run proceeds after the result.

### Tool-dispatch concerns that can move behind a ToolWorker boundary

These are the best first extraction targets:

- lookup of a concrete tool by normalized tool name
- execution of one requested tool call
- normalization of a single tool success result
- normalization of a single tool failure result
- abstraction over local vs MCP-backed tool implementation execution

This is the narrowest cut that removes direct `ReActIntegration -> tool.execute(...)` coupling without changing who chooses tools or who owns run progression.

### Policy and permission concerns that must remain authoritative elsewhere

These should remain authoritative outside ToolWorker in the first cut:

- route-context-derived policy context
- layered policy resolution
- baseline allowlist selection
- human approval ownership
- resource ambiguity decisions
- escalation creation and policy audit persistence

ToolWorker may defensively reject obviously invalid requests, but it should not become the primary owner of permission policy in the first implementation.

### Transport and integration concerns that should not leak into scheduler-facing seams

These should not appear in scheduler-facing ToolWorker seams:

- `MCPConnectionManager`
- MCP server names and connection states beyond namespaced tool identity
- global `ToolProvider` state
- prompt-template concerns
- LLM-native schema caching details
- direct local tool implementation classes

Scheduler-facing seams should continue to deal in run/work-item identity and normalized results, not MCP or prompt wiring.

## Dependency and coupling hotspots

### 1. ExecutionService is the tool assembly hub

`ExecutionService` currently assembles almost every tool-related dependency:

- registry
- allowlist
- enforcer
- global provider
- skill registry access
- MCP initialization
- resource-policy shaping
- run persistence around tool policy outcomes

This is the most important structural fact in the current codebase.
It means extracting ToolWorker safely requires pulling only one narrow slice first, not relocating the entire tool subsystem in one session.

### 2. ReActIntegration directly invokes tools

`ReActIntegration` currently:

- receives tool calls from the model
- checks policy via `ToolEnforcer`
- looks up the tool from the registry
- executes the tool inline
- turns the raw result into the next LLM message

That gives no worker boundary at the tool-call level.
It also means tool dispatch failures are currently just part of the ReAct loop rather than a separable runtime interaction.

### 3. Registry state is shared between prompt exposure and invocation

The same registry population drives:

- what the model is told exists
- what can actually be executed

That makes prompt/schema generation and dispatch execution mutually coupled.
Changing tool registration affects both surfaces immediately.

### 4. MCP transport is hidden behind registry entries

This is a useful abstraction but also the most dangerous coupling hotspot for extraction:

- MCP tools look identical to local tools at the invocation site
- but they carry remote transport, connection lifecycle, schema cache, and namespacing concerns behind that surface

If ToolWorker tries to “extract all MCP” first, it will absorb transport lifecycle, registry mutation, schema exposure, and execution at once.
That is too broad for the first session after this design.

### 5. Policy ownership is partially split already

Policy setup happens in `ExecutionService`.
Policy checking happens in `ToolEnforcer`.
Prompt exposure also reflects policy through `tool_policy_audit`.

Moving execution of tools without a clear policy boundary risks producing two authorities:

- execution says the call was allowed
- tool worker says something different

That must be avoided.

### 6. Internal run duplication still exists below the execution boundary

`LocalExecutionAdapter` still passes the scheduler-owned `runId` into execution context, but `ExecutionService` still persists its own internal run lifecycle and may create its own runs for approval/resource-selection failure paths.

ToolWorker extraction must not make tool requests depend on those internal run records.
The stable identity anchor remains the scheduler-owned `runId`.

## Safest first ToolWorker extraction model

The safest first extraction is:

- keep tool choice inside `ReActIntegration`
- keep policy authority inside execution
- extract only single-call tool dispatch behind a narrow `ToolPort`

In other words, the first ToolWorker should not be “tool orchestration”.
It should be “tool invocation execution”.

### Minimal ToolWorker responsibility

The minimal first responsibility is:

Execute one already-selected tool call for one scheduler-owned run and return one normalized result.

That includes:

- resolve the concrete tool by name
- execute it against the existing local or MCP-backed implementation
- return a normalized success/failure payload

That does not include:

- deciding which tool to call
- constructing tool schemas for the model
- deciding whether the user must approve the action
- deciding which MCP server or skill should be preferred
- changing scheduler continuation behavior

### What remains inside execution for the first cut

Execution should continue to own:

- prompt generation
- tool schema generation
- tool list exposure to the LLM
- policy resolution and scoped allowlist construction
- resource selection and ambiguity gating
- model loop orchestration
- sequencing of multiple tool calls within one run
- `complete_task` semantics
- fallback search/tool heuristics
- run persistence and cost/log aggregation

### What should not be extracted yet

Do not extract yet:

- MCP connection lifecycle or discovery
- skill discovery or pre-search
- prompt/tool schema generation
- direct vs evented tool dispatch mode
- tool replay/recovery semantics
- multi-process worker topology
- conversation worker concerns

## Initial ToolWorker boundary contract

The first contract should stay as narrow as the existing execution boundary.

### Request shape

Proposed initial request:

```ts
interface ToolRequest {
  toolRequestId: string;
  runId: string;
  workItemId: string;
  goalId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  cwd: string;
  routeContext?: Record<string, unknown>;
  idempotencyKey?: string;
}
```

Notes:

- `toolRequestId` is the boundary identity for one concrete tool dispatch attempt.
- `runId` remains the primary correlation key back to scheduler-owned execution identity.
- `workItemId` and `goalId` remain included for tracing and event payload symmetry.
- `toolCallId` preserves the model/tool-call relationship from the ReAct loop.
- `cwd` is explicit rather than hidden behind process globals.
- `idempotencyKey` is optional because only some tools advertise idempotency support today.

For the first cut, `toolRequestId` should be deterministically derived by execution from:

- `runId`
- `toolCallId`
- `toolName`

That keeps identity stable across retries inside the same execution attempt without inventing scheduler-owned tool sequencing state.

### Result shape

Proposed initial result:

```ts
interface ToolResult {
  toolRequestId: string;
  runId: string;
  workItemId: string;
  goalId: string;
  toolCallId: string;
  toolName: string;
  success: boolean;
  output?: string;
  error?: ToolFailure;
}

interface ToolFailure {
  code: string;
  message: string;
  recoverable: boolean;
}
```

The initial result should stay intentionally small.
It only needs what execution needs in order to:

- append the tool result to the LLM message stream
- decide whether to continue the ReAct loop
- log normalized failures

### Failure shape

The first failure contract should normalize at least:

- tool not found
- request parse/validation failure
- policy mismatch at dispatch boundary if defensively checked
- local tool execution failure
- MCP invocation failure

Failures should be returned as structured data, not only as plain strings, even if execution still converts them into a tool-message string for the current LLM loop.

### Idempotency expectations

The first ToolWorker contract should explicitly state:

- no implicit auto-retry
- no claim of exactly-once execution
- no internal deduplication for non-idempotent tools

If execution calls the same `toolRequestId` twice, that is a duplicate dispatch from execution’s point of view, not something ToolWorker can safely “fix” for all tools.

The only safe first expectation is:

- ToolWorker executes one request once per caller invocation.
- If callers need stronger semantics later, they must add durable request tracking explicitly in a later session.

### Late-result and duplicate-result concerns

For the first cut, ToolWorker should remain synchronous/in-process from execution’s perspective.
That means:

- there is no durable tool event handoff yet
- there is no separate late result path yet
- duplicate results should not exist unless execution itself duplicated the call

This is deliberate.
Evented tool dispatch should not be the first ToolWorker step because the execution/recovery line only just established durable claim-once semantics at the run boundary.

If later sessions add evented tool dispatch, `toolRequestId` should become the durable claim key.
That is a later hardening phase, not Session 34.

## Interaction with execution/recovery invariants

ToolWorker extraction must preserve the invariants established on the execution/recovery line.

### Scheduler-owned run identity

The scheduler-owned `runId` must remain the authoritative cross-boundary correlation key.
Tool requests should always be subordinate to one scheduler-owned run.
ToolWorker must not introduce a second competing run identity model.

### Durable evented dispatch semantics

Evented execution remains at the execution boundary:

- scheduler publishes `task.ready`
- execution worker publishes `execution.completed` / `execution.failed`

ToolWorker extraction should sit inside that execution plane for the first cut.
It should not add a second durable dispatch protocol yet.

### Result claim-once behavior

Claim-once continuation remains a scheduler-owned invariant at execution-result application time.
Tool results must not bypass or compete with that.
In the first cut, tool results are consumed only by the active execution loop and never directly by the scheduler.

### Replay invariants

Replay remains run-scoped.
ToolWorker should not introduce replay-specific tool semantics, tool reattachment, or tool-result resumption logic in the first cut.
If a replayed run reissues tool calls, that remains ordinary execution behavior under the current replay model.

### Direct-mode stability

Direct mode must continue to behave as it does today.
The first ToolWorker boundary should therefore work as a synchronous local dependency of the execution loop in direct mode, without adding scheduler-visible eventing or transport changes.

## What ToolWorker extraction should not do first

The codebase makes several directions tempting, but they are premature.

### Do not extract all MCP behavior at once

Current MCP behavior spans:

- connection initialization
- tool listing
- schema caching
- tool registration
- namespacing
- remote invocation

Only the invocation piece belongs in the first ToolWorker cut.
Pulling the full MCP subsystem at once would broaden the session into transport and lifecycle redesign.

### Do not change permission ownership

Current policy authority is already split across `ExecutionService` and `ToolEnforcer`.
The first extraction should reduce invocation coupling, not move approval/allowlist/layered-policy authority into a new place.

### Do not redesign prompt/tool schema generation too early

`ToolProvider` currently serves both prompt generation and model tool schemas from the same registry.
That is a real cleanup target, but not the first one.
The first boundary should replace inline invocation, not rewrite how tool schemas reach the model.

### Do not start multi-process worker topology

The repository strategy remains:

- event spine first
- boundary extraction second
- worker activation later

Multi-process ToolWorker would force IPC and topology work that this session explicitly excludes.

### Do not add evented tool dispatch before direct tool dispatch exists as a clean boundary

There is currently no durable tool-level request ledger, claim-once rule, or replay model.
Adding evented tool dispatch first would reopen exactly the kind of execution/recovery risk that Session 32 just contained.

### Do not broaden into conversation worker extraction

Conversation/session decoupling is already listed as its own later front.
ToolWorker should be scoped to tool invocation only.

## Recommended Session 34

Recommended Session 34:

Introduce the narrow `ToolPort` / `ToolRequest` / `ToolResult` boundary and route `ReActIntegration.executeToolCall(...)` through a local in-process adapter, while keeping policy resolution, prompt/schema generation, and scheduler semantics unchanged.

That is the single safest next coding session because it:

- removes the direct `ReActIntegration -> tool.execute(...)` dependency
- preserves scheduler and execution invariants
- keeps MCP and local tools behind the same dispatch seam
- avoids tool eventing, replay, and permission-ownership changes

## Practical roadmap

1. Session 34: add the narrow direct `ToolPort` boundary and local adapter; keep execution authoritative for policy and tool selection.
2. Session 35: add a local ToolWorker wrapper/skeleton around that boundary, still in-process and non-authoritative for scheduler semantics.
3. Later hardening: decide whether tool-level eventing/idempotency is justified, then design durable tool request/result handling explicitly.
4. Later cleanup: separate prompt/schema exposure concerns from concrete tool registry mutation if still needed after the worker seam stabilizes.

## Summary

The safest first ToolWorker is not a full tool subsystem extraction.
It is a narrow single-tool invocation boundary inside the execution plane.

Execution should continue to own:

- tool choice
- policy authority
- prompt/schema exposure
- run progression

ToolWorker should first own only:

- executing one named tool request
- normalizing the result
- hiding whether the concrete implementation is local or MCP-backed
