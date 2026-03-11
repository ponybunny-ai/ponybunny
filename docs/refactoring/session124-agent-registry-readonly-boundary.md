# Session 124: Agent-Registry Read-Only Boundary

## Targeted Block

Session 124 completed the first major coding cluster for the active agent-registry access / agent-definition boundary cleanup block.

The bounded target was the safest first slice selected in Session 123:

- introduce one explicit read-only agent-definition / model-hint access boundary
- migrate the first high-value read-only consumers
- stop short of gateway materialization, daemon startup ownership, scheduler composition fallback, and runner registration

## Read-Only Boundary Introduced

This session added `src/infra/agents/agent-definition-read-access.ts`.

That module introduces:

- `IAgentDefinitionReadAccess`
- `IReadOnlyAgentDefinitionView`
- `RegistryBackedAgentDefinitionReadAccess`
- `getGlobalAgentDefinitionReadAccess()`

The boundary is intentionally narrow and non-owning. It only exposes a read-only definition view containing:

- agent id
- source/status metadata
- definition hash
- runner `model` / `model_hint` values

It does not expose:

- `loadAgents(...)`
- mutation or registration operations
- gateway request materialization
- cron reconciliation
- runner registration
- execution-time runner resolution

The implementation remains registry-backed for now, but the read-only consumers no longer import or call `getGlobalAgentRegistry()` directly on their reviewed path.

## Consumers Rewired

### In scope and migrated

- `src/app/conversation/session-manager.ts`
  - session preferred-model reads now go through `IAgentDefinitionReadAccess`
  - caller-local normalization semantics were preserved, including the current `auto` handling on the session path
- `src/infra/llm/provider-manager/agent-model-resolver.ts`
  - workload model-hint reads now go through `IAgentDefinitionReadAccess`
  - caller-local normalization semantics were preserved, including the resolver's existing string handling
- `src/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.ts`
  - now explicitly constructs the `SessionManager` with the new read-only boundary on the default bootstrap path

### Intentionally out of scope and unchanged

- `src/gateway/rpc/handlers/goal-handlers.ts`
  - still owns request materialization against the loaded registry path
- `src/scheduler-daemon/daemon.ts`
  - still owns startup loading, cron reconciliation, and runner registration
- `src/scheduler-daemon/bootstrap/default-daemon-runtime.ts`
  - still owns runtime execution resolver composition
- `src/scheduler/composition/default-scheduler.ts`
  - still retains the compatibility/runtime composition fallback
- `src/infra/scheduler/capabilities.ts`
  - still remains compatibility/reporting residue outside this first cluster
- `src/infra/agents/subagent-process-manager.ts`
  - still remains closer to runtime ownership than to read-only metadata access

## Semantics Intentionally Preserved

This session intentionally did not change:

- model-hint precedence or effective-model resolution behavior
- `SessionManager` preferred-model semantics
- gateway request materialization behavior
- startup/bootstrap ordering or activation ownership
- runner-registration ownership
- RPC, event, status, or TUI payload shapes

The new boundary only changes where the two in-scope consumers read their model-hint data from.

## Validation

Targeted validation completed:

- `npx jest test/infra/agents/agent-definition-read-access.test.ts test/app/conversation/session-manager.preferred-model-alignment.test.ts test/infra/llm/provider-manager/provider-manager.test.ts test/scheduler-daemon/conversation-bootstrap/default-conversation-bootstrap.test.ts --runInBand`
- `npx tsc --noEmit --pretty false --incremental false`
- `rg -n "getGlobalAgentRegistry\\(" ...`
  - confirmed `src/app/conversation/session-manager.ts` and `src/infra/llm/provider-manager/agent-model-resolver.ts` no longer call the global registry directly
  - confirmed the intentionally out-of-scope owner/materializer paths still do

## Likely Next Review Focus

The next session should be a review / re-ranking pass, not another small extraction.

The remaining likely decisions are:

- whether the next justified boundary is a gateway-facing loaded-definition/materialization seam for `agent.command.submit`
- or whether RF-072 should pause after this structural jump because the remaining registry consumers are higher-risk ownership sites

What should not happen next is bundling gateway materialization, daemon startup ownership, scheduler composition, and runner registration into one follow-up session.
