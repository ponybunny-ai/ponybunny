# LLM Model Selection Priority and Decision Paths

This document defines the effective model-selection hierarchy and runtime decision paths in the current system.

## Canonical Priority (Highest to Lowest)

1. User-explicit model at request time
2. Agent-level model configuration (`runner.config.model`, then `runner.config.model_hint`)
3. Tier policy (`tiers.<tier>.primary`, then `tiers.<tier>.fallback[]`)
4. Availability fallback (next candidate with available endpoints)

Workload-level model keys are no longer part of model selection.

## Configuration Scope and Ownership

- User explicit selection
  - TUI selected model in goal context: `selected_model`
  - RPC/LLM call explicit override: `LLMCompletionOptions.model`
- Agent-level defaults
- Agent override persisted by gateway+scheduler in `ponybunny.json`: `agent.modelOverrides.<agentId>`
  - Agent registry model resolution: `runner.config.model` then `runner.config.model_hint`
- Tier policy
  - `llm-config` tier model policy (`simple|medium|complex`) with primary + fallbacks

## Service-Dimension Decision Paths

### 1) TUI Service

- `/models` opens selector and persists model override through gateway RPC
  - `system.agent.model_override.set` (legacy alias: `system.agent.model_hint.set`)
  - Code: `src/cli/tui/commands/handlers.ts`, `src/cli/gateway/tui-gateway-client.ts`
- Goal creation modal injects selected model into goal context
  - `context.selected_model`
  - Code: `src/cli/tui/components/modals/goal-create-modal.tsx`

### 2) Gateway Service

- Persist agent model override
  - RPC: `system.agent.model_override.set` (legacy alias supported)
  - Scheduler writes `agent.modelOverrides.<agentId>` into `ponybunny.json`
  - Code: `src/gateway/rpc/handlers/system-handlers.ts`
- Goal submit bridge
  - Maps `context.selected_model` into initial work item context `model`
  - Code: `src/gateway/rpc/handlers/goal-handlers.ts`

### 3) Scheduler-Daemon Service (Session-First Intake)

- Reads main-agent model hint from agent config at conversation-to-goal materialization time
- Injects selected model into:
  - `goal.context.selected_model`
  - `workItem.context.model`
- Code: `src/scheduler-daemon/session-intake.ts`

### 4) Scheduler-Core Service

At work-item execution start, model decision is:

1. `workItem.context.model`
2. `goal.context.selected_model`
3. `modelSelector.selectModel(...)` output

Then model source is tagged as:

- `tui_selected` when from context
- `scheduler_selector` when from scheduler selection

Code: `src/scheduler/core/scheduler.ts`

### 5) LLM Provider Manager Service

For workload-routed completions (`complete(workloadId, messages, options)`), candidate chain is built as:

1. `options.model` (if provided)
2. Agent model from registry (`runner.config.model` then `runner.config.model_hint`)
3. Tier chain for that workload's tier (`primary + fallback[]`)

The chain is deduplicated and attempted in order with endpoint availability checks.

Code:

- `src/infra/llm/provider-manager/provider-manager.ts`
- `src/infra/llm/provider-manager/agent-model-resolver.ts`

## Function-Dimension Decision Paths

### A) Session-First Conversation -> Goal Materialization

1. User may set model in TUI (`/models`) -> persisted as per-agent override in `ponybunny.json`
2. Session intake creates goal/work item and injects selected model from hint
3. Scheduler executes with context model first

Outcome: conversation-originated tasks honor model selected in TUI.

### B) Direct Goal Submit from TUI Modal

1. Modal includes `selected_model` in goal context
2. Gateway materialization copies it into initial work item `model`
3. Scheduler uses work-item/goal context before selector

Outcome: explicit user model wins for that goal execution path.

### C) Agent Runtime Workload Calls

1. Agent runtime calls `llm.complete(plan.agentId, ...)`
2. Provider manager builds chain: user override -> agent config -> tier
3. First available model/endpoint is used

Outcome: deterministic priority with graceful fallback.

### D) CLI Work Command

1. `--model` overrides everything for that command
2. Otherwise uses workload-resolved default chain (`execution` tier path)

Code: `src/cli/commands/work.ts`

## Deprecated/Disabled Model Configuration Inputs

The following workload-level keys are disabled for model selection and should not be used:

- `workloads.<id>.llm_model`
- `workloads.<id>.primary`
- `workloads.<id>.fallback`

Current workload role in model selection is tier binding only.

## Operations Troubleshooting Checklist

Use this order when model behavior seems wrong:

1. Confirm explicit request model exists (`selected_model` in goal/work item context, or `options.model`)
2. Confirm persisted agent model hint is present in main agent config
3. Confirm workload tier mapping and tier primary/fallback in `llm-config`
4. Confirm model has available endpoints and credentials
5. Confirm scheduler run context (`selected_model`, `model_source`, `actual_model`) in run records/events

## Practical Rule of Thumb

- One-off task control: set explicit model (highest)
- Agent/persona default behavior: configure agent model (`model`/`model_hint`)
- System default behavior: tune tier policy
