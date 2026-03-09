# Session 34: Tool Boundary First Extraction

## What changed

Session 34 introduced the first narrow ToolWorker-oriented seam as a local in-process tool execution boundary under `src/runtime/tool-boundary/`.

The new boundary defines:

- `ToolRequest`
- `ToolResult`
- `ToolFailure`
- `ToolPort`

It also adds `LocalToolAdapter`, which implements `ToolPort` by delegating to the existing `ToolEnforcer` and `ToolRegistry` path for one tool invocation at a time.

`ReActIntegration` no longer calls `ToolEnforcer.registry.getTool(...).execute(...)` directly. It now builds a `ToolRequest`, sends it through `ToolPort`, and converts the normalized `ToolResult` back into the current tool-message string form expected by the existing ReAct loop.

## What moved behind the boundary

The boundary now hides the concrete single-call invocation details for both local and MCP-backed tools:

- tool argument normalization for one call
- defensive request-shape validation
- allowlist / layered-policy invocation check through the existing `ToolEnforcer`
- registry lookup
- concrete `tool.execute(...)` invocation
- result normalization into `ToolResult` / `ToolFailure`

This means the execution loop no longer depends directly on concrete tool definitions for the actual call site.

## What remains inside execution

This session intentionally kept execution authoritative for everything around tool selection and run progression:

- tool choice still stays inside `ReActIntegration`
- `complete_task` semantics still stay inside `ReActIntegration`
- prompt generation still stays in the current prompt provider path
- tool schema exposure to the model still stays in `ToolProvider`
- policy ownership still stays where it already was, primarily in execution plus `ToolEnforcer`
- fallback search heuristics and sequencing of multiple tool calls still stay in `ReActIntegration`
- scheduler-owned run identity and execution/recovery invariants remain unchanged

`ToolRequest` carries execution identity context for a single dispatch attempt:

- `toolRequestId`
- `runId`
- `workItemId`
- `goalId`
- `toolCallId`
- `toolName`
- `arguments`
- `cwd`
- `routeContext` when available

## What did not change in Session 34

This session did not:

- change gateway behavior
- change IPC
- change direct versus evented execution semantics
- add evented tool dispatch
- add durable tool request/result ledgers
- redesign execution or recovery behavior
- redesign MCP lifecycle or tool registration
- split local tools from MCP tools
- redesign prompt or tool schema generation
- redesign approval or permission ownership
- extract conversation worker concerns
- introduce multi-process ToolWorker behavior

Direct mode still uses synchronous in-process tool execution, only now through a narrow boundary object.

## Validation performed

Focused tests were added for:

- `ReActIntegration` routing tool execution through `ToolPort`
- `LocalToolAdapter` success and failure normalization
- MCP-style tool invocation through the same adapter seam

Build and typecheck were also run for the repository after the change set.

## Next safest ToolWorker step

The next safe step is still the one identified in Session 33: add a local ToolWorker wrapper or skeleton around this boundary while keeping it in-process and non-evented.

That next step should continue to avoid:

- durable tool eventing
- tool replay semantics
- permission ownership redesign
- MCP lifecycle redesign
- scheduler-facing behavior changes

The goal should be to stabilize the boundary as an execution-local dependency before introducing worker activation or transport concerns.
